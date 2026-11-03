// つぎて帳の記録（本人ごとの話・ノートの行・作業カード、継ぐ人・新人の質問）。
// 最初は架空のデモデータ（data/prepared/ と data/region_demo.json）から作り、動かした分は data/runtime/ に残す。
// 見る人ごとに、見てよいものだけを返す（本人が決めた見せる範囲を守る）。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as brain from './brain.mjs';
import { SHARE, SHARE_KEYS, shareOf, canSee, routeTo } from './region.mjs';
import { COMMON_CROPS } from './rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'data', 'prepared', 'tsugite_producer.json');
const REGION = join(ROOT, 'data', 'region_demo.json');
const VERSION = 3;

export function todayJST(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function createStore({
  file = join(ROOT, 'data', 'runtime', 'state.json'),
  seedFile = SEED,
  regionFile = REGION,
  today = todayJST,
} = {}) {
  const seed = JSON.parse(readFileSync(seedFile, 'utf8'));
  const reg = JSON.parse(readFileSync(regionFile, 'utf8'));
  const people = [...seed.people, ...reg.people];
  const producers = reg.producers.map((p) => ({ ...p, crops: p.crops || seed.farm.crops }));
  const viewers = reg.viewers;
  const town = { ...reg.town, role: 'town' };
  const crops = [...new Set([...producers.flatMap((p) => p.crops), ...COMMON_CROPS])];
  const producerOf = (id) => producers.find((p) => p.id === id);
  const viewerOf = (id) => viewers.find((v) => v.id === id);

  let state = null;
  let counter = 0;
  const nextId = (p) => `${p}${++counter}`;
  const talkOf = (id) => state.talks.find((t) => t.id === id);
  const qOf = (id) => state.questions.find((q) => q.id === id);

  function save() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: VERSION, counter, state }, null, 2));
  }

  async function addOrganized(talk, opts = {}) {
    const p = producerOf(talk.producerId);
    const { lines, tasks, by } = await brain.organize(talk, { crops: p.crops, people, ownerName: p.label, startCrop: opts.startCrop || null }, { rulesOnly: !!opts.rulesOnly });
    const base = { talkId: talk.id, producerId: talk.producerId, date: talk.date };
    const newLines = lines.map((l) => ({ id: nextId('n'), ...l, ...base, answersQuestionId: opts.questionId || null }));
    const newTasks = tasks.map((t) => ({ id: nextId('k'), ...t, ...base, done: false, doneAt: null }));
    state.notes.push(...newLines);
    state.tasks.push(...newTasks);
    return { newLines, newTasks, by };
  }

  async function reset() {
    counter = 0;
    state = { talks: [], notes: [], tasks: [], questions: [] };
    const all = [
      ...seed.talks.map((t) => ({ ...t, producerId: 'p1', share: reg.seed_share[t.id] || 'family' })),
      ...reg.talks,
    ].sort((a, b) => a.date.localeCompare(b.date));
    for (const t of all) {
      // shareLog：だれに見せるかを本人が決めた記録（いつ・どの範囲）。最初の範囲も記録に残す
      const talk = { ...t, speaker: t.producerId, source: 'prepared', share: t.share || 'family', shareLog: [{ date: t.date, share: t.share || 'family' }] };
      state.talks.push(talk);
      await addOrganized(talk, { rulesOnly: true }); // 撮影のたびに同じ「朝の状態」になるように
    }
    // 前から聞いてあった質問（例：町に作る人がいない作物）。これも規則だけで
    for (const q of reg.seed_questions || []) await ask({ askerId: q.askerId, text: q.text, date: q.date, rulesOnly: true });
    save();
  }

  async function load() {
    if (file && existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.version === VERSION) {
        counter = saved.counter;
        state = saved.state;
        return;
      }
    }
    await reset(); // 古い形の記録は使わない
  }

  function askListFor(producerId) {
    return state.questions.filter((q) => q.status === '本人に聞く' && q.toId === producerId);
  }

  function notesFor(viewer) {
    return state.notes.filter((n) =>
      canSee({ talk: talkOf(n.talkId), viewer, question: n.answersQuestionId ? qOf(n.answersQuestionId) : null }),
    );
  }

  // 本人が話す。questionId があれば、その質問への答えとして残す
  async function talk({ producerId = 'p1', text, questionId = null, hintCrop = null }) {
    const p = producerOf(producerId);
    if (!p) throw new Error('この本人は登録されていません');
    const clean = String(text || '').trim();
    if (!clean) throw new Error('話が空です');
    const q = questionId ? state.questions.find((x) => x.id === questionId && x.status === '本人に聞く' && x.toId === producerId) : null;
    const t = { id: nextId('t'), producerId, date: today(), speaker: producerId, text: clean, source: 'app', share: 'family', shareLog: [{ date: today(), share: 'family' }], answersQuestionId: q ? q.id : null };
    state.talks.push(t);
    // 答えの作物：質問の作物（本人が作っていれば）→ 質問に近いノートの行の作物
    let startCrop = hintCrop && p.crops.includes(hintCrop) ? hintCrop : null; // 聞き返しへの答え
    if (q) {
      // 近いノートは、答える本人が前に話した行だけを手がかりにする（ほかの人の畑の話に引っぱられない）
      const near = (q.relatedIds || []).map((id) => state.notes.find((n) => n.id === id)).find((n) => n && n.producerId === producerId && n.crop !== '畑全体' && p.crops.includes(n.crop));
      startCrop = (q.crop && p.crops.includes(q.crop) ? q.crop : null) || near?.crop || null;
    }
    const { newLines, newTasks, by } = await addOrganized(t, { questionId: q?.id, startCrop });
    if (q) {
      q.status = '答えあり';
      q.answeredAt = t.date;
      q.answerTalkId = t.id;
      q.answerNoteIds = newLines.map((l) => l.id);
    }
    // 聞き返しに答えた直後は、続けて抜けを聞かない（届いている質問だけ聞く）。本人を追い立てない
    const answeringGap = !!hintCrop && !q;
    const pending = askListFor(producerId);
    const next = answeringGap && pending.length === 0 ? null : await brain.followup({ askList: pending, newTasks, newLines, successorName: '' });
    if (next && next.questionId) next.text = await brain.rephrase(qOf(next.questionId), {});
    save();
    const asker = q ? viewerOf(q.askerId) : null;
    return { talk: t, newLines, newTasks, answeredQuestion: q || null, askerLabel: asker?.label || null, followup: next, by: [by, next?.by].filter(Boolean) };
  }

  // 見せる範囲を本人が決める（話ごと）
  function setShare({ producerId, talkId, share }) {
    if (!SHARE_KEYS.includes(share)) throw new Error('見せる範囲が正しくありません');
    const t = talkOf(talkId);
    if (!t || t.producerId !== producerId) throw new Error('話が見つかりません'); // 自分の話だけ
    if (t.share !== share) {
      t.share = share;
      t.shareLog = [...(t.shareLog || []), { date: today(), share }]; // 変えた記録（本人が決めた日と範囲）
      save();
    }
    return { talkId, share, shareLog: t.shareLog };
  }

  // 本人が「今はわからん」→ その質問はその本人のリストの最後へ回す
  function later({ producerId, questionId }) {
    const i = state.questions.findIndex((x) => x.id === questionId && x.toId === producerId); // 自分あての質問だけ
    if (i < 0) throw new Error('質問が見つかりません');
    const [q] = state.questions.splice(i, 1);
    q.laterCount = (q.laterCount || 0) + 1;
    state.questions.push(q);
    save();
    return q;
  }

  // 継ぐ人・新人が聞く。見えるノートにあれば本人の言葉で、無ければいちばん近い本人1人に聞く
  async function ask({ askerId = 'p2', text, date = null, rulesOnly = false }) {
    const v = viewerOf(askerId);
    if (!v) throw new Error('この人は登録されていません');
    const clean = String(text || '').trim();
    if (!clean) throw new Error('質問が空です');
    const result = await brain.answer(clean, { notes: notesFor(v), producers, viewer: v, crops }, { rulesOnly });
    const q = {
      id: nextId('q'),
      date: date || today(),
      askerId,
      askerVoice: v.voiceLabel,
      text: clean,
      crop: result.crop || null,
      status: 'ノートにあった',
      sources: result.sources || [],
      noteIds: (result.sources || []).flatMap((s) => s.noteIds),
      relatedIds: (result.related || []).map((l) => l.id),
      missing: result.missing || null,
      toId: null,
      toReasons: [],
      by: result.by ? [result.by] : [],
    };
    if (!result.answered) {
      const relatedProducerIds = [...new Set((result.related || []).map((l) => l.producerId))];
      const r = routeTo(clean, { producers, viewer: v, crops, relatedProducerIds });
      q.toId = r.producerId;
      q.toReasons = r.reasons;
      q.status = r.producerId ? '本人に聞く' : '聞ける人がいない';
    }
    state.questions.push(q);
    save();
    return q;
  }

  function setDone({ producerId, taskId, done }) {
    const t = state.tasks.find((x) => x.id === taskId && x.producerId === producerId); // 自分の作業だけ
    if (!t) throw new Error('作業カードが見つかりません');
    t.done = !!done;
    t.doneAt = done ? today() : null;
    save();
    return t;
  }

  // 町の画面：数だけ。言葉は本人が「町にも」とした話だけ。質問した人の名前は出さない
  function townStats() {
    const districts = [...new Set(producers.map((p) => p.district))];
    const byDistrict = districts.map((d) => {
      const ids = producers.filter((p) => p.district === d).map((p) => p.id);
      const notes = state.notes.filter((n) => ids.includes(n.producerId));
      return {
        district: d,
        producers: ids.length,
        talks: state.talks.filter((t) => ids.includes(t.producerId)).length,
        lines: notes.length,
        shared: notes.filter((n) => shareOf(talkOf(n.talkId)) !== 'family').length,
      };
    });
    const cropNames = [...new Set([...producers.flatMap((p) => p.crops), ...state.questions.map((q) => q.crop).filter(Boolean)])];
    const byCrop = cropNames.map((c) => ({
      crop: c,
      growers: producers.filter((p) => p.crops.includes(c)).length,
      lines: state.notes.filter((n) => n.crop === c).length,
      asked: state.questions.filter((q) => q.crop === c).length,
      waiting: state.questions.filter((q) => q.crop === c && q.status === '本人に聞く').length,
      noOne: state.questions.filter((q) => q.crop === c && q.status === '聞ける人がいない').length,
    }));
    const count = (s) => state.questions.filter((q) => q.status === s).length;
    const shares = Object.fromEntries(SHARE_KEYS.map((k) => [k, state.notes.filter((n) => shareOf(talkOf(n.talkId)) === k).length]));
    return {
      producers: producers.length,
      trainers: producers.filter((p) => p.takesTrainees).length,
      newcomers: viewers.filter((v) => v.role === 'newcomer').length,
      talks: state.talks.length,
      lines: state.notes.length,
      shares,
      questions: {
        total: state.questions.length,
        inNote: count('ノートにあった'),
        answered: count('答えあり'),
        waiting: count('本人に聞く'),
        noOne: count('聞ける人がいない'),
      },
      noOneList: state.questions.filter((q) => q.status === '聞ける人がいない').map((q) => ({ date: q.date, crop: q.crop, text: q.text })),
      byDistrict,
      byCrop,
    };
  }

  function ctx() {
    return {
      mode: brain.mode(),
      today: today(),
      town: { name: town.name, section: town.section },
      shareNames: SHARE,
      producers: producers.map(({ id, label, district, years, crops: c, takesTrainees }) => ({ id, label, district, years, crops: c, takesTrainees: !!takesTrainees })),
      viewers: viewers.map(({ id, label, title, role, district }) => ({ id, label, title, role, district })),
    };
  }

  // 見る人ごとの中身。as：本人の id／継ぐ人・新人の id／'town'
  function view(as = 'p2') {
    const p = producerOf(as);
    if (p) {
      return {
        role: 'producer',
        me: p,
        talks: state.talks.filter((t) => t.producerId === as),
        notes: state.notes.filter((n) => n.producerId === as),
        tasks: state.tasks.filter((t) => t.producerId === as),
        questions: state.questions.filter((q) => q.toId === as && (q.status === '本人に聞く' || q.status === '答えあり')),
        ctx: ctx(),
      };
    }
    const v = viewerOf(as);
    if (v) {
      const notes = notesFor(v);
      const ids = new Set(notes.map((n) => n.talkId));
      return {
        role: v.role,
        me: v,
        talks: state.talks.filter((t) => ids.has(t.id)),
        notes,
        questions: state.questions.filter((q) => q.askerId === as),
        ctx: ctx(),
      };
    }
    if (as === 'town') {
      const notes = notesFor(town);
      const ids = new Set(notes.map((n) => n.talkId));
      return { role: 'town', me: { label: town.label }, talks: state.talks.filter((t) => ids.has(t.id)), notes, stats: townStats(), ctx: ctx() };
    }
    throw new Error('見る人が正しくありません');
  }

  // テスト用：全部
  function all() {
    return state;
  }

  // 専用リンクを配る相手（本人・継ぐ人・新人・町）
  function people_() {
    return [
      ...viewers.map((v) => ({ id: v.id, label: v.label, role: v.role, title: v.title })),
      ...producers.map((p) => ({ id: p.id, label: p.label, role: 'producer', title: `${p.district}・農業${p.years}年` })),
      { id: 'town', label: town.label, role: 'town', title: `${town.name} ${town.section}` },
    ];
  }

  return { load, reset, talk, ask, later, setDone, setShare, view, all, askListFor, people: people_, isProducer: (id) => !!producerOf(id), isViewer: (id) => !!viewerOf(id) };
}
