// 「使い方」：3画面（新人・本人・町）に同じ見た目のチップがあり、押すと開くカードの文が決めたとおりであること
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pub = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

const LINES = {
  'tsugu.js': [
    '1 マイクを押して、畑のことを声で聞きます。',
    '2 ノートにあれば、近い人の言葉がすぐ出ます。',
    '3 無ければ、いちばん近い農家さん一人に届き、答えがノートに入ります。',
    '農家さんが『地域の新人にも』と見せてくれた言葉です。',
    '作物や人で絞れます。',
    '『元の話を見る』で、話した日と全文が読めます。',
  ],
  'honnin.js': ['1 大きなボタンを押して、いつもの言葉で話します。', '2 届いた質問は読み上げられます。', '3 だれに見せるかは、あなたが決めます。'],
  'machi.js': ['数だけが届きます。名前や話の中身は入りません。', '『聞ける人がいない作物』が、支援の当てどころです。', '『1枚で印刷』で、数だけの A4 が出ます。'],
};

test('3画面に「使い方」のチップと、開く先のカードがある（入口には無い）', () => {
  for (const f of ['tsugu.html', 'honnin.html', 'machi.html']) {
    const html = pub(f);
    assert.match(html, /id="help"[^>]*>使い方</, f);
    assert.match(html, /id="helpCard"[^>]*hidden/, f);
  }
  assert.doesNotMatch(pub('index.html'), /id="help"/);
});

test('使い方の文は決めたとおり（画面ごとに3行）', () => {
  for (const [f, lines] of Object.entries(LINES)) {
    const js = pub(f);
    for (const l of lines) assert.ok(js.includes(l), `${f}: ${l}`);
  }
});

test('読み上げは端末の声（ja-JP）で、もう一度押すと止まる', () => {
  const js = pub('common.js');
  const fn = js.slice(js.indexOf('export function helpToggle'));
  assert.match(fn, /u\.lang = 'ja-JP'/);
  assert.match(fn, /if \(speaking\) return stop\(\)/);
});
