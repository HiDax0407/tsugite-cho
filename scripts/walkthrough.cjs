// 3分デモの台本（docs/demo-script.md）の順に、ブラウザで自動で押して確かめる。
//   使い方：npm start で起動したまま、別の窓で  node scripts/walkthrough.cjs
//   場面ごとの画像が tmp/walkthrough/ にできる（tmp/ はリポジトリに入れない）
//   Playwright（ヘッドレスの Chromium）が要る。入っていなければ、その旨を出して終わる
//   ※ 最初の状態に戻してから通すので、動かしていた記録は消える（架空のデモデータに戻る）
const path = require('node:path');
const fs = require('node:fs');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright が入っていません。npm i -D playwright && npx playwright install chromium のあとで、もう一度');
  process.exit(1);
}

const BASE = process.env.BASE || 'http://localhost:8793';
const OUT = path.join(__dirname, '..', 'tmp', 'walkthrough');
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
const text = async (loc) => (await loc.innerText()).replace(/\s*\n\s*/g, ' / ');
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? '通った' : '止まった'}　${label}${detail ? `　${detail}` : ''}`);
  if (!cond) process.exitCode = 1;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}_${name}.png`) });
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    d.accept();
  });
  page.on('pageerror', (e) => console.error('画面のエラー：', e.message));

  // 0:00 入口 →「撮影用」→ 3つ並べ（確認のダイアログは出ない）
  await page.goto(`${BASE}/`);
  await page.waitForSelector('#shoot:not([hidden])');
  await shot('entry');
  await page.click('#shoot');
  await page.waitForURL(/both\.html/);
  ok('0:00 撮影用：確認なしで3つ並べに進む', dialogs === 0);
  const fa = page.frameLocator('iframe[title="青木さんの画面"]');
  const fb = page.frameLocator('iframe[title="川端さんの画面"]');
  const fd = page.frameLocator('iframe[title="大西さんの画面"]');
  const fc = page.frameLocator('iframe[title="町の担当者の画面"]');
  await fa.locator('h1:has-text("引き継ぎノート")').waitFor();
  const stat0 = await text(fa.locator('.stat'));
  ok('0:00 青木さんのノートは 29 行', /29 \/ 行のノート/.test(stat0), stat0);
  await shot('note_before');

  // 0:20 かぼちゃの質問 → 2人の言葉 → 元の話
  await fa.locator('.tabs button[data-tab="ask"]').click();
  await fa.locator('button[data-act="sampleq"]:has-text("かぼちゃはいつ")').click();
  await fa.locator('button[data-act="ask"]').click();
  const kabocha = fa.locator('.card.accent').first();
  await kabocha.waitFor();
  const kabochaText = await text(kabocha);
  ok('0:20 かぼちゃ：2人の言葉が近い順（山野さん → 大西さん）', /2人の言葉/.test(kabochaText) && kabochaText.indexOf('山野さん') < kabochaText.indexOf('大西さん'));
  ok('0:20 右上に「照合：…」が出る', /^照合：/.test(await fa.locator('#mode').innerText()), await fa.locator('#mode').innerText());
  await shot('kabocha');
  const gotoBtns = fa.locator('button[data-act="goto"]');
  await gotoBtns.nth((await gotoBtns.count()) - 1).click();
  await fa.locator('.note .src').waitFor();
  ok('0:20 元の話（大西さん）に印つきでたどれる', /上原で冷えるのが早いけん/.test(await text(fa.locator('.note .src').first())));
  await shot('source');

  // 0:45 石灰の質問 → 川端さん1人に聞く
  await fa.locator('.tabs button[data-tab="ask"]').click();
  await fa.locator('button[data-act="sampleq"]:has-text("石灰")').click();
  await fa.locator('button[data-act="ask"]').click();
  const lime = fa.locator('.card.accent').first();
  await lime.waitFor();
  const limeText = await text(lime);
  ok('0:45 石灰：答えを作らず、川端さんに聞く', /まだだれのノートにもありません。川端さんに聞きます/.test(limeText));
  ok('0:45 近い話はあるが「量」はまだ、と出る', /量.*まだだれも話していません/.test(limeText));
  await shot('lime_ask');

  // 1:05 川端さんの画面に届く → 見本で答える → 地域の新人にも
  await fb.locator('.ask-card:has-text("石灰")').waitFor({ timeout: 15000 });
  ok('1:05 川端さんの画面に質問が届く（数秒）', true);
  ok('1:05 「見本の話を入れる」が画面の中にある', await fb.locator('button[data-act="sample"]').isVisible());
  await shot('kawabata_question');
  await fb.locator('button[data-act="sample"]').click();
  await fb.locator('button[data-act="save"]').click();
  const reply = fb.locator('.card.accent').first();
  await reply.waitFor();
  const replyText = await text(reply);
  ok('1:05 「青木さんに届けました」。聞き返しは出ない', /青木さんに届けました/.test(replyText) && !/ですか？/.test(replyText), replyText);
  ok('1:05 右上に「整理：…」が見える', await fb.locator('#mode').isVisible());
  await shot('kawabata_saved');
  await fb.locator('button[data-act="share"][data-share="region"]').click();
  await fb.locator('button[data-act="share"][data-share="region"][aria-pressed="true"]').waitFor();
  await shot('kawabata_share');

  // 1:35 青木さんにその場で届く → もう一度聞くとノートから
  const arrived = fa.locator('.card.accent:has-text("川端さんから答えが来ました")');
  await arrived.waitFor({ timeout: 15000 });
  ok('1:35 「川端さんに聞きます」のカードが「答えが来ました」に変わる', /一反に一袋半/.test(await text(arrived)));
  await shot('aoki_answer');
  await fa.locator('button[data-act="reask"]').click();
  const again = fa.locator('.card.accent').first();
  await again.locator(':scope:has-text("ノートにありました")').waitFor();
  ok('1:35 もう一度聞くと、今度はノートから（川端さんの言葉）', /ノートにありました.*川端さん/.test(await text(again)));
  await shot('aoki_again');

  // 1:50 大西さん：ええ頃 → 聞き返しが1つ
  await page.click('#swap');
  await fd.locator('button[data-act="sample"]').click();
  await fd.locator('button[data-act="save"]').click();
  const onishi = fd.locator('.card.accent').first();
  await onishi.waitFor();
  const onishiText = await text(onishi);
  ok('1:50 「ええ頃」に、どこを見て決めるかを1つだけ聞き返す', (onishiText.match(/か？/g) || []).length === 1 && /「ええ頃」は、どこを見て決めとりますか？/.test(onishiText), onishiText);
  ok('1:50 右上に「聞き返し：…」が出る', /聞き返し：/.test(await fd.locator('#mode').innerText()));
  await shot('onishi_followup');

  // 2:05 町：作物ごとの表に「聞ける人がいない」作物
  const tbl = fc.locator('table.tbl').first();
  await tbl.scrollIntoViewIfNeeded();
  const row = (await tbl.innerText()).split('\n').find((r) => r.startsWith('にんにく')) || '';
  ok('2:05 町の表：にんにくは作る人 0・聞ける人なし 1', row.split('\t').join(' ') === 'にんにく 0人 0 1 0 1', row.split('\t').join(' '));
  ok('2:05 町の画面に質問した人の名前が出ない', !/青木/.test(await text(fc.locator('#main'))));
  await shot('town');

  // 2:25 青木さんのノート：29 → 31（今日 +2）
  await fa.locator('.tabs button[data-tab="note"]').click();
  await fa.locator('h1:has-text("引き継ぎノート")').waitFor();
  const stat1 = await text(fa.locator('.stat'));
  ok('2:25 ノートは 31 行・今日 +2', /31 \/ 行のノート \/ 今日 \+2/.test(stat1), stat1);
  await shot('note_after');
  await fa.locator('button[data-act="crop"][data-crop="畑全体"]').click();
  await fa.locator('.note.answer').first().waitFor();
  ok('2:25 「畑全体」に石灰の答え（川端さんの言葉）が入っている', /一反に一袋半/.test(await text(fa.locator('.note.answer').first())));
  await shot('note_field');
  await fa.locator('button[data-act="crop"][data-crop="かぼちゃ"]').click();
  ok('かぼちゃの欄は 7 行のまま', (await fa.locator('.note').count()) === 7);

  await browser.close();
  console.log(`画像：${OUT}`);
})().catch((e) => {
  console.error('途中で止まりました：', e.message);
  process.exit(1);
});
