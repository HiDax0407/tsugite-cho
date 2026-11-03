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
  // 山野さんはキックオフ前の4回（そのまま）＋期間中に足した話
  for (const id of ['t1', 't2', 't3', 't4']) assert.ok(v.talks.some((t) => t.id === id && t.source === 'prepared'));
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
  s.later({ producerId: 'p1', questionId: a.id });
  assert.notEqual(s.askListFor('p1')[0].id, a.id);
  assert.equal(s.askListFor('p1')[1].id, a.id);
});

test('作業カードは「済み」を押すだけ', async () => {
  const s = await fresh();
  const t = s.view('p1').tasks[0];
  s.setDone({ producerId: 'p1', taskId: t.id, done: true });
  assert.equal(s.view('p1').tasks[0].done, true);
});

test('空の話・空の質問・知らない人は受け付けない', async () => {
  const s = await fresh();
  await assert.rejects(() => s.talk({ producerId: 'p1', text: '  ' }));
  await assert.rejects(() => s.ask({ askerId: 'p2', text: '' }));
  await assert.rejects(() => s.ask({ askerId: 'x9', text: 'かぼちゃはいつ？' }));
  assert.throws(() => s.view('x9'));
});

test('ほかの本人あての質問・ほかの本人の作業は動かせない', async () => {
  const s = await fresh();
  const q = await s.ask({ askerId: 'p6', text: '里芋の種芋は、どこにしまっておけばいいですか？' }); // 大西さんあて
  assert.throws(() => s.later({ producerId: 'p1', questionId: q.id }));
  const t = s.view('p1').tasks[0];
  assert.throws(() => s.setDone({ producerId: 'p5', taskId: t.id, done: true }));
});

test('本人は自分の話を消せる（ノートの行・作業カードも消え、答えていた質問は「本人に聞く」に戻る）。ほかの本人の話は消せない', async () => {
  const s = await fresh();
  const q = await s.ask({ askerId: 'p6', text: '石灰はどのくらいの量をまけばいいですか？' });
  const r = await s.talk({ producerId: 'p5', text: '石灰はな、うちは川口の畑で一反に一袋半。明日は袋詰めをする。', questionId: q.id });
  assert.ok(s.all().tasks.some((k) => k.talkId === r.talk.id));
  assert.throws(() => s.forget({ producerId: 'p1', talkId: r.talk.id })); // 自分の話だけ
  const before = s.view('p6').notes.length;
  const out = s.forget({ producerId: 'p5', talkId: r.talk.id });
  assert.equal(out.removedLines, r.newLines.length);
  assert.ok(!s.all().talks.some((t) => t.id === r.talk.id));
  assert.ok(!s.all().notes.some((n) => n.talkId === r.talk.id));
  assert.ok(!s.all().tasks.some((k) => k.talkId === r.talk.id));
  assert.equal(s.view('p6').notes.length, before - r.newLines.length);
  const back = s.all().questions.find((x) => x.id === q.id);
  assert.equal(back.status, '本人に聞く');
  assert.deepEqual(back.answerNoteIds, []);
  assert.equal(s.askListFor('p5').length, 1); // 次に話すとき、また聞かれる
});

test('本人は自分の記録を全部持ち出せる（自分の分だけ。ほかの人の話は入らない）', async () => {
  const s = await fresh();
  const mine = s.exportMine('p5');
  assert.equal(mine.person.label, '川端さん');
  assert.ok(mine.talks.length >= 4 && mine.notes.length > 0 && mine.tasks.length > 0);
  const all = s.all();
  for (const t of mine.talks) assert.equal(all.talks.find((x) => x.id === t.id).producerId, 'p5');
  for (const n of mine.notes) assert.equal(all.notes.find((x) => x.id === n.id).producerId, 'p5');
  assert.ok(mine.talks.every((t) => Array.isArray(t.shareLog)));
  assert.throws(() => s.exportMine('p6')); // 本人でない人の分は無い
});

test('聞き返しへの答えは、聞き返した文の作物から始まる（本人が作っている作物だけ）', async () => {
  const s = await fresh();
  const r1 = await s.talk({ producerId: 'p4', text: '里芋はええ頃になったら掘る。' });
  assert.equal(r1.followup.type, '見るところ');
  const r2 = await s.talk({ producerId: 'p4', text: '葉が半分くらい黄色うなって、倒れてきたら掘り時。', hintCrop: r1.followup.crop });
  assert.equal(r2.newLines[0].crop, '里芋');
  const r3 = await s.talk({ producerId: 'p4', text: '葉が黄色うなったら。', hintCrop: 'ピーマン' }); // 作っていない作物は使わない
  assert.equal(r3.newLines[0].crop, '畑全体');
});

test('聞き返しに答えた直後は、続けて抜けを聞かない（「〜んとこ」は作業にしない）', async () => {
  const s = await fresh();
  const r1 = await s.talk({ producerId: 'p4', text: '里芋はええ頃になったら掘る。' });
  const r2 = await s.talk({ producerId: 'p4', text: '葉が半分くらい黄色うなって、倒れてきたら掘り時。', hintCrop: r1.followup.crop });
  assert.equal(r2.followup, null);
  const dry = s.view('p4').tasks.find((t) => t.quote.includes('日の当たらんとこ'));
  assert.ok(!dry || dry.type === '条件'); // 「〜んとこ」を「〜せんといかん」と取り違えない（掘ったら、の条件の作業ならよい）
});
