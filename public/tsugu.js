// 継ぐ人・新人の画面：聞く／ノート。最初は「聞く」（次の一手は1つ：押して声で聞くか、見本の質問を押す）。
// 見えるのは、本人が見せてよいとした話だけ。1行ごとに、誰が・いつ話したかと元の言葉にたどれる。
// 無いことは答えを作らず、いちばん近い本人1人に聞く。
import { api, esc, when, makeListener, MIC_SVG, poll, KEY, noKey } from '/common.js';
import { paintMode, setBy, sizeToggle, helpToggle } from '/common.js';

const main = document.getElementById('main');
sizeToggle();
let st = null;
let demo = null;
let tab = 'ask';
// 「使い方」（タブごとに文が違う）
const help = helpToggle(() =>
  tab === 'note'
    ? ['農家さんが『地域の新人にも』と見せてくれた言葉です。', '作物や人で絞れます。', '『元の話を見る』で、話した日と全文が読めます。']
    : ['1 マイクを押して、畑のことを声で聞きます。', '2 ノートにあれば、近い人の言葉がすぐ出ます。', '3 無ければ、いちばん近い農家さん一人に届き、答えがノートに入ります。'],
);
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
    if (draft) ask(draft); // 話し終えたら、そのまま答えを探す（畑で片手で使えるように）
    else render();
  },
});
let seasonFirst = false; // 「いまの時期の話を先に」

const me = () => st.me;
const prod = (id) => st.ctx.producers.find((p) => p.id === id) || { label: '本人', district: '' };
const talkOf = (id) => st.talks.find((t) => t.id === id);
const noteOf = (id) => st.notes.find((n) => n.id === id);
const qOf = (id) => st.questions.find((q) => q.id === id);

// 聞く人にとって、その農家さんがどれだけ近いか（行の左の帯の濃さと、印の言葉）
function nearOf(producerId) {
  const p = prod(producerId);
  if (producerId === me().familyOf) return { cls: 'near-1', label: '家族' };
  if (producerId === me().mentor) return { cls: 'near-1', label: '研修先' };
  if (me().district && p.district === me().district) return { cls: 'near-2', label: `同じ${p.district}` };
  return { cls: 'near-3', label: '' };
}

function noteLine(n) {
  const talk = talkOf(n.talkId);
  const p = prod(n.producerId);
  const near = nearOf(n.producerId);
  const q = n.answersQuestionId ? qOf(n.answersQuestionId) : null;
  const isNew = talk?.source === 'app' && n.date === st.ctx.today;
  const tags = [...(n.kind === 'いまの様子' ? ['いまの様子'] : []), ...n.tags];
  let src = '';
  if (openSrc.has(n.id) && talk) {
    const full = esc(talk.text).replace(esc(n.quote), `<mark>${esc(n.quote)}</mark>`);
    src = `<div class="src"><div class="small muted">${esc(when(talk.date, st.ctx.today))}に${esc(p.label)}が話したこと（そのまま）</div>${full}</div>`;
  }
  return `<div class="note ${near.cls} ${q ? 'answer' : ''} ${n.kind === 'いまの様子' ? 'state' : ''}" id="note-${n.id}">
    ${q ? `<div class="small" style="color:var(--accent);font-weight:700">あなたの質問への答え：「${esc(q.text)}」${isNew ? '<span class="badge">新しく入りました</span>' : ''}</div>` : ''}
    <div class="quote">${esc(n.quote)}</div>
    ${tags.length ? `<div class="chips">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="meta">${esc(when(n.date, st.ctx.today))}の話・<b>${esc(p.label)}</b>（${esc(p.district)}）の言葉${near.label ? `<span class="chip near">${esc(near.label)}</span>` : ''}
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
  const asking = st.questions.filter((q) => q.status === '本人に聞く');
  // 今日あたらしく入った行（朝とくらべて増えた分）
  const today = st.notes.filter((n) => n.date === st.ctx.today && talkOf(n.talkId)?.source === 'app').length;
  const shown = cropFilter === '全部' ? crops : [cropFilter];
  const pick = (n) => whoFilter === '全員' || n.producerId === whoFilter;
  // いまの時期（今月）の話を先に：作物の中でも、作物の並びでも、今月の話が多いものが上
  const month = Number(st.ctx.today.slice(5, 7));
  const isNow = (l) => l.season.startsWith(`${month}月`);
  const nowCount = (c) => st.notes.filter((n) => n.crop === c && pick(n) && isNow(n)).length;
  const order = seasonFirst ? [...shown].sort((a, b) => nowCount(b) - nowCount(a)) : shown;
  const groups = order
    .map((c) => {
      const lines = st.notes
        .filter((n) => n.crop === c && pick(n))
        .sort((a, b) => (seasonFirst ? isNow(b) - isNow(a) : 0) || rank(a) - rank(b) || a.date.localeCompare(b.date) || a.index - b.index);
      if (!lines.length) return '';
      const seasons = [...new Set(lines.map((l) => l.season))].join('・');
      const nowN = seasonFirst ? nowCount(c) : 0;
      return `<div class="crop-head"><h2>${esc(c)}</h2><span class="small muted">${nowN ? `<b>${month}月の話 ${nowN}行</b>・` : ''}${esc(seasons)}の話</span></div>${lines.map(noteLine).join('')}`;
    })
    .join('');
  // 説明は1文（言葉の権利は話した本人に）
  const lead =
    me().role === 'family'
      ? `${esc(prod(me().familyOf).label)}が話したことと、町の農家さんが見せてくれた言葉が、そのまま並びます（言葉の権利は話した本人に）。`
      : `${esc(st.ctx.town.name.replace(/（.*?）/, ''))}の農家さんが「地域の新人にも」と見せてくれた言葉が、そのまま並びます（言葉の権利は話した本人に）。`;
  // 聞いている質問は数ではなく「川端さんに聞いています（1）」の文で
  const byTo = new Map();
  for (const q of asking) byTo.set(q.toId, (byTo.get(q.toId) || 0) + 1);
  const askingText = [...byTo].map(([id, n]) => `${esc(prod(id).label)}に聞いています（${n}）`).join('・');
  main.innerHTML = `<h1>引き継ぎノート</h1>
    <p class="lead">${lead}</p>
    <div class="stat two">
      <div><b>${whos.length}</b><span class="small">人の農家さん</span></div>
      <div><b>${st.notes.length}</b><span class="small">行のノート${today ? `<br><span class="badge" style="margin:2px 0 0">今日 +${today}</span>` : ''}</span></div>
    </div>
    ${askingText ? `<p class="asking"><b>${askingText}</b><br><span class="small muted">答えが来たら「聞く」に届きます</span></p>` : ''}
    <div class="chips" style="margin-top:14px"><button class="chip ${seasonFirst ? 'on' : ''}" data-act="season" aria-pressed="${seasonFirst}">いまの時期（${month}月）の話を先に</button></div>
    <div class="chips">${['全部', ...crops]
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
    if (!(q.sources || []).length) return `<div class="card accent"><b>この質問に答えていた話は、本人が消しました。</b><p class="small muted" style="margin:6px 0 0">もう一度聞くと、いまのノートから探します。</p></div>`;
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
  if (q.status === '答えあり') {
    // 聞いていた本人が話して答えた。カードはそのまま「答えが来た」に変わる
    return `<div class="card accent"><b>${esc(to.label)}から答えが来ました。</b>${quotesHtml(q.answerNoteIds || [])}
      <p class="small muted" style="margin:8px 0 0">ノートに入りました。次に同じことを聞く人には、ノートから答えが出ます（${esc(to.label)}の手は止まりません）。
      <button class="linkish" data-act="reask" data-text="${esc(q.text)}">もう一度聞いてみる</button></p></div>`;
  }
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
  const big = samples.slice(0, 2); // 押すだけで聞ける見本は2つ。残りは「文字で聞く」の中
  const rest = samples.slice(2);
  // いま聞いた質問の答え。本人が答えたら、同じ場所で「答えが来た」に変わる
  const current = lastResult ? qOf(lastResult.id) || lastResult : null;
  const micLabel = listening ? '聞いています<br><span style="font-size:16px">終わったら押す</span>' : '押して、<br>声で聞く';
  main.innerHTML = `<h1>聞く</h1>
    <p class="lead">農家さんの言葉がそのまま出ます。AI は答えを作りません。</p>
    ${listener ? `<button class="mic ask-mic ${listening ? 'listening' : ''}" data-act="mic" aria-pressed="${listening}" aria-label="押して、声で聞く">${MIC_SVG}${micLabel}</button>` : ''}
    ${big.length ? `<p class="small muted" style="margin:0 0 6px">見本の質問（押すだけで聞けます）</p>` : ''}
    ${big.map((t) => `<button class="btn wide sample" data-act="sampleq" data-text="${esc(t)}">${esc(t)}</button>`).join('')}
    <details class="card" ${listener ? '' : 'open'}><summary>文字で聞く</summary>
      <textarea id="q" rows="2" style="margin-top:10px" placeholder="例：かぼちゃはいつとればいいですか？">${esc(draft)}</textarea>
      <button class="btn primary wide" data-act="ask" style="margin-top:8px">聞く</button>
      ${rest.length ? `<div class="chips" style="margin-top:10px">${rest.map((t) => `<button class="chip" data-act="sampleq" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    </details>
    <div id="result">${current ? resultHtml(current) : ''}</div>
    ${
      answered.length
        ? `<h2>届いた答え</h2>${answered
            .map(
              (q) => `<div class="card"><div class="small muted">${esc(when(q.date, st.ctx.today))}に聞いた ${s.has(q.id) ? '' : '<span class="badge">新しい</span>'}</div>
          <div><b>${esc(q.text)}</b></div>
          <div class="small muted" style="margin-top:6px">${esc(when(q.answeredAt, st.ctx.today))}、${esc(prod(q.toId).label)}が話して答えました：</div>${quotesHtml(q.answerNoteIds)}</div>`,
            )
            .join('')}`
        : ''
    }
    ${
      asking.length
        ? `<h2>聞いていること</h2>${asking
            .map(
              (q) => `<div class="card"><div class="small muted">${esc(prod(q.toId).label)}に聞いています</div><b>${esc(q.text)}</b>
          ${q.missing ? `<div class="small muted">まだ聞いていないこと：${esc(q.missing)}</div>` : ''}</div>`,
            )
            .join('')}`
        : ''
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
  } else if (act === 'season') {
    seasonFirst = !seasonFirst;
    render();
  } else if (act === 'goto') {
    tab = 'note';
    cropFilter = '全部';
    whoFilter = '全員';
    focusNote = b.dataset.id;
    openSrc.add(b.dataset.id);
    lastResult = null; // ノートで見たら、質問の画面は次の質問を聞ける形に戻す
    render();
  } else if (act === 'sampleq') {
    await ask(b.dataset.text); // 見本の質問は、押すだけで聞く
  } else if (act === 'mic') {
    if (listening) listener.stop();
    else {
      listening = true;
      draft = '';
      render();
      listener.start();
    }
  } else if (act === 'ask') {
    await ask(document.getElementById('q').value.trim());
  } else if (act === 'reask') {
    await ask(b.dataset.text); // 答えが来た質問を、もう一度（今度はノートから出る）
  }
});

async function ask(text) {
  if (!text) return;
  lastResult = await api('/api/ask', { text });
  setBy(lastResult.by);
  draft = '';
  await refresh();
  // 答えは、マイクと見本の下に出る。小さい画面でも読めるように、答えの所まで送る
  document.getElementById('result')?.scrollIntoView({ block: 'start' });
}

main.addEventListener('input', (e) => {
  if (e.target.id === 'q') draft = e.target.value;
});

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  help.repaint(); // 開いていれば、そのタブの使い方に入れ替える
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
