// 一周のテスト：継ぐ人が聞く → 無ければ本人に聞くリスト → 本人が話して答える → ノートが埋まる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';

async function fresh() {
  const s = createStore({ file: null, today: () => '2026-11-02' });
  await s.load();
  return s;
}

test('最初は架空の聞き取りから、本人ごとのノートと作業カードができている', async () => {
  const s = await fresh();
  const v = s.view('p1');
  assert.equal(v.talks.length, 4); // 山野さんはキックオフ前の4回
  assert.ok(v.notes.length >= 15);
  assert.ok(v.tasks.length >= 5);
  assert.equal(v.ctx.mode, '見本');
  assert.ok(s.view('p5').tasks.every((t) => t.who.startsWith('川端さん')));
});

test('家の継ぐ人：話す → ノート → 質問 → 本人に聞くリスト → 本人が答える → ノートが埋まる', async () => {
  const s = await fresh();
  const q = await s.ask({ askerId: 'p2', text: '石灰はどのくらいの量をまけばいいですか？' });
  assert.equal(q.status, '本人に聞く');
  assert.equal(q.toId, 'p1'); // 家族の本人に聞く
  assert.equal(s.askListFor('p1').length, 1);

  const r = await s.talk({ producerId: 'p1', text: '石灰は川沿いの畑で二袋。毎年それくらいにしとる。', questionId: q.id });
  assert.equal(r.answeredQuestion.id, q.id);
  assert.equal(r.askerLabel, '健太さん');
  const done = s.view('p2').questions.find((x) => x.id === q.id);
  assert.equal(done.status, '答えあり');
  for (const id of done.answerNoteIds) {
    const n = s.all().notes.find((x) => x.id === id);
    assert.equal(n.answersQuestionId, q.id);
    assert.equal(n.crop, 'オクラ'); // 近い話（抜いたら石灰）の作物を引き継ぐ
  }
  assert.equal(s.askListFor('p1').length, 0);

  const again = await s.ask({ askerId: 'p2', text: '石灰はどのくらいまけばいい？' });
  assert.equal(again.status, 'ノートにあった');
});

test('本人が話すと、自分に届いた質問を1つだけ聞き返す（ほかの本人あての質問は聞かない）', async () => {
  const s = await fresh();
  await s.ask({ askerId: 'p2', text: 'かぼちゃを日陰で寝かせるのは、どこに置けばいいですか？' });
  await s.ask({ askerId: 'p2', text: '掘る機械の刃の深さは、何を見て決めているんですか？' });
  await s.ask({ askerId: 'p6', text: '里芋の種芋は、どこにしまっておけばいいですか？' }); // 大西さんあて
  const r = await s.talk({ producerId: 'p1', text: '今日は雨やけん、畑には出ん。' });
  assert.equal(r.followup.type, '継ぐ人の質問');
  assert.match(r.followup.text, /^健太さんが聞きたいそうです/);
  assert.match(r.followup.text, /日陰/);
  assert.doesNotMatch(r.followup.text, /刃の深さ|種芋/);
});

test('「今はわからん」でリストの最後に回る', async () => {
  const s = await fresh();
  const a = await s.ask({ askerId: 'p2', text: 'かぼちゃを日陰で寝かせるのは、どこに置けばいいですか？' });
  await s.ask({ askerId: 'p2', text: '掘る機械の刃の深さは、何を見て決めているんですか？' });
  s.later(a.id);
  assert.notEqual(s.askListFor('p1')[0].id, a.id);
  assert.equal(s.askListFor('p1')[1].id, a.id);
});

test('作業カードは「済み」を押すだけ', async () => {
  const s = await fresh();
  const t = s.view('p1').tasks[0];
  s.setDone(t.id, true);
  assert.equal(s.view('p1').tasks[0].done, true);
});

test('空の話・空の質問・知らない人は受け付けない', async () => {
  const s = await fresh();
  await assert.rejects(() => s.talk({ producerId: 'p1', text: '  ' }));
  await assert.rejects(() => s.ask({ askerId: 'p2', text: '' }));
  await assert.rejects(() => s.ask({ askerId: 'x9', text: 'かぼちゃはいつ？' }));
  assert.throws(() => s.view('x9'));
});
