// 「聞き手」と「まとめ役」。Claude をつないだら Claude に、つないでいなければ見本の規則に任せる。
// どちらでも守ること：本人の言葉は書き換えない／ノートに無いことは答えない／農業の助言はしない。

import * as rules from './rules.mjs';
import * as region from './region.mjs';
import * as claude from './claude.mjs';

export function mode() {
  return claude.enabled() ? 'claude' : '見本';
}

// 画面の端に出す「役：だれが働いたか」。Claude が失敗して規則に戻ったときは「見本」と出す
const MODEL_NAMES = { 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-haiku-5-5': 'Claude Haiku 5.5', 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-fable-5-1': 'Claude Fable 5.1' };
function by(role, model) {
  return { role, by: model ? MODEL_NAMES[model] || model : '見本（未接続）' };
}

// 話 → ノートの行と作業カード
//   rulesOnly：用意した架空の話を読み込むとき。いつも同じ結果にするため規則だけで整理する（Claude を呼ばない）
export async function organize(talk, ctx, { rulesOnly = false } = {}) {
  if (!rulesOnly && claude.enabled()) {
    try {
      return { ...(await claude.organize(talk, ctx)), by: by('整理', claude.stats().models.main) };
    } catch (e) {
      console.error('Claude のまとめに失敗したので見本の規則で続けます：', e.message);
    }
  }
  return { ...rules.organizeTalk(talk, ctx), by: by('整理', null) };
}

// 継ぐ人・新人の質問 → 見えるノートの中に答えがあれば、近い人の言葉から順に。無ければ答えない
//   args = { notes, producers, viewer, crops }
export async function answer(questionText, args, { rulesOnly = false } = {}) {
  if (!rulesOnly && claude.enabled()) {
    try {
      return { ...(await claude.answer(questionText, args)), by: by('照合', claude.stats().models.main) };
    } catch (e) {
      console.error('Claude の照合に失敗したので見本の規則で続けます：', e.message);
    }
  }
  return { ...region.findAcross(questionText, args), by: by('照合', null) };
}

// 本人への聞き返し（1回に1つ）
export async function followup(args) {
  if (claude.enabled() && args.askList.length === 0) {
    try {
      const f = await claude.followup(args);
      return f && { ...f, by: by('聞き返し', claude.stats().models.light) };
    } catch (e) {
      console.error('Claude の聞き返しに失敗したので見本の規則で続けます：', e.message);
    }
  }
  const f = rules.pickFollowup(args);
  // 届いた質問を伝えるだけのときは、AI の働きとしては出さない
  return f && (f.type === '継ぐ人の質問' ? f : { ...f, by: by('聞き返し', null) });
}

// 継ぐ人の質問を、本人に伝わる言い方にする（見本では、そのまま伝える）
export async function rephrase(question, ctx) {
  if (claude.enabled()) {
    try {
      return await claude.rephrase(question, ctx);
    } catch (e) {
      console.error('Claude の言い換えに失敗したので、質問をそのまま伝えます：', e.message);
    }
  }
  return `${question.askerVoice}が聞きたいそうです。「${question.text}」`;
}
