// 町の担当者の画面「地域の引き継ぎ帳」：数だけを見る。
// 言葉が見えるのは、本人が「町にも」とした話だけ。質問した人の名前は出さない。人を評価しない。
import { api, esc, when, poll, KEY, noKey } from '/common.js';
import { paintMode, sizeToggle } from '/common.js';

const main = document.getElementById('main');
sizeToggle();
let st = null;

const prod = (id) => st.ctx.producers.find((p) => p.id === id) || { label: '本人', district: '' };

function render() {
  const s = st.stats;
  const q = s.questions;
  document.getElementById('whoTitle').textContent = `${st.ctx.town.name} ${st.ctx.town.section}`;
  paintMode(st.ctx.mode === 'claude' ? '整理：Claude' : '整理：見本（Claude 未接続）');
  const town = st.notes
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(
      (n) => `<div class="note"><div class="quote">${esc(n.quote)}</div>
      <div class="meta">${esc(when(n.date, st.ctx.today))}・${esc(prod(n.producerId).label)}（${esc(prod(n.producerId).district)}）・${esc(n.crop)}</div></div>`,
    )
    .join('');
  const today = st.ctx.today;
  const d = new Date(today + 'T00:00:00+09:00');
  // 先頭の一行：聞ける人がいない作物（質問はあるのに、町に作っている農家さんのノートが無い）
  const gaps = s.byCrop.filter((c) => c.growers === 0 && c.noOne > 0);
  const gapText = gaps.length ? gaps.map((c) => `${esc(c.crop)}（${c.noOne}）`).join('・') : 'いまはありません';
  main.innerHTML = `<div class="print-only print-head"><b>${esc(st.ctx.town.name)} ${esc(st.ctx.town.section)}</b>　地域の引き継ぎ帳（数だけ）　${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日時点<br>
      <span class="small">この紙に、人の名前・人の評価・農家さんの話の中身は入っていません。人名・地名・数字はすべて架空のデモデータです。</span></div>
    <h1 class="no-print">地域の引き継ぎ帳</h1>
    <p class="lead no-print">町に届くのは数だけです。入力はいりません。</p>
    <p class="headline">聞ける人がいない作物：<b>${gapText}</b></p>

    <h2>作物ごと</h2>
    <div class="scroll-x"><table class="tbl">
      <thead><tr><th>作物</th><th>作る<br>人</th><th>行</th><th>質問</th><th>聞いて<br>いる</th><th>聞ける<br>人なし</th></tr></thead>
      <tbody>${s.byCrop
        .map(
          (c) => `<tr class="${c.growers === 0 ? 'warn' : ''}"><td>${esc(c.crop)}</td><td>${c.growers}人</td><td>${c.lines}</td><td>${c.asked}</td><td>${c.waiting}</td><td>${c.noOne}</td></tr>`,
        )
        .join('')}</tbody>
    </table></div>
    <p class="small muted">色のついた行（印刷では下線）は、質問はあるのに、町の中に作っている農家さんのノートが無い作物です。</p>

    <h2>話と質問</h2>
    <div class="stat four">
      <div><b>${s.producers}</b><span class="small">話している農家さん</span></div>
      <div><b>${s.lines}</b><span class="small">行のノート</span></div>
      <div><b>${q.waiting}</b><span class="small">本人に聞いている質問</span></div>
      <div><b>${gaps.length}</b><span class="small">聞ける人がいない作物</span></div>
    </div>

    <h2>地区ごと</h2>
    <div class="scroll-x"><table class="tbl">
      <thead><tr><th>地区</th><th>農家<br>さん</th><th>話</th><th>行</th><th>見せて<br>いる行</th></tr></thead>
      <tbody>${s.byDistrict
        .map((d) => `<tr><td>${esc(d.district)}</td><td>${d.producers}人</td><td>${d.talks}</td><td>${d.lines}</td><td>${d.shared}</td></tr>`)
        .join('')}</tbody>
    </table></div>

    <h2>聞ける人がいない質問（${s.noOneList.length}）</h2>
    ${
      s.noOneList.length
        ? s.noOneList.map((x) => `<div class="card"><b>${esc(x.text)}</b><div class="small muted">${esc(when(x.date, st.ctx.today))}・${esc(x.crop || '作物の名前なし')}</div></div>`).join('')
        : '<p class="muted">いまはありません。</p>'
    }
    <p class="small muted">つぎて帳は答えを作りません。研修先や先輩農家さんを探すときの手がかりとしてお使いください。</p>

    <div class="no-print">
    <h2>「町にも」と見せてくれた言葉（${st.notes.length}行）</h2>
    <p class="small muted" style="margin:0 0 8px">言葉の権利は話した本人にあります。本人が許した範囲の外（印刷・ほかの資料）には使いません。</p>
    ${town || '<p class="muted">まだありません。</p>'}
    </div>

    <p class="no-print not-shown">出ないもの：質問した人の名前・人の評価や順位・「家族だけ」の話の中身・農家さんごとの点数</p>
    <div class="row no-print"><button class="btn" data-act="print">1枚で印刷（数だけ・A4）</button>
      <span class="small muted" style="align-self:center">上に報告する用。名前と話の中身は入りません</span></div>

    <p class="notice">人名・地名・数字はすべて架空のデモデータです。この画面は人を評価するためのものではありません。農業のやり方の助言もしません。</p>`;
}

main.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="print"]');
  if (b) window.print();
});

async function refresh() {
  const next = await api('/api/state');
  if (next.role !== 'town') throw Object.assign(new Error('この画面は町の担当者のための画面です'), { status: 403 });
  st = next;
  render();
}

if (!KEY) noKey(main);
else {
  try {
    await refresh();
    poll(refresh);
  } catch (e) {
    if (e.status === 401 || e.status === 403) noKey(main);
    else main.innerHTML = `<p>${esc(e.message)}</p>`;
  }
}
