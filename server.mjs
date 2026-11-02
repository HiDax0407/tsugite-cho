// つぎて帳のサーバー（Node.js の標準機能だけ）。
//   npm start → http://localhost:8793
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './src/store.mjs';

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

const routes = {
  // 見る人ごとに、見てよいものだけ返す（as：本人・継ぐ人・新人の id、または town）
  'GET /api/state': (_, url) => store.view(url.searchParams.get('as') || 'p2'),
  'GET /api/demo': () => demo,
  'POST /api/talk': async (body) => store.talk({ producerId: body.producerId || 'p1', text: body.text, questionId: body.questionId || null }),
  'POST /api/ask': async (body) => store.ask({ askerId: body.askerId || 'p2', text: body.text }),
  'POST /api/share': async (body) => store.setShare({ talkId: body.talkId, share: body.share }),
  'POST /api/later': async (body) => store.later(body.questionId),
  'POST /api/done': async (body) => store.setDone(body.taskId, body.done),
  'POST /api/reset': async () => {
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
      return send(res, 200, await routes[key](body, url));
    }
    if (req.method !== 'GET') return send(res, 404, { error: 'ありません' });
    const rel = PAGES[url.pathname] || normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (rel.includes('..')) return send(res, 400, { error: 'だめです' });
    const file = join(PUBLIC, rel);
    const data = await readFile(file);
    return send(res, 200, data, TYPES[extname(file)] || 'application/octet-stream');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') return send(res, 404, 'ページがありません', 'text/plain; charset=utf-8');
    return send(res, 400, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`つぎて帳：http://localhost:${PORT}  （整理：${store.view('p2').ctx.mode}）`);
});
