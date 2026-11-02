// 継ぐ人（健太さん）の画面：引き継ぎノート／質問する。
// ノートの1行ごとに「いつの話か」と本人の元の言葉にたどれる。無いことは答えを作らず本人に聞く。
import { api, esc, when, makeListener, MIC_SVG, poll } from '/common.js';

const main = document.getElementById('main');
let st = null;
let demo = null;
let tab = 'note';
let cropFilter = '全部';
let openSrc = new Set();
let lastResult = null;
let focusNote = null;
let draft = '';
let listening = false;

const SEEN_KEY = 'tsugite-seen-answers';
function seen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
function markSeen(ids) {
  try {
    const s = seen();
    ids.forEach((i) => s.add(i));
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s]));
  } catch {}
}

const listener = makeListener({
  onText(t) {
    draft = t;
    const el = document.getElementById('q');
    if (el) el.value = t;
  },
  onEnd(t) {
    draft = (t || draft).trim();
    listening = false;
    render();
  },
});

const P = () => st.ctx.producerName; // 山野
const S = () => st.ctx.successorName; // 健太
const talkOf = (id) => st.talks.find((t) => t.id === id);
const noteOf = (id) => st.notes.find((n) => n.id === id);
const qOf = (id) => st.questions.find((q) => q.id === id);

function noteLine(n) {
  const talk = talkOf(n.talkId);
  const q = n.answersQuestionId ? qOf(n.answersQuestionId) : null;
  const isNew = talk?.source === 'app' && n.date === st.ctx.today;
  const tags = [...(n.kind === 'いまの様子' ? ['いまの様子'] : []), ...n.tags];
  let src = '';
  if (openSrc.has(n.id) && talk) {
    const full = esc(talk.text).replace(esc(n.quote), `<mark>${esc(n.quote)}</mark>`);
    src = `<div class="src"><div class="small muted">${esc(when(talk.date, st.ctx.today))}に${esc(P())}さんが話したこと（そのまま）</div>${full}</div>`;
  }
  return `<div class="note ${q ? 'answer' : ''} ${n.kind === 'いまの様子' ? 'state' : ''}" id="note-${n.id}">
    ${q ? `<div class="small" style="color:var(--accent);font-weight:700">${esc(S())}さんの質問への答え：「${esc(q.text)}」${isNew ? '<span class="badge">新しく入りました</span>' : ''}</div>` : ''}
    <div class="quote">${esc(n.quote)}</div>
    ${tags.length ? `<div class="chips">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="meta">${esc(when(n.date, st.ctx.today))}の話・${esc(P())}さんの言葉
      <button class="linkish" data-act="src" data-id="${n.id}">${openSrc.has(n.id) ? '元の話を閉じる' : '元の話を見る'}</button></div>
    ${src}
  </div>`;
}

function renderNote() {
  const crops = [...st.ctx.crops, '畑全体'];
  const asking = st.questions.filter((q) => q.status === '本人に聞く').length;
  const shown = cropFilter === '全部' ? crops : [cropFilter];
  const groups = shown
    .map((c) => {
      const lines = st.notes.filter((n) => n.crop === c).sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);
      if (!lines.length) return '';
      const seasons = [...new Set(lines.map((l) => l.season))].join('・');
      return `<div class="crop-head"><h2>${esc(c)}</h2><span class="small muted">${esc(seasons)}の話</span></div>${lines.map(noteLine).join('')}`;
    })
    .join('');
  main.innerHTML = `<h1>引き継ぎノート</h1>
    <p class="lead">${esc(P())}さんが話したことを、作物ごとに並べています。言葉は${esc(P())}さんのまま。</p>
    <div class="stat">
      <div><b>${st.talks.length}</b><span class="small">回の話</span></div>
      <div><b>${st.notes.length}</b><span class="small">行のノート</span></div>
      <div><b>${asking}</b><span class="small">本人に聞いている</span></div>
    </div>
    <div class="chips" style="margin-top:14px">${['全部', ...crops]
      .map((c) => `<button class="chip ${c === cropFilter ? 'on' : ''}" data-act="crop" data-crop="${esc(c)}">${esc(c)}</button>`)
      .join('')}</div>
    ${groups}
    <p class="notice">人名・地名・数字はすべて架空のデモデータです。このノートは${esc(P())}さんの話の記録で、農業のやり方の助言ではありません。</p>`;
  if (focusNote) {
    const el = document.getElementById(`note-${focusNote}`);
    focusNote = null;
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.style.background = 'var(--accent-soft)';
      setTimeout(() => (el.style.background = ''), 1800);
    }
  }
}

function quotesHtml(ids) {
  return ids
    .map(noteOf)
    .filter(Boolean)
    .map(
      (n) => `<div class="note answer"><div class="quote">${esc(n.quote)}</div>
      <div class="meta">${esc(when(n.date, st.ctx.today))}の話 <button class="linkish" data-act="goto" data-id="${n.id}">ノートで見る</button></div></div>`,
    )
    .join('');
}

function resultHtml(q) {
  if (q.status === 'ノートにあった') {
    return `<div class="card accent"><b>ノートにありました（${esc(P())}さんの言葉）</b>${quotesHtml(q.noteIds)}
      <p class="small muted" style="margin:6px 0 0">AI が答えを作ったのではなく、${esc(P())}さんが話した言葉をそのまま出しています。</p></div>`;
  }
  const near = q.relatedIds?.length
    ? `<p style="margin:10px 0 0" class="small">近い話はあります：</p>${quotesHtml(q.relatedIds.slice(0, 1))}
       ${q.missing ? `<p class="small" style="margin:4px 0 0">でも、<b>${esc(q.missing)}</b>はまだ聞いていません。</p>` : ''}`
    : '';
  return `<div class="card accent"><b>まだ聞いていません。${esc(P())}さんに聞きます。</b>
    <p class="small" style="margin:6px 0 0">「本人に聞くリスト」に入れました。${esc(P())}さんが次に話すとき、この質問を1つずつ聞きます。</p>${near}</div>`;
}

function renderAsk() {
  const answered = st.questions.filter((q) => q.status === '答えあり').reverse();
  const asking = st.questions.filter((q) => q.status === '本人に聞く');
  const inNote = st.questions.filter((q) => q.status === 'ノートにあった').reverse();
  const s = seen();
  main.innerHTML = `<h1>質問する</h1>
    <p class="lead">ノートにあれば${esc(P())}さんの言葉で答えます。無ければ答えを作らず、${esc(P())}さんに聞きます。</p>
    <div class="card">
      <textarea id="q" rows="2" placeholder="例：かぼちゃはいつとればいいですか？">${esc(draft)}</textarea>
      <div class="row" style="margin-top:8px">
        <button class="btn primary" data-act="ask" style="flex:1">聞く</button>
        ${listener ? `<button class="btn ${listening ? 'primary' : ''}" data-act="mic" aria-label="声で聞く">${MIC_SVG.replace(/44/g, '22')}${listening ? '終わる' : '声で'}</button>` : ''}
      </div>
      <div class="chips" style="margin-top:10px"><span class="small muted">見本：</span>${(demo?.sample_questions || [])
        .map((t) => `<button class="chip" data-act="sampleq" data-text="${esc(t)}">${esc(t)}</button>`)
        .join('')}</div>
    </div>
    ${lastResult ? resultHtml(lastResult) : ''}
    ${
      answered.length
        ? `<h2>${esc(P())}さんから答えが来た</h2>${answered
            .map(
              (q) => `<div class="card"><div class="small muted">${esc(when(q.date, st.ctx.today))}に聞いた ${s.has(q.id) ? '' : '<span class="badge">新しい</span>'}</div>
          <div><b>${esc(q.text)}</b></div>
          <div class="small muted" style="margin-top:6px">${esc(when(q.answeredAt, st.ctx.today))}、${esc(P())}さんが話して答えました：</div>${quotesHtml(q.answerNoteIds)}</div>`,
            )
            .join('')}`
        : ''
    }
    <h2>本人に聞くリスト（${asking.length}）</h2>
    ${
      asking.length
        ? asking
            .map(
              (q, i) => `<div class="card"><div class="small muted">${i === 0 ? `次に${esc(P())}さんが話すとき、最初に聞きます` : `${i + 1}番目に聞きます`}</div><b>${esc(q.text)}</b>
          ${q.missing ? `<div class="small muted">まだ聞いていないこと：${esc(q.missing)}</div>` : ''}</div>`,
            )
            .join('')
        : `<p class="muted">いまはありません。</p>`
    }
    ${inNote.length ? `<h2>ノートにあった質問</h2>${inNote.map((q) => `<div class="card"><b>${esc(q.text)}</b>${quotesHtml(q.noteIds)}</div>`).join('')}` : ''}`;
  markSeen(answered.map((q) => q.id));
}

function render() {
  if (!st) return;
  document.getElementById('mode').textContent = st.ctx.mode === 'claude' ? '整理：Claude' : '整理：見本（Claude 未接続）';
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  if (tab === 'note') renderNote();
  else renderAsk(); // 答えが来た質問は、ここで「見た」になる
  const s = seen();
  const fresh = st.questions.filter((q) => q.status === '答えあり' && !s.has(q.id)).length;
  document.getElementById('askBadge').innerHTML = fresh ? `<span class="badge">${fresh}</span>` : '';
}

async function refresh() {
  st = await api('/api/state');
  render();
}

main.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'src') {
    openSrc.has(b.dataset.id) ? openSrc.delete(b.dataset.id) : openSrc.add(b.dataset.id);
    render();
  } else if (act === 'crop') {
    cropFilter = b.dataset.crop;
    render();
  } else if (act === 'goto') {
    tab = 'note';
    cropFilter = '全部';
    focusNote = b.dataset.id;
    openSrc.add(b.dataset.id);
    render();
  } else if (act === 'sampleq') {
    draft = b.dataset.text;
    render();
  } else if (act === 'mic') {
    if (listening) listener.stop();
    else {
      listening = true;
      draft = '';
      render();
      listener.start();
    }
  } else if (act === 'ask') {
    const text = document.getElementById('q').value.trim();
    if (!text) return;
    lastResult = await api('/api/ask', { text });
    draft = '';
    await refresh();
  }
});

main.addEventListener('input', (e) => {
  if (e.target.id === 'q') draft = e.target.value;
});

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  render();
  window.scrollTo(0, 0);
});

demo = await api('/api/demo');
await refresh();
// 本人が答えたら、こちらにも届く（入力中は描き直さない）
poll(async () => {
  if (listening || document.activeElement?.id === 'q') return;
  await refresh();
});
