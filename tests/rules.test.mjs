// 見本の規則のテスト：本人の言葉を書き換えない／ノートに無いことは答えない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { organizeTalk, findAnswer, splitSentences, seasonOf, pickFollowup } from '../src/rules.mjs';

const seed = JSON.parse(readFileSync(new URL('../data/prepared/tsugite_producer.json', import.meta.url), 'utf8'));
const ctx = { crops: seed.farm.crops, people: seed.people };
const all = seed.talks.map((t) => organizeTalk(t, ctx));
const lines = all.flatMap((r) => r.lines);
const tasks = all.flatMap((r) => r.tasks);

test('ノートの行は本人の言葉そのまま（つなぐと元の話に戻る）', () => {
  for (const t of seed.talks) {
    const mine = lines.filter((l) => l.talkId === t.id);
    assert.equal(mine.map((l) => l.quote).join(''), t.text.replace(/\s+/g, ''));
  }
});

test('1行ごとに、いつの話か（日付と時期）が付く', () => {
  for (const l of lines) {
    assert.match(l.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(l.season, /^\d{1,2}月(上|中|下)旬$/);
  }
  assert.equal(seasonOf('2026-10-30'), '10月下旬');
  assert.equal(seasonOf('2026-11-02'), '11月上旬');
});

test('作物は話の流れを引き継ぐ（「抜いたら石灰」はオクラの話）', () => {
  const l = lines.find((x) => x.quote.startsWith('抜いたら石灰'));
  assert.equal(l.crop, 'オクラ');
  const box = lines.find((x) => x.quote.includes('出荷の箱'));
  assert.equal(box.crop, '畑全体');
});

test('作業カード：期限は話した言葉から（「月末締めやから、今週中に」は今週中）', () => {
  const nokyo = tasks.find((t) => t.quote.includes('農協'));
  assert.equal(nokyo.when, '今週中');
  const okra = tasks.find((t) => t.quote.includes('株を抜いて'));
  assert.equal(okra.when, '来週');
  const kabocha = tasks.find((t) => t.quote.includes('霜が来る前'));
  assert.equal(kabocha.when, '霜が来る前');
});

test('「さくらさんにも頼める」は前の作業の担当の候補になる（名簿にいる人だけ）', () => {
  const ditch = tasks.find((t) => t.quote.includes('溝を切り直す'));
  assert.match(ditch.who, /さくらさん/);
});

test('継ぐ人の質問3つ（わざと答えのないもの）は、答えを作らない', () => {
  for (const q of seed.questions_from_successor) {
    const r = findAnswer(q.text, lines, ctx.crops);
    assert.equal(r.answered, false, q.text);
  }
});

test('答えのない質問でも、近い話と「まだ聞いていないこと」は示す', () => {
  const r = findAnswer('かぼちゃを日陰で寝かせるのは、どこに置けばいいですか？', lines, ctx.crops);
  assert.equal(r.missing, '置き場所');
  assert.ok(r.related.some((l) => l.quote.includes('日陰')));
});

test('ノートにある質問は、本人の言葉の行だけで答える（文を作らない）', () => {
  const r = findAnswer('かぼちゃはいつとればいいですか？', lines, ctx.crops);
  assert.equal(r.answered, true);
  for (const q of r.quotes) assert.ok(lines.includes(q));
  assert.ok(r.quotes.some((l) => l.quote.includes('霜が来る前')));
});

test('作物は合っていても、聞かれた中身（種）が無ければ答えない', () => {
  assert.equal(findAnswer('オクラの種はいつまきますか？', lines, ctx.crops).answered, false);
  assert.equal(findAnswer('かぼちゃの肥料はどのくらい？', lines, ctx.crops).answered, false);
});

test('本人が答えたら、同じ質問にノートから答えられるようになる', () => {
  const answerTalk = { id: 'tx', date: '2026-11-02', text: '石灰は川沿いの畑で二袋。毎年それくらいにしとる。' };
  const r = organizeTalk(answerTalk, { ...ctx, startCrop: 'オクラ' });
  const after = [...lines, ...r.lines];
  const a = findAnswer('石灰はどのくらいの量をまけばいいですか？', after, ctx.crops);
  assert.equal(a.answered, true);
  assert.ok(a.quotes[0].quote.includes('二袋'));
});

test('聞き返しは1つだけ。継ぐ人の質問がたまっていれば、それを先に聞く', () => {
  const q = { id: 'q1', text: '石灰はどのくらい？' };
  const f = pickFollowup({ askList: [q], newTasks: [], newLines: [], successorName: '健太' });
  assert.equal(f.questionId, 'q1');
  assert.equal(typeof f.text, 'string');
});

test('文の区切り', () => {
  assert.deepEqual(splitSentences('とる。寝かせる！ほんとか？'), ['とる。', '寝かせる！', 'ほんとか？']);
});
