// 「聞き手」と「まとめ役」。Claude をつないだら Claude に、つないでいなければ見本の規則に任せる。
// どちらでも守ること：本人の言葉は書き換えない／ノートに無いことは答えない／農業の助言はしない。

import * as rules from './rules.mjs';
import * as claude from './claude.mjs';

export function mode() {
  return claude.enabled() ? 'claude' : '見本';
}

// 話 → ノートの行と作業カード
export async function organize(talk, ctx) {
  if (claude.enabled()) {
    try {
      return await claude.organize(talk, ctx);
    } catch (e) {
      console.error('Claude のまとめに失敗したので見本の規則で続けます：', e.message);
    }
  }
  return rules.organizeTalk(talk, ctx);
}

// 継ぐ人の質問 → ノートにあれば本人の言葉、無ければ答えない
export async function answer(questionText, lines, ctx) {
  if (claude.enabled()) {
    try {
      return await claude.answer(questionText, lines, ctx);
    } catch (e) {
      console.error('Claude の照合に失敗したので見本の規則で続けます：', e.message);
    }
  }
  return rules.findAnswer(questionText, lines, ctx.crops);
}

// 本人への聞き返し（1回に1つ）
export async function followup(args) {
  if (claude.enabled() && args.askList.length === 0) {
    try {
      return await claude.followup(args);
    } catch (e) {
      console.error('Claude の聞き返しに失敗したので見本の規則で続けます：', e.message);
    }
  }
  return rules.pickFollowup(args);
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
  return `${ctx.successorName}さんが聞きたいそうです。「${question.text}」`;
}
