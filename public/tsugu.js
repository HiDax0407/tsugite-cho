// 継ぐ人・新人の画面：引き継ぎノート／質問する。
// 見えるのは、本人が見せてよいとした話だけ。1行ごとに、誰が・いつ話したかと元の言葉にたどれる。
// 無いことは答えを作らず、いちばん近い本人1人に聞く。
import { api, esc, when, makeListener, MIC_SVG, poll, KEY, noKey } from '/common.js';
import { paintMode, setBy } from '/common.js';

const main = document.getElementById('main');
let st = null;
let demo = null;
let tab = 'note';
let cropFilter = '全部';
let whoFilter = '全員';
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

const me = () => st.me;
const prod = (id) => st.ctx.producers.find((p) => p.id === id) || { label: '本人', district: '' };
const talkOf = (id) => st.talks.find((t) => t.id === id);
const noteOf = (id) => st.notes.find((n) => n.id === id);
const qOf = (id) => st.questions.find((q) => q.id === id);

function noteLine(n) {
  const talk = talkOf(n.talkId);
  const p = prod(n.producerId);
  const q = n.answersQuestionId ? qOf(n.answersQuestionId) : null;
  const isNew = talk?.source === 'app' && n.date === st.ctx.today;
  const tags = [...(n.kind === 'いまの様子' ? ['いまの様子'] : []), ...n.tags];
  let src = '';
  if (openSrc.has(n.id) && talk) {
    const full = esc(talk.text).replace(esc(n.quote), `<mark>${esc(n.quote)}</mark>`);
    src = `<div class="src"><div class="small muted">${esc(when(talk.date, st.ctx.today))}に${esc(p.label)}が話したこと（そのまま）</div>${full}</div>`;
  }
  return `<div class="note ${q ? 'answer' : ''} ${n.kind === 'いまの様子' ? 'state' : ''}" id="note-${n.id}">
    ${q ? `<div class="small" style="color:var(--accent);font-weight:700">あなたの質問への答え：「${esc(q.text)}」${isNew ? '<span class="badge">新しく入りました</span>' : ''}</div>` : ''}
    <div class="quote">${esc(n.quote)}</div>
    ${tags.length ? `<div class="chips">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="meta">${esc(when(n.date, st.ctx.today))}の話・${esc(p.label)}（${esc(p.district)}）の言葉
      <button class="linkish" data-act="src" data-id="${n.id}">${openSrc.has(n.id) ? '元の話を閉じる' : '元の話を見る'}</button></div>
    ${src}
  </div>`;
}

// 自分に近い人（家族・研修先）の話から先に
const rank = (n) => (n.producerId === me().familyOf ? 0 : n.producerId === me().mentor ? 1 : 2);

function renderNote() {
  const cropsSeen = [...new Set(st.notes.map((n) => n.crop))];
  const crops = [...cropsSeen.filter((c) => c !== '畑全体'), ...(cropsSeen.includes('畑全体') ? ['畑全体'] : [])];
  const whos = [...new Set(st.notes.map((n) => n.producerId))].sort((a, b) => rank({ producerId: a }) - rank({ producerId: b }));
  const asking = st.questions.filter((q) => q.status === '本人に聞く').length;
  // 今日あたらしく入った行（朝とくらべて増えた分）
  const today = st.notes.filter((n) => n.date === st.ctx.today && talkOf(n.talkId)?.source === 'app').length;
  const shown = cropFilter === '全部' ? crops : [cropFilter];
  const pick = (n) => whoFilter === '全員' || n.producerId === whoFilter;
  const groups = shown
    .map((c) => {
      const lines = st.notes
        .filter((n) => n.crop === c && pick(n))
        .sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date) || a.index - b.index);
      if (!lines.length) return '';
      const seasons = [...new Set(lines.map((l) => l.season))].join('・');
      return `<div class="crop-head"><h2>${esc(c)}</h2><span class="small muted">${esc(seasons)}の話</span></div>${lines.map(noteLine).join('')}`;
    })
    .join('');
  const lead =
    me().role === 'family'
      ? `${esc(prod(me().familyOf).label)}が話したことと、町の農家さんが見せてくれた話です。言葉は話した人のまま。`
      : `${esc(st.ctx.town.name.replace(/（.*?）/, ''))}の農家さんが「地域の新人にも」と見せてくれた話です。言葉は話した人のまま。`;
  main.innerHTML = `<h1>引き継ぎノート</h1>
    <p class="lead">${lead}</p>
    <div class="stat">
      <div><b>${whos.length}</b><span class="small">人の農家さん</span></div>
      <div><b>${st.notes.length}</b><span class="small">行のノート${today ? `<br><span class="badge" style="margin:2px 0 0">今日 +${today}</span>` : ''}</span></div>
      <div><b>${asking}</b><span class="small">本人に聞いている</span></div>
    </div>
    <div class="chips" style="margin-top:14px">${['全部', ...crops]
      .map((c) => `<button class="chip ${c === cropFilter ? 'on' : ''}" data-act="crop" data-crop="${esc(c)}">${esc(c)}</button>`)
      .join('')}</div>
    <div class="chips">${['全員', ...whos]
      .map((id) => `<button class="chip ${id === whoFilter ? 'on' : ''}" data-act="who" data-who="${esc(id)}">${esc(id === '全員' ? '全員' : prod(id).label)}</button>`)
      .join('')}</div>
    ${groups || '<p class="muted">この組み合わせの話はまだありません。</p>'}
    <p class="notice">人名・地名・数字はすべて架空のデモデータです。このノートは農家さんの話の記録で、農業のやり方の助言ではありません。</p>`;
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
      <div class="meta">${esc(when(n.date, st.ctx.today))}の話・${esc(prod(n.producerId).label)} <button class="linkish" data-act="goto" data-id="${n.id}">ノートで見る</button></div></div>`,
    )
    .join('');
}

// 答えのある人ごとに、近い順で（なぜ近いかも見せる）
function sourcesHtml(q) {
  return (q.sources || [])
    .map(
      (s, i) => `<div class="who-head">${i === 0 ? 'いちばん近い人：' : ''}${esc(prod(s.producerId).label)}
        <span class="small">（${esc(s.reasons.join('・'))}）</span></div>${quotesHtml(s.noteIds)}`,
    )
    .join('');
}

function resultHtml(q) {
  if (q.status === 'ノートにあった') {
    const many = (q.sources || []).length > 1;
    return `<div class="card accent"><b>ノートにありました${many ? `（${q.sources.length}人の言葉）` : ''}</b>${sourcesHtml(q)}
      <p class="small muted" style="margin:8px 0 0">AI が答えを作ったのではなく、本人が話した言葉をそのまま出しています。${many ? '畑の場所や作り方で言い方が違うことがあります。近い人から順に並べています。' : ''}</p></div>`;
  }
  const near = q.relatedIds?.length
    ? `<p style="margin:10px 0 0" class="small">近い話はあります：</p>${quotesHtml(q.relatedIds.slice(0, 1))}
       ${q.missing ? `<p class="small" style="margin:4px 0 0">でも、<b>${esc(q.missing)}</b>はまだだれも話していません。</p>` : ''}`
    : '';
  if (q.status === '聞ける人がいない') {
    return `<div class="card accent"><b>聞ける人がまだいません。</b>
      <p class="small" style="margin:6px 0 0">${q.crop ? `「${esc(q.crop)}」を作っている農家さんのノートが、まだこの町にありません。` : 'この質問に近い話をしている農家さんが、まだいません。'}
      AI が答えを作ることはしません。「聞ける人がいない質問」として、町の担当者に<b>数だけ</b>知らせます（あなたの名前は出ません）。</p>${near}</div>`;
  }
  const to = prod(q.toId);
  return `<div class="card accent"><b>まだだれのノートにもありません。${esc(to.label)}に聞きます。</b>
    <p class="small" style="margin:6px 0 0">${esc(to.label)}を選んだわけ：${esc((q.toReasons || []).join('・'))}。${esc(to.label)}が次に話すとき、この質問を聞きます。ほかの人には届きません。</p>${near}</div>`;
}

function renderAsk() {
  const answered = st.questions.filter((q) => q.status === '答えあり').reverse();
  const asking = st.questions.filter((q) => q.status === '本人に聞く');
  const noOne = st.questions.filter((q) => q.status === '聞ける人がいない').reverse();
  const inNote = st.questions.filter((q) => q.status === 'ノートにあった').reverse();
  const s = seen();
  const samples = demo?.sample_questions_by?.[me().id] || demo?.sample_questions || [];
  main.innerHTML = `<h1>質問する</h1>
    <p class="lead">ノートにあれば、話した人の言葉で答えます。無ければ答えを作らず、いちばん近い農家さん1人に聞きます。</p>
    <div class="card">
      <textarea id="q" rows="2" placeholder="例：かぼちゃはいつとればいいですか？">${esc(draft)}</textarea>
      <div class="row" style="margin-top:8px">
        <button class="btn primary" data-act="ask" style="flex:1">聞く</button>
        ${listener ? `<button class="btn ${listening ? 'primary' : ''}" data-act="mic" aria-label="声で聞く">${MIC_SVG.replace(/44/g, '22')}${listening ? '終わる' : '声で'}</button>` : ''}
      </div>
      <div class="chips" style="margin-top:10px"><span class="small muted">見本：</span>${samples
        .map((t) => `<button class="chip" data-act="sampleq" data-text="${esc(t)}">${esc(t)}</button>`)
        .join('')}</div>
    </div>
    ${lastResult ? resultHtml(lastResult) : ''}
    ${
      answered.length
        ? `<h2>農家さんから答えが来た</h2>${answered
            .map(
              (q) => `<div class="card"><div class="small muted">${esc(when(q.date, st.ctx.today))}に聞いた ${s.has(q.id) ? '' : '<span class="badge">新しい</span>'}</div>
          <div><b>${esc(q.text)}</b></div>
          <div class="small muted" style="margin-top:6px">${esc(when(q.answeredAt, st.ctx.today))}、${esc(prod(q.toId).label)}が話して答えました：</div>${quotesHtml(q.answerNoteIds)}</div>`,
            )
            .join('')}`
        : ''
    }
    <h2>農家さんに聞いている（${asking.length}）</h2>
    ${
      asking.length
        ? asking
            .map(
              (q) => `<div class="card"><div class="small muted">${esc(prod(q.toId).label)}に聞いています</div><b>${esc(q.text)}</b>
          ${q.missing ? `<div class="small muted">まだ聞いていないこと：${esc(q.missing)}</div>` : ''}</div>`,
            )
            .join('')
        : `<p class="muted">いまはありません。</p>`
    }
    ${noOne.length ? `<h2>聞ける人がいない（${noOne.length}）</h2>${noOne.map((q) => `<div class="card"><b>${esc(q.text)}</b><div class="small muted">町の担当者に数だけ知らせています</div></div>`).join('')}` : ''}
    ${inNote.length ? `<h2>ノートにあった質問</h2>${inNote.map((q) => `<div class="card"><b>${esc(q.text)}</b>${sourcesHtml(q)}</div>`).join('')}` : ''}`;
  markSeen(answered.map((q) => q.id));
}

function render() {
  if (!st) return;
  document.getElementById('who').textContent = `${me().label}の画面`;
  document.getElementById('whoTitle').textContent = me().title || '';
  document.title = `つぎて帳｜${me().label}`;
  paintMode(st.ctx.mode === 'claude' ? '整理：Claude' : '整理：見本（Claude 未接続）');
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  if (tab === 'note') renderNote();
  else renderAsk(); // 答えが来た質問は、ここで「見た」になる
  const s = seen();
  const fresh = st.questions.filter((q) => q.status === '答えあり' && !s.has(q.id)).length;
  document.getElementById('askBadge').innerHTML = fresh ? `<span class="badge">${fresh}</span>` : '';
}

async function refresh() {
  const next = await api('/api/state');
  if (next.role !== 'family' && next.role !== 'newcomer') throw Object.assign(new Error('この画面は継ぐ人・新人のための画面です'), { status: 403 });
  st = next;
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
  } else if (act === 'who') {
    whoFilter = b.dataset.who;
    render();
  } else if (act === 'goto') {
    tab = 'note';
    cropFilter = '全部';
    whoFilter = '全員';
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
    setBy(lastResult.by);
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

if (!KEY) noKey(main);
else {
  try {
    demo = await api('/api/demo');
    await refresh();
    // 本人が答えたら、こちらにも届く（入力中は描き直さない）
    poll(async () => {
      if (listening || document.activeElement?.id === 'q') return;
      await refresh();
    });
  } catch (e) {
    if (e.status === 401 || e.status === 403) noKey(main);
    else main.innerHTML = `<p>${esc(e.message)}</p>`;
  }
}
