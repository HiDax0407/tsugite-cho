// Claude API とのつなぎ口（公式 SDK @anthropic-ai/sdk）。
// キー（ANTHROPIC_API_KEY）が無いあいだは使わない。キーが入っていれば、起動時に SDK を読み込む。
//
// 守ること（プログラムの側で確かめる。Claude の答えを信じきらない）
//   ・Claude には「印を付ける」ことだけを頼む。画面に出す言葉は、必ず本人が話した文そのものから取る
//   ・返ってきた番号・作物・期限が、手元の文や名簿に無ければ捨てる（見本の規則の結果に戻す）
//   ・農業の助言をしない。聞き返しは質問だけ
//   ・1日に呼ぶ回数に上限（CLAUDE_MAX_CALLS_PER_DAY）。超えたら見本の規則で動く

import { splitSentences, organizeTalk, detectCrop, similarity, urgencyOf } from './rules.mjs';
import { closeness } from './region.mjs';

// 聞き返し・言い換え＝速い返事のため軽いモデル／まとめ・照合＝上位モデル
const MODEL_MAIN = process.env.CLAUDE_MODEL_MAIN || 'claude-opus-5-5';
const MODEL_LIGHT = process.env.CLAUDE_MODEL_LIGHT || 'claude-haiku-5-5';
const MAX_CALLS = Number(process.env.CLAUDE_MAX_CALLS_PER_DAY || 200);

let client = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic({ timeout: 60_000, maxRetries: 2 }); // キーは環境変数から（コードに書かない）
  } catch (e) {
    console.error('Claude の SDK を読み込めませんでした（npm install をしてください）。見本の規則で動きます：', e.message);
  }
}

// テストでは、本物の API の代わりに偽物の client を差し込む
export function useClientForTest(fake) {
  client = fake;
  counter.day = '';
  counter.calls = 0;
}

const counter = { day: '', calls: 0, inputTokens: 0, outputTokens: 0 };
function today() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function spend() {
  if (counter.day !== today()) {
    counter.day = today();
    counter.calls = 0;
  }
  if (counter.calls >= MAX_CALLS) throw new Error(`今日の Claude の呼び出しが上限（${MAX_CALLS}回）に達しました`);
  counter.calls += 1;
}

export function enabled() {
  return !!client && (counter.day !== today() || counter.calls < MAX_CALLS);
}

export function stats() {
  return { ...counter, max: MAX_CALLS, models: { main: MODEL_MAIN, light: MODEL_LIGHT } };
}

// 決まった形（JSON スキーマ）で答えさせる。断られた・途中で切れたときは失敗として扱う
async function ask({ model, system, user, schema, effort, maxTokens }) {
  spend();
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };
  // 上位モデルが安全のため断ったときは、サーバー側で別のモデルが引き継ぐ（Haiku には無い）
  const res =
    model === MODEL_LIGHT
      ? await client.messages.create(params)
      : await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  counter.inputTokens += res.usage?.input_tokens || 0;
  counter.outputTokens += res.usage?.output_tokens || 0;
  if (res.stop_reason === 'refusal') throw new Error('Claude が答えませんでした（refusal）');
  if (res.stop_reason === 'max_tokens') throw new Error('Claude の答えが途中で切れました');
  const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

const RULES = `あなたは農家さんの話の「聞き手」と「まとめ役」です。次を必ず守ってください。
- 本人の言葉を書き換えない・足さない（方言も言い直しもそのまま）。あなたは印を付けるだけ
- 農業のやり方の助言をしない（正しい量・時期・方法を言わない）
- 話に無いことを推測で埋めない`;

// ---------------------------------------------------------------- まとめ役
// 文は手元で切る（本人の言葉そのまま）。Claude は文の番号ごとに、作物・種類・印・作業かどうかを付ける
const TAGS = ['理由つき', '去年の失敗', 'まだ教わっていない', 'むずかしいところ', '判断のコツ'];

export async function organize(talk, ctx) {
  const sentences = splitSentences(talk.text);
  const cropNames = [...ctx.crops, '畑全体'];
  const schema = {
    type: 'object',
    properties: {
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            i: { type: 'integer' },
            crop: { type: 'string', enum: cropNames },
            kind: { type: 'string', enum: ['コツ', 'いまの様子'] },
            tags: { type: 'array', items: { type: 'string', enum: TAGS } },
          },
          required: ['i', 'crop', 'kind', 'tags'],
          additionalProperties: false,
        },
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            i: { type: 'integer' },
            type: { type: 'string', enum: ['期限', '続き', '条件'] },
            when: { type: 'string', description: '話の中の言葉をそのまま（「来週」「霜が来る前」など）。無ければ空文字' },
            delegateTo: { type: 'string', description: '本人が「頼める」と言った人の名前。無ければ空文字' },
          },
          required: ['i', 'type', 'when', 'delegateTo'],
          additionalProperties: false,
        },
      },
    },
    required: ['lines', 'tasks'],
    additionalProperties: false,
  };
  const user = `本人：${ctx.ownerName}（作っている作物：${ctx.crops.join('・')}）
話した日：${talk.date}
${ctx.startCrop ? `この話は「${ctx.startCrop}」についての質問への答えです。\n` : ''}
話を文に切ってあります。文の番号（i）ごとに印を付けてください。
- crop：どの作物の話か。言っていなければ、同じ話の流れの作物。話題が変わったら「畑全体」
- kind：体の具合や、いまの状態の話なら「いまの様子」、段取りや判断なら「コツ」
- tags：当てはまるものだけ
- tasks：本人がこれからやる作業の文だけ。when は話の中の言葉をそのまま。前の作業に続くなら type「続き」、「〜たら」なら「条件」

${sentences.map((s, i) => `${i}：${s}`).join('\n')}`;
  const out = await ask({ model: MODEL_MAIN, system: RULES, user, schema, effort: 'medium', maxTokens: 8000 });

  // 手元の見本の結果を土台にして、Claude の印のうち確かめられたものだけを使う
  const base = organizeTalk(talk, ctx);
  const given = (ctx.people || []).map((p) => p.name.replace(/（.*?）/g, '').trim().split(/\s+/).pop());
  const lines = base.lines.map((l, i) => {
    const c = (out.lines || []).find((x) => x.i === i);
    if (!c) return l;
    return {
      ...l,
      crop: cropNames.includes(c.crop) ? c.crop : l.crop,
      kind: c.kind === 'いまの様子' ? 'いまの様子' : 'コツ',
      tags: [...new Set((c.tags || []).filter((t) => TAGS.includes(t)))],
      quote: sentences[i], // 本人の言葉そのまま
    };
  });
  const tasks = [];
  for (const t of out.tasks || []) {
    if (!Number.isInteger(t.i) || t.i < 0 || t.i >= sentences.length) continue; // ない文の番号は捨てる
    const s = sentences[t.i];
    const ruleTask = base.tasks.find((x) => x.lineIndex === t.i);
    // 期限の言葉は話の中にあるものだけ。無ければ見本の規則の期限か、決まった言い方
    const when = t.when && talk.text.includes(t.when) ? t.when : ruleTask?.when || (t.type === '続き' ? '前の作業のあと' : 'できるだけ早く');
    const delegate = t.delegateTo && given.find((g) => t.delegateTo.includes(g) && s.includes(g));
    tasks.push({
      talkId: talk.id,
      lineIndex: t.i,
      crop: lines[t.i].crop,
      quote: s,
      context: t.i > 0 && lines[t.i - 1].kind === 'いまの様子' ? sentences[t.i - 1] : null,
      when,
      type: ['期限', '続き', '条件'].includes(t.type) ? t.type : '期限',
      // 家の人への頼みごとは、見本の規則で見分けた担当をそのまま使う
      who: ruleTask?.who?.includes('頼まれたこと') ? ruleTask.who : delegate ? `${ctx.ownerName}（${delegate}さんにも頼めるかも・本人の話）` : ctx.ownerName,
      rank: urgencyOf(when),
    });
  }
  return { lines, tasks };
}

// ---------------------------------------------------------------- 照合役
// 見てよいノートの行の番号だけを返させる。文は作らせない
const MISSING = ['置き場所', '量', '決め方', '時期', '見るところ', '理由', 'その他'];

export async function answer(questionText, { notes, producers, viewer, crops }) {
  const crop = detectCrop(questionText, crops);
  const label = (id) => producers.find((p) => p.id === id)?.label || '本人';
  const schema = {
    type: 'object',
    properties: {
      answerIds: { type: 'array', items: { type: 'string' }, description: '質問にそのまま答えている行の番号だけ' },
      relatedIds: { type: 'array', items: { type: 'string' }, description: '答えではないが近い話の行の番号（3つまで）' },
      missing: { type: 'string', enum: [...MISSING, 'なし'], description: '答えが無いとき、まだ誰も話していないこと' },
    },
    required: ['answerIds', 'relatedIds', 'missing'],
    additionalProperties: false,
  };
  const user = `質問：「${questionText}」

下は農家さんが話した言葉の行です（番号・誰・作物・言葉）。
質問にそのまま答えている行の番号だけを answerIds に入れてください。作物や聞かれていること（時期・量・置き場所など）が合わない行は入れないでください。
迷ったら入れないでください（答えないで本人に聞くほうが安全です）。

${notes.map((n) => `${n.id}｜${label(n.producerId)}｜${n.crop}｜${n.quote}`).join('\n')}`;
  const out = await ask({ model: MODEL_MAIN, system: RULES, user, schema, effort: 'medium', maxTokens: 4000 });

  // 見えている行の番号だけを使う
  const byId = new Map(notes.map((n) => [n.id, n]));
  const picked = [...new Set(out.answerIds || [])].map((id) => byId.get(id)).filter(Boolean);
  const related = [...new Set(out.relatedIds || [])].map((id) => byId.get(id)).filter(Boolean).slice(0, 3);
  // 人ごとにまとめ、近い人から順に（順番は Claude ではなく決まった規則で）
  const groups = new Map();
  for (const n of picked) groups.set(n.producerId, [...(groups.get(n.producerId) || []), n.id]);
  const sources = [...groups.entries()]
    .map(([producerId, noteIds]) => {
      const p = producers.find((x) => x.id === producerId);
      return { producerId, noteIds: noteIds.slice(0, 3), near: closeness(p, viewer, crop) };
    })
    .sort((a, b) => b.near.score - a.near.score)
    .map(({ producerId, noteIds, near }) => ({ producerId, noteIds, reasons: near.reasons }));
  const missing = sources.length ? null : MISSING.includes(out.missing) && out.missing !== 'その他' ? out.missing : null;
  return { crop, answered: sources.length > 0, sources, related, missing };
}

// ---------------------------------------------------------------- 聞き手
// 本人への聞き返しは1回に1つ。質問だけで、助言はしない
const ADVICE = /(した方がいい|したほうがいい|べき|おすすめ|しましょう|してください|正しい)/;

export async function followup({ newTasks, newLines }) {
  if (!newLines.length) return null;
  const schema = {
    type: 'object',
    properties: {
      ask: { type: 'boolean', description: '聞き返す抜けがあるか' },
      type: { type: 'string', enum: ['時期', '量', '理由'] },
      lineIndex: { type: 'integer', description: 'どの文についての聞き返しか' },
      question: { type: 'string', description: '本人に読み上げる短い質問（40字くらいまで）' },
    },
    required: ['ask', 'type', 'lineIndex', 'question'],
    additionalProperties: false,
  };
  const user = `農家さんがいま話した文です。次の人に引き継ぐとき、いちばん困りそうな抜け（いつ・どのくらい・なぜ）を1つだけ選び、本人にやさしく短く聞き返してください。
本人の言い方に合わせ、むずかしい言葉は使わない。助言や正解は言わない。抜けが無ければ ask を false に。

${newLines.map((l, i) => `${i}：${l.quote}`).join('\n')}
${newTasks.length ? `\nこの話からできた作業：${newTasks.map((t) => `${t.when}「${t.quote}」`).join('／')}` : ''}`;
  const out = await ask({ model: MODEL_LIGHT, system: RULES, user, schema, effort: 'low', maxTokens: 1000 });
  if (!out.ask) return null;
  const q = String(out.question || '').trim();
  // 質問の形で、短く、助言を含まないものだけ
  if (!q || q.length > 80 || !/[？?か]$/.test(q) || ADVICE.test(q)) throw new Error('聞き返しの形が決まりに合いません');
  return { type: out.type, crop: newLines[out.lineIndex]?.crop || null, text: q };
}

// 継ぐ人・新人の質問を、本人に伝わる言い方に（中身は変えない）
export async function rephrase(question) {
  const schema = {
    type: 'object',
    properties: { text: { type: 'string', description: '高齢の農家さんに読み上げる、やさしい言い方の質問（1文）' } },
    required: ['text'],
    additionalProperties: false,
  };
  const user = `次の質問を、高齢の農家さんに読み上げて伝わる、やさしい話し言葉の1文にしてください。聞いている中身・作物・言葉の意味は変えないでください。
質問：「${question.text}」`;
  const out = await ask({ model: MODEL_LIGHT, system: RULES, user, schema, effort: 'low', maxTokens: 500 });
  const t = String(out.text || '').trim();
  // 中身が変わっていないか（元の質問の漢字・カタカナの言葉が残っているか）を確かめる
  const hasWords = similarity(question.text, question.text) > 0; // ひらがなだけの質問は言葉の照らし合わせができない
  if (!t || t.length > 100 || (hasWords && similarity(question.text, t) < 1) || ADVICE.test(t)) throw new Error('言い換えが決まりに合いません');
  return `${question.askerVoice}が聞きたいそうです。${t}`;
}
