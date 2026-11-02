// Claude をつないだときの守りのテスト（本物の API は呼ばない。偽物の client を差し込む）
//   ・画面に出る言葉は本人の文そのもの／Claude が返した知らない番号・作物・期限は捨てる
//   ・見てはいけない行は Claude にも送らない
//   ・助言めいた聞き返しは使わない／断られた・上限に達したら見本の規則で動く
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.CLAUDE_MAX_CALLS_PER_DAY = '40';
const claude = await import('../src/claude.mjs');
const brain = await import('../src/brain.mjs');
const { createStore } = await import('../src/store.mjs');

// 偽物の client：answer(params) が返した物を JSON の答えとして返す
function fakeClient(answer, { stop = 'end_turn' } = {}) {
  const calls = [];
  const create = async (params) => {
    calls.push(params);
    const out = answer(params);
    return { stop_reason: stop, content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 10, output_tokens: 5 } };
  };
  return { calls, messages: { create }, beta: { messages: { create } } };
}

const people = [{ name: '山野 茂（架空）' }, { name: '森 さくら（架空）' }];
const ctx = { crops: ['オクラ', 'かぼちゃ'], people, ownerName: '山野さん' };
const talk = { id: 't9', date: '2026-11-02', text: 'かぼちゃは霜が来る前に全部とる。とったら一週間は日陰で寝かせる。これはさくらさんにも頼めると思う。' };

beforeEach(() => claude.useClientForTest(null));

test('まとめ役：言葉は本人の文そのまま。知らない作物・ない文の番号・話に無い期限は捨てる', async () => {
  claude.useClientForTest(
    fakeClient(() => ({
      lines: [
        { i: 0, crop: 'かぼちゃ', kind: 'コツ', tags: ['判断のコツ'] },
        { i: 1, crop: 'メロン', kind: 'コツ', tags: ['理由つき', '作り話'] },
      ],
      tasks: [
        { i: 0, type: '期限', when: '霜が来る前', delegateTo: '' },
        { i: 1, type: '続き', when: '明後日の朝', delegateTo: 'さくら' },
        { i: 99, type: '期限', when: '来週', delegateTo: '' },
      ],
    })),
  );
  const r = await claude.organize(talk, ctx);
  assert.equal(r.lines.map((l) => l.quote).join(''), talk.text); // つなぐと元の話に戻る
  assert.equal(r.lines[1].crop, 'かぼちゃ'); // 「メロン」は名簿に無いので見本の規則の作物
  assert.deepEqual(r.lines[1].tags, ['理由つき']); // 知らない印は捨てる
  assert.equal(r.tasks.length, 2); // 99番の文は無い
  assert.equal(r.tasks[0].when, '霜が来る前');
  assert.notEqual(r.tasks[1].when, '明後日の朝'); // 話に無い期限は使わない
  assert.equal(r.tasks[1].who, '山野さん'); // 「さくら」はその文に無いので担当にしない
});

test('照合役：見てはいけない行は送らない。知らない番号は答えにしない。並び順は決まった規則', async () => {
  const s = createStore({ file: null, today: () => '2026-11-02' });
  await s.load(); // 見本の規則で作る（まだ client なし）
  const visible = s.view('p6').notes;
  const kabocha = visible.filter((n) => n.crop === 'かぼちゃ' && /とる|とりどき/.test(n.quote));
  const p4line = kabocha.find((n) => n.producerId === 'p4');
  const p1line = kabocha.find((n) => n.producerId === 'p1');
  const fake = fakeClient(() => ({ answerIds: [p4line.id, 'n9999', p1line.id], relatedIds: [], missing: 'なし' }));
  claude.useClientForTest(fake);
  const q = await s.ask({ askerId: 'p6', text: 'かぼちゃはいつとればいいですか？' });
  const sent = fake.calls[0].messages[0].content;
  assert.doesNotMatch(sent, /腰が痛くて|膝が悪うて/); // 家族だけの話は Claude にも送らない
  assert.equal(q.status, 'ノートにあった');
  assert.deepEqual(q.sources.map((x) => x.producerId), ['p1', 'p4']); // 同じ地区の山野さんが先
  assert.ok(!q.noteIds.includes('n9999'));
});

test('照合役が何も選ばなければ、答えを作らず近い本人1人に聞く', async () => {
  const s = createStore({ file: null, today: () => '2026-11-02' });
  await s.load();
  claude.useClientForTest(fakeClient(() => ({ answerIds: [], relatedIds: [], missing: '量' })));
  const q = await s.ask({ askerId: 'p6', text: '石灰はどのくらいの量をまけばいいですか？' });
  assert.equal(q.status, '本人に聞く');
  assert.equal(q.toId, 'p5');
  assert.equal(q.missing, '量');
});

test('聞き手：助言めいた聞き返しは使わず、見本の規則に戻る', async () => {
  claude.useClientForTest(fakeClient(() => ({ ask: true, type: '量', lineIndex: 0, question: '石灰は二袋にしましょう。' })));
  const newLines = [{ quote: '抜いたら石灰ふって、ひと月は寝かせる。', tags: [] }];
  await assert.rejects(() => claude.followup({ newTasks: [], newLines }));
  const r = await brain.followup({ askList: [], newTasks: [], newLines, successorName: '' });
  assert.equal(r.type, '量'); // 見本の規則の聞き返し
  assert.match(r.text, /どのくらいの量ですか？$/);
});

test('聞き手：質問の形なら使う（モデルは軽いほう・決まった形で答えさせる）', async () => {
  const fake = fakeClient(() => ({ ask: true, type: '量', lineIndex: 0, question: '石灰は、どのくらいふりますか？' }));
  claude.useClientForTest(fake);
  const r = await brain.followup({ askList: [], newTasks: [], newLines: [{ quote: '抜いたら石灰ふって、ひと月は寝かせる。', tags: [] }] });
  assert.equal(r.text, '石灰は、どのくらいふりますか？');
  assert.equal(fake.calls[0].model, 'claude-haiku-5-5');
  assert.equal(fake.calls[0].output_config.format.type, 'json_schema');
  assert.equal(fake.calls[0].fallbacks, undefined);
});

test('上位モデルの呼び出しは、断られたときの引き継ぎ（fallbacks: default）つき', async () => {
  const fake = fakeClient(() => ({ lines: [], tasks: [] }));
  claude.useClientForTest(fake);
  await claude.organize(talk, ctx);
  assert.equal(fake.calls[0].model, 'claude-opus-5-5');
  assert.equal(fake.calls[0].fallbacks, 'default');
  assert.deepEqual(fake.calls[0].betas, ['server-side-fallback-2026-07-01']);
});

test('Claude が断ったら（refusal）、見本の規則で続ける', async () => {
  claude.useClientForTest(fakeClient(() => ({}), { stop: 'refusal' }));
  const r = await brain.organize(talk, ctx);
  assert.equal(r.lines.map((l) => l.quote).join(''), talk.text);
  assert.ok(r.tasks.length > 0);
});

test('言い換え：中身が変わったら使わず、質問をそのまま伝える', async () => {
  claude.useClientForTest(fakeClient(() => ({ text: '畑の具合はどうですか？' })));
  const q = { text: '石灰はどのくらいの量をまけばいいですか？', askerVoice: '研修生の青木さん' };
  assert.equal(await brain.rephrase(q, {}), '研修生の青木さんが聞きたいそうです。「石灰はどのくらいの量をまけばいいですか？」');
  claude.useClientForTest(fakeClient(() => ({ text: '石灰は、どれくらいまいとるか教えてもらえますか？' })));
  assert.equal(await brain.rephrase(q, {}), '研修生の青木さんが聞きたいそうです。石灰は、どれくらいまいとるか教えてもらえますか？');
});

test('1日の呼び出しの上限を超えたら、Claude を使わず見本の規則で動く', async () => {
  const fake = fakeClient(() => ({ ask: false, type: '時期', lineIndex: 0, question: '' }));
  claude.useClientForTest(fake);
  for (let i = 0; i < 40; i++) await claude.followup({ newTasks: [], newLines: [{ quote: 'あ。', tags: [] }] });
  assert.equal(brain.mode(), '見本');
  await brain.organize(talk, ctx); // 上限なので Claude は呼ばれない
  assert.equal(fake.calls.length, 40);
});
