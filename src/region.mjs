// 地域で使うときの決まり：誰の言葉を誰に見せるか／質問をどの本人に届けるか。
// 「最適な答え」を AI が判断することはしない。その場所・その作物でいちばん近い人の言葉を、出どころつきで先に出す。

import { findAnswer, detectCrop } from './rules.mjs';

// 見せる範囲は本人が決める。最初は「家族だけ」
export const SHARE = { family: '家族だけ', region: '地域の新人にも', town: '町にも' };
export const SHARE_KEYS = Object.keys(SHARE);

export function shareOf(talk) {
  return SHARE_KEYS.includes(talk?.share) ? talk.share : 'family';
}

// viewer：{ id, role: 'family'|'newcomer'|'town', familyOf?, mentor?, district? }
// question：このノートの行が答えになった質問（聞いた本人には、範囲にかかわらず届く）
export function canSee({ talk, viewer, question = null }) {
  const share = shareOf(talk);
  if (viewer.role === 'town') return share === 'town';
  if (viewer.role === 'family' && talk.producerId === viewer.familyOf) return true;
  if (question && question.askerId === viewer.id) return true;
  return share === 'region' || share === 'town';
}

// 聞く人にとって、その本人がどれだけ近いか（並べる順番と、その理由）
export function closeness(producer, viewer, crop = null) {
  let score = 0;
  const reasons = [];
  if (viewer.role === 'family' && viewer.familyOf === producer.id) {
    score += 100;
    reasons.push('家族');
  }
  if (viewer.mentor === producer.id) {
    score += 60;
    reasons.push('研修先');
  }
  if (crop && producer.crops.includes(crop)) {
    score += 30;
    reasons.push(`${crop}を作っている`);
  }
  if (viewer.district && viewer.district === producer.district) {
    score += 10;
    reasons.push(`同じ${producer.district}`);
  }
  if (producer.years) {
    score += producer.years / 10;
    reasons.push(`農業${producer.years}年`);
  }
  return { score, reasons };
}

// 見えるノートの行を本人ごとに照らし、答えのある人を近い順に並べる。言葉は作らない
export function findAcross(questionText, { notes, producers, viewer, crops }) {
  const crop = detectCrop(questionText, crops);
  const byProducer = producers.map((p) => {
    const mine = notes.filter((n) => n.producerId === p.id);
    const r = mine.length ? findAnswer(questionText, mine, crops) : { answered: false, related: [] };
    return { producer: p, r, near: closeness(p, viewer, crop) };
  });
  byProducer.sort((a, b) => b.near.score - a.near.score);
  const sources = byProducer
    .filter((x) => x.r.answered)
    .map((x) => ({ producerId: x.producer.id, noteIds: x.r.quotes.map((l) => l.id), reasons: x.near.reasons }));
  const related = byProducer.flatMap((x) => x.r.related || []).slice(0, 3);
  const missing = byProducer.map((x) => x.r.missing).find(Boolean) || null;
  return { crop, answered: sources.length > 0, sources, related, missing };
}

// ノートに無いとき、誰に聞くか（1人だけに届ける）。聞ける人がいなければ null
export function routeTo(questionText, { producers, viewer, crops, relatedProducerIds = [] }) {
  const crop = detectCrop(questionText, crops);
  let candidates;
  if (crop) {
    candidates = producers.filter((p) => p.crops.includes(crop));
  } else {
    candidates = producers.filter(
      (p) => viewer.familyOf === p.id || viewer.mentor === p.id || relatedProducerIds.includes(p.id),
    );
  }
  if (candidates.length === 0) return { crop, producerId: null, reasons: [] };
  const ranked = candidates
    .map((p) => {
      const near = closeness(p, viewer, crop);
      if (relatedProducerIds.includes(p.id)) {
        near.score += 5;
        near.reasons.push('近い話をしている');
      }
      return { p, near };
    })
    .sort((a, b) => b.near.score - a.near.score);
  return { crop, producerId: ranked[0].p.id, reasons: ranked[0].near.reasons };
}
