// 一周のテスト：継ぐ人が聞く → 無ければ本人に聞くリスト → 本人が話して答える → ノートが埋まる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';

async function fresh() {
  const s = createStore({ file: null, today: () => '2026-11-02' });
  await s.load();
  return s;
}

test('最初は架空の聞き取り4回から、ノートと作業カードができている', async () => {
  const s = await fresh();
  const v = s.view();
  assert.equal(v.talks.length, 4);
  assert.ok(v.notes.length >= 15);
  assert.ok(v.tasks.length >= 5);
  assert.equal(v.ctx.mode, '見本');
});

test('話す → ノート → 質問 → 本人に聞くリスト → 本人が答える → ノートが埋まる', async () => {
  const s = await fresh();
  const q = await s.ask({ text: '石灰はどのくらいの量をまけばいいですか？' });
  assert.equal(q.status, '本人に聞く');
  assert.equal(s.askList().length, 1);

  const r = await s.talk({ text: '石灰は川沿いの畑で二袋。毎年それくらいにしとる。', questionId: q.id });
  assert.equal(r.answeredQuestion.id, q.id);
  const v = s.view();
  const done = v.questions.find((x) => x.id === q.id);
  assert.equal(done.status, '答えあり');
  assert.ok(done.answerNoteIds.length > 0);
  for (const id of done.answerNoteIds) {
    const n = v.notes.find((x) => x.id === id);
    assert.equal(n.answersQuestionId, q.id);
    assert.equal(n.crop, 'オクラ'); // 近い話（抜いたら石灰）の作物を引き継ぐ
  }
  assert.equal(s.askList().length, 0);

  const again = await s.ask({ text: '石灰はどのくらいまけばいい？' });
  assert.equal(again.status, 'ノートにあった');
});

test('本人が話すと、たまっている質問を1つだけ聞き返す', async () => {
  const s = await fresh();
  await s.ask({ text: 'かぼちゃを日陰で寝かせるのは、どこに置けばいいですか？' });
  await s.ask({ text: '掘る機械の刃の深さは、何を見て決めているんですか？' });
  const r = await s.talk({ text: '今日は雨やけん、畑には出ん。' });
  assert.equal(r.followup.type, '継ぐ人の質問');
  assert.match(r.followup.text, /日陰/);
  assert.doesNotMatch(r.followup.text, /刃の深さ/);
});

test('「今はわからん」でリストの最後に回る', async () => {
  const s = await fresh();
  const a = await s.ask({ text: 'かぼちゃを日陰で寝かせるのは、どこに置けばいいですか？' });
  await s.ask({ text: '掘る機械の刃の深さは、何を見て決めているんですか？' });
  s.later(a.id);
  assert.notEqual(s.askList()[0].id, a.id);
  assert.equal(s.askList()[1].id, a.id);
});

test('作業カードは「済み」を押すだけ', async () => {
  const s = await fresh();
  const t = s.view().tasks[0];
  s.setDone(t.id, true);
  assert.equal(s.view().tasks[0].done, true);
});

test('空の話・空の質問は受け付けない', async () => {
  const s = await fresh();
  await assert.rejects(() => s.talk({ text: '  ' }));
  await assert.rejects(() => s.ask({ text: '' }));
});
