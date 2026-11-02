// つぎて帳の記録（話・ノートの行・作業カード・継ぐ人の質問）。
// 最初はキックオフ前に作った架空の聞き取り（data/prepared/）から作り、動かした分は data/runtime/ に残す。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as brain from './brain.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'data', 'prepared', 'tsugite_producer.json');

export function todayJST(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function personName(p) {
  return p.name.replace(/（.*?）/g, '').trim();
}
function givenName(p) {
  return personName(p).split(/\s+/).pop();
}

export function createStore({ file = join(ROOT, 'data', 'runtime', 'state.json'), seedFile = SEED, today = todayJST } = {}) {
  const seed = JSON.parse(readFileSync(seedFile, 'utf8'));
  const producer = seed.people.find((p) => p.role === '生産者本人');
  const successor = seed.people.find((p) => p.role.startsWith('継ぐ人'));
  const ctx = {
    crops: seed.farm.crops,
    people: seed.people,
    producerName: personName(producer).split(/\s+/)[0], // 本人は名字で「山野さん」
    successorName: givenName(successor), // 継ぐ人は名前で「健太さん」（同じ名字のため）
  };
  let state = null;
  let counter = 0;
  const nextId = (p) => `${p}${++counter}`;

  function save() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ counter, state }, null, 2));
  }

  async function addOrganized(talk, opts = {}) {
    const { lines, tasks } = await brain.organize(talk, { ...ctx, startCrop: opts.startCrop || null });
    const newLines = lines.map((l) => ({ id: nextId('n'), ...l, talkId: talk.id, date: talk.date, answersQuestionId: opts.questionId || null }));
    const newTasks = tasks.map((t) => ({ id: nextId('k'), ...t, talkId: talk.id, date: talk.date, done: false, doneAt: null }));
    state.notes.push(...newLines);
    state.tasks.push(...newTasks);
    return { newLines, newTasks };
  }

  async function reset() {
    counter = 0;
    state = {
      farm: seed.farm,
      people: seed.people,
      talks: [],
      notes: [],
      tasks: [],
      questions: [],
    };
    for (const t of seed.talks) {
      const talk = { ...t, source: 'prepared' };
      state.talks.push(talk);
      await addOrganized(talk);
    }
    save();
  }

  async function load() {
    if (file && existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      counter = saved.counter;
      state = saved.state;
    } else {
      await reset();
    }
  }

  function askList() {
    return state.questions.filter((q) => q.status === '本人に聞く');
  }

  // 本人が話す。questionId があれば、継ぐ人の質問への答えとして残す
  async function talk({ text, questionId = null }) {
    const clean = String(text || '').trim();
    if (!clean) throw new Error('話が空です');
    const q = questionId ? state.questions.find((x) => x.id === questionId && x.status === '本人に聞く') : null;
    const talk = { id: nextId('t'), date: today(), speaker: 'p1', text: clean, source: 'app', answersQuestionId: q ? q.id : null };
    state.talks.push(talk);
    // 答えの作物：質問に作物の名前があればそれ、無ければ質問に近いノートの行の作物
    const nearCrop = q?.relatedIds?.length ? state.notes.find((n) => n.id === q.relatedIds[0])?.crop : null;
    const startCrop = q ? ctx.crops.find((c) => q.text.includes(c)) || (nearCrop !== '畑全体' ? nearCrop : null) || null : null;
    const { newLines, newTasks } = await addOrganized(talk, { questionId: q?.id, startCrop });
    if (q) {
      q.status = '答えあり';
      q.answeredAt = talk.date;
      q.answerTalkId = talk.id;
      q.answerNoteIds = newLines.map((l) => l.id);
    }
    const next = await brain.followup({ askList: askList(), newTasks, newLines, successorName: ctx.successorName });
    if (next && next.questionId) {
      const nq = state.questions.find((x) => x.id === next.questionId);
      next.text = await brain.rephrase(nq, ctx);
    }
    save();
    return { talk, newLines, newTasks, answeredQuestion: q || null, followup: next };
  }

  // 本人が「今はわからん」→ その質問はリストの最後へ回す
  function later(questionId) {
    const i = state.questions.findIndex((x) => x.id === questionId);
    if (i < 0) throw new Error('質問が見つかりません');
    const [q] = state.questions.splice(i, 1);
    q.laterCount = (q.laterCount || 0) + 1;
    state.questions.push(q);
    save();
    return q;
  }

  // 継ぐ人が聞く。ノートにあれば本人の言葉で、無ければ本人に聞くリストへ
  async function ask({ text }) {
    const clean = String(text || '').trim();
    if (!clean) throw new Error('質問が空です');
    const result = await brain.answer(clean, state.notes, ctx);
    const q = {
      id: nextId('q'),
      date: today(),
      speaker: 'p2',
      text: clean,
      status: result.answered ? 'ノートにあった' : '本人に聞く',
      noteIds: (result.quotes || []).map((l) => l.id),
      relatedIds: (result.related || []).map((l) => l.id),
      missing: result.missing || null,
    };
    state.questions.push(q);
    save();
    return q;
  }

  function setDone(taskId, done) {
    const t = state.tasks.find((x) => x.id === taskId);
    if (!t) throw new Error('作業カードが見つかりません');
    t.done = !!done;
    t.doneAt = done ? today() : null;
    save();
    return t;
  }

  function view() {
    return { ...state, ctx: { ...ctx, mode: brain.mode(), today: today() } };
  }

  return { load, reset, talk, ask, later, setDone, view, askList };
}
