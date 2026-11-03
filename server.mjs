// つぎて帳のサーバー（Node.js の標準機能だけ）。
//   npm start → http://localhost:8793
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './src/store.mjs';
import { createKeys } from './src/keys.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');

// .env があれば読む（キーはリポジトリに入れない）
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const PORT = Number(process.env.PORT || 8793);
const HOST = process.env.HOST || '127.0.0.1';

const store = createStore();
await store.load();
// 一人ひとりの専用リンクの合言葉（data/runtime/keys.json・リポジトリに入れない）
const keys = createKeys({ file: join(ROOT, 'data', 'runtime', 'keys.json'), ids: store.people().map((p) => p.id) });
// デモの入口に全員の専用リンクを並べるか（架空データで試すため）。
// 手元（自分のパソコンの中だけで動かし、公開の名前も無い）なら最初から出す。公開するときは DEMO_LINKS=1 と書いたときだけ出す
const LOCAL_ONLY = ['127.0.0.1', '::1', 'localhost'].includes(process.env.HOST || '127.0.0.1') && !process.env.PUBLIC_HOST;
const DEMO_LINKS = process.env.DEMO_LINKS === '1' || (process.env.DEMO_LINKS !== '0' && LOCAL_ONLY);
if (DEMO_LINKS && !LOCAL_ONLY) console.warn('注意：公開の設定で、入口に全員の専用リンクを出しています（架空データのデモ用）');
const demo = JSON.parse(readFileSync(join(ROOT, 'data', 'demo_answers.json'), 'utf8'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 20_000) throw new Error('長すぎます');
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

// 誰として動くかは、専用リンクの合言葉（X-Tsugite-Key）からだけ決める。画面や要求の中身では名乗らせない
function need(who, kind) {
  if (!who) throw Object.assign(new Error('専用リンクから開いてください'), { status: 401 });
  if (kind === 'producer' && !store.isProducer(who)) throw Object.assign(new Error('本人の画面からだけ使えます'), { status: 403 });
  if (kind === 'viewer' && !store.isViewer(who)) throw Object.assign(new Error('継ぐ人・新人の画面からだけ使えます'), { status: 403 });
  return who;
}

const routes = {
  // 見る人ごとに、見てよいものだけ返す
  'GET /api/state': (_, who) => store.view(need(who)),
  'GET /api/demo': () => demo,
  // デモの入口用：全員の専用リンク（DEMO_LINKS=0 のときは出さない）
  'GET /api/demo-links': () => {
    if (!DEMO_LINKS) throw Object.assign(new Error('ありません'), { status: 404 });
    return store.people().map((p) => ({ ...p, key: keys.tokenOf(p.id) }));
  },
  'POST /api/talk': async (body, who) => store.talk({ producerId: need(who, 'producer'), text: body.text, questionId: body.questionId || null, hintCrop: typeof body.hintCrop === 'string' ? body.hintCrop : null }),
  'POST /api/ask': async (body, who) => store.ask({ askerId: need(who, 'viewer'), text: body.text }),
  'POST /api/share': async (body, who) => store.setShare({ producerId: need(who, 'producer'), talkId: body.talkId, share: body.share }),
  'POST /api/later': async (body, who) => store.later({ producerId: need(who, 'producer'), questionId: body.questionId }),
  'POST /api/done': async (body, who) => store.setDone({ producerId: need(who, 'producer'), taskId: body.taskId, done: body.done }),
  // 本人が自分の話を消す／自分の記録を全部持ち出す（データは本人のもの。自分の分だけ）
  'POST /api/forget': async (body, who) => store.forget({ producerId: need(who, 'producer'), talkId: body.talkId }),
  'GET /api/mine': (_, who) => store.exportMine(need(who, 'producer')),
  'POST /api/reset': async () => {
    if (!DEMO_LINKS) throw Object.assign(new Error('ありません'), { status: 404 });
    await store.reset();
    return { ok: true };
  },
};

// ほかのサイトから書き込まれないように：JSON で、同じ場所の画面から来たものだけ受ける
function sameOrigin(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return false;
  return true;
}

// 決まった名前で来たものだけ受ける（DNS の付け替えで、ほかのサイトから読み書きされないように）
// 公開するときは PUBLIC_HOST に公開先の名前を入れる
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', ...String(process.env.PUBLIC_HOST || '').split(',').filter(Boolean)]);
function hostOk(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  return ALLOWED_HOSTS.has(host);
}

const PAGES = { '/': 'index.html', '/honnin': 'honnin.html', '/tsugu': 'tsugu.html', '/machi': 'machi.html' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = `${req.method} ${url.pathname}`;
  try {
    if (!hostOk(req)) return send(res, 421, { error: 'この名前では使えません' });
    if (routes[key]) {
      if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'この画面からだけ使えます' });
      const body = req.method === 'POST' ? await readJson(req) : null;
      const who = keys.whoIs(String(req.headers['x-tsugite-key'] || ''));
      return send(res, 200, await routes[key](body, who));
    }
    if (req.method !== 'GET') return send(res, 404, { error: 'ありません' });
    const rel = PAGES[url.pathname] || normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (rel.includes('..')) return send(res, 400, { error: 'だめです' });
    const file = join(PUBLIC, rel);
    const data = await readFile(file);
    return send(res, 200, data, TYPES[extname(file)] || 'application/octet-stream');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') return send(res, 404, 'ページがありません', 'text/plain; charset=utf-8');
    return send(res, e.status || 400, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`つぎて帳：http://localhost:${PORT}  （整理：${store.view('p2').ctx.mode}）`);
});
