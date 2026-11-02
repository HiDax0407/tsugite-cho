// 町の担当者の画面「地域の引き継ぎ帳」：数だけを見る。
// 言葉が見えるのは、本人が「町にも」とした話だけ。質問した人の名前は出さない。人を評価しない。
import { api, esc, when, poll, KEY, noKey } from '/common.js';
import { paintMode } from '/common.js';

const main = document.getElementById('main');
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
  main.innerHTML = `<h1>地域の引き継ぎ帳</h1>
    <p class="lead">農家さんの話がどれだけ残り、新しく農業を始めた人の質問がどこへ流れているかを、<b>数で</b>見ます。
    言葉が見えるのは、本人が「町にも」とした話だけです。質問した人の名前は出ません。</p>

    <h2>話と質問</h2>
    <div class="stat four">
      <div><b>${s.producers}</b><span class="small">人の農家さんが話している<br>（研修の受け入れ ${s.trainers}）</span></div>
      <div><b>${s.lines}</b><span class="small">行のノート<br>（${s.talks}回の話）</span></div>
      <div><b>${q.inNote}</b><span class="small">ノートで答えが出た質問<br>（本人の手を借りずに）</span></div>
      <div><b>${q.answered}</b><span class="small">本人が話して答えた質問</span></div>
      <div><b>${q.waiting}</b><span class="small">本人に聞いている質問</span></div>
      <div><b>${q.noOne}</b><span class="small">聞ける人がいない質問</span></div>
      <div><b>${s.shares.region + s.shares.town}</b><span class="small">行を、本人が地域に<br>見せてくれている</span></div>
      <div><b>${s.shares.family}</b><span class="small">行は家族だけ<br>（中身は町にも見えない）</span></div>
    </div>

    <h2>作物ごと</h2>
    <div class="scroll-x"><table class="tbl">
      <thead><tr><th>作物</th><th>作る人</th><th>行</th><th>質問</th><th>聞いている</th><th>聞ける人なし</th></tr></thead>
      <tbody>${s.byCrop
        .map(
          (c) => `<tr class="${c.growers === 0 ? 'warn' : ''}"><td>${esc(c.crop)}</td><td>${c.growers}人</td><td>${c.lines}</td><td>${c.asked}</td><td>${c.waiting}</td><td>${c.noOne}</td></tr>`,
        )
        .join('')}</tbody>
    </table></div>
    <p class="small muted">色のついた行は、質問はあるのに、町の中に作っている農家さんのノートが無い作物です。</p>

    <h2>地区ごと</h2>
    <div class="scroll-x"><table class="tbl">
      <thead><tr><th>地区</th><th>農家さん</th><th>話</th><th>行</th><th>見せている行</th></tr></thead>
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

    <h2>「町にも」と見せてくれた言葉（${st.notes.length}行）</h2>
    ${town || '<p class="muted">まだありません。</p>'}

    <p class="notice">人名・地名・数字はすべて架空のデモデータです。この画面は人を評価するためのものではありません。農業のやり方の助言もしません。</p>`;
}

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
