// 地域で使うときのテスト：見せる範囲を守る／近い人の言葉から出す／無ければ1人だけに聞く／町には数だけ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';

async function fresh() {
  const s = createStore({ file: null, today: () => '2026-11-02' });
  await s.load();
  return s;
}
const talkIdsOf = (v) => new Set(v.notes.map((n) => n.talkId));

test('見せる範囲：「家族だけ」の話は、家族にしか見えない', async () => {
  const s = await fresh();
  // t4（山野さんの腰の話）と t13（大西さんの膝の話）は家族だけ
  assert.ok(talkIdsOf(s.view('p2')).has('t4'));
  assert.ok(!talkIdsOf(s.view('p6')).has('t4'));
  assert.ok(!talkIdsOf(s.view('p6')).has('t13'));
  assert.ok(!talkIdsOf(s.view('town')).has('t1')); // 「地域の新人にも」は町には見えない
  assert.ok(talkIdsOf(s.view('town')).has('t2')); // 「町にも」は見える
  // 返す話の全文も、見てよい話だけ
  assert.ok(s.view('p6').talks.every((t) => t.share !== 'family'));
});

test('本人が見せる範囲を広げると、新人にも見える', async () => {
  const s = await fresh();
  assert.ok(!talkIdsOf(s.view('p6')).has('t3'));
  s.setShare({ talkId: 't3', share: 'region' });
  assert.ok(talkIdsOf(s.view('p6')).has('t3'));
  assert.throws(() => s.setShare({ talkId: 't3', share: 'everyone' }));
});

test('新人の質問：答えのある人が何人いれば、近い人の言葉から順に、出どころつきで', async () => {
  const s = await fresh();
  const q = await s.ask({ askerId: 'p6', text: 'かぼちゃはいつとればいいですか？' });
  assert.equal(q.status, 'ノートにあった');
  assert.deepEqual(q.sources.map((x) => x.producerId), ['p1', 'p4']); // 同じ川口地区の山野さんが先
  assert.ok(q.sources[0].reasons.includes('同じ川口地区'));
  // 答えの行は本人の言葉そのもの（作った文が混ざらない）
  const all = s.all();
  for (const id of q.noteIds) {
    const n = all.notes.find((x) => x.id === id);
    assert.ok(all.talks.find((t) => t.id === n.talkId).text.includes(n.quote));
  }
});

test('ノートに無ければ答えを作らず、いちばん近い本人1人に聞く', async () => {
  const s = await fresh();
  const lime = await s.ask({ askerId: 'p6', text: '石灰はどのくらいの量をまけばいいですか？' });
  assert.equal(lime.status, '本人に聞く');
  assert.equal(lime.toId, 'p5'); // 研修先の川端さん
  assert.equal(lime.noteIds.length, 0);
  const imo = await s.ask({ askerId: 'p6', text: '里芋の種芋は、どこにしまっておけばいいですか？' });
  assert.equal(imo.toId, 'p4'); // 里芋を作っているのは大西さんだけ
  assert.equal(s.askListFor('p1').length, 0); // ほかの本人には届かない
});

test('地域の誰も作っていない作物は「聞ける人がいない」になり、町の数に出る（名前は出さない）', async () => {
  const s = await fresh();
  const q = await s.ask({ askerId: 'p6', text: 'にんにくはいつ植えればいいですか？' });
  assert.equal(q.status, '聞ける人がいない');
  const st = s.view('town').stats;
  assert.equal(st.questions.noOne, 1);
  assert.equal(st.byCrop.find((c) => c.crop === 'にんにく').growers, 0);
  assert.equal(JSON.stringify(st).includes('青木'), false);
  assert.equal(st.noOneList[0].askerId, undefined);
});

test('新人の質問への答えは、聞いた人には届く。ほかの人には本人が広げるまで見えない', async () => {
  const s = await fresh();
  const q = await s.ask({ askerId: 'p6', text: '石灰はどのくらいの量をまけばいいですか？' });
  const r = await s.talk({ producerId: 'p5', text: '石灰はな、うちは川口の畑で一反に一袋半。毎年それくらいやね。', questionId: q.id });
  assert.equal(r.askerLabel, '青木さん');
  assert.equal(r.talk.share, 'family'); // 最初は家族だけ
  assert.ok(talkIdsOf(s.view('p6')).has(r.talk.id)); // 聞いた青木さんには届く
  assert.ok(!talkIdsOf(s.view('p2')).has(r.talk.id)); // 健太さんにはまだ見えない
  const again = await s.ask({ askerId: 'p6', text: '石灰はどのくらいまけばいい？' });
  assert.equal(again.status, 'ノートにあった'); // 二度は聞かない
  s.setShare({ talkId: r.talk.id, share: 'region' });
  assert.ok(talkIdsOf(s.view('p2')).has(r.talk.id));
});

test('本人の画面には、自分あての質問と自分の記録だけ', async () => {
  const s = await fresh();
  await s.ask({ askerId: 'p6', text: '里芋の種芋は、どこにしまっておけばいいですか？' });
  const v = s.view('p5');
  assert.equal(v.questions.length, 0);
  assert.ok(v.notes.every((n) => n.producerId === 'p5'));
  assert.equal(s.view('p4').questions.length, 1);
});
