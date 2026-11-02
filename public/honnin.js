// 本人（農家さん）の画面：話す／次の作業／話したこと。打つ・覚える操作をさせない。
// 見せる範囲だけは本人が決める（大きなボタン3つから選ぶ。最初は「家族だけ」）。
import { api, esc, speak, makeListener, MIC_SVG, poll, KEY, noKey, when } from '/common.js';
import { paintMode, setBy } from '/common.js';

const main = document.getElementById('main');
let st = null;
let demo = null;
let tab = 'talk';
let phase = 'idle'; // idle → listening → heard → saved
let heard = '';
let reply = null; // 残したあとの返事
let gapQuestion = null; // 抜けの聞き返し（届いた質問がないとき）

const SHARE_HELP = {
  family: '家の人だけが見られます',
  region: '町の新しく農業を始めた人も見られます',
  town: '町の担当者も見られます（数と、この話の言葉）',
};

const listener = makeListener({
  onText(t) {
    heard = t;
    const el = document.getElementById('heard');
    if (el) el.textContent = t;
  },
  onEnd(t) {
    heard = (t || heard).trim();
    phase = heard ? 'heard' : 'idle';
    render();
  },
});

const me = () => st.me;
const askList = () => st.questions.filter((q) => q.status === '本人に聞く');
const currentQuestion = () => askList()[0] || null;
const questionVoice = (q) => `${q.askerVoice}が聞きたいそうです。「${q.text}」`;
const demoAnswers = () => demo?.answers_by?.[me().id] || (me().id === 'p1' ? demo?.answers : null) || {};
const demoFrees = () => demo?.free_talks_by?.[me().id] || (me().id === 'p1' ? demo?.free_talks : null) || [];

function shareButtons(talkId, current) {
  return `<div class="share" role="group" aria-label="見せる範囲">
    ${Object.entries(st.ctx.shareNames)
      .map(
        ([k, name]) => `<button class="btn" data-act="share" data-talk="${esc(talkId)}" data-share="${k}" aria-pressed="${k === current}">
          <span>${esc(name)}<br><span class="small muted">${esc(SHARE_HELP[k])}</span></span></button>`,
      )
      .join('')}
  </div>`;
}

function renderTalk() {
  const q = currentQuestion();
  const left = askList().length;
  let top = '';
  if (phase === 'saved') {
    // 返事だけを見せる（次の質問は返事の中で1つだけ）
  } else if (q) {
    top = `<div class="card accent ask-card">
      <div class="label">${esc(q.askerVoice)}が聞きたいこと${left > 1 ? `（あと${left}つ）` : ''}</div>
      <p class="quote" style="margin:6px 0 12px">${esc(q.text)}</p>
      <div class="row">
        <button class="btn" data-act="hear-q">声で聞く</button>
        <button class="btn ghost" data-act="later">今はわからん</button>
      </div>
    </div>`;
  } else if (gapQuestion) {
    top = `<div class="card accent ask-card"><div class="label">ひとつだけ聞かせてください</div>
      <p style="margin:6px 0 12px">${esc(gapQuestion.text)}</p>
      <button class="btn" data-act="hear-gap">声で聞く</button></div>`;
  } else {
    top = `<h1>今日の畑のこと、<br>話してください</h1><p class="lead">いつもの言葉のままで大丈夫です。</p>`;
  }

  let middle = '';
  if (phase === 'idle' || phase === 'listening') {
    const label = phase === 'listening' ? '聞いています<br><span style="font-size:18px">終わったら押す</span>' : '押して話す';
    middle = listener
      ? `<button class="mic ${phase === 'listening' ? 'listening' : ''}" data-act="mic" aria-label="押して話す">${MIC_SVG}${label}</button>
         <p class="heard" id="heard" aria-live="polite">${esc(heard)}</p>`
      : `<p class="muted">この端末では声の入力が使えません。下の「文字で入れる」から入れてください。</p>`;
  }
  if (phase === 'heard') {
    middle = `<div class="card"><div class="muted small">聞き取った言葉（このまま残します）</div>
      <p class="heard">${esc(heard)}</p>
      <div class="row"><button class="btn primary wide" data-act="save">これで残す</button>
      <button class="btn ghost wide" data-act="retry">言い直す</button></div></div>`;
  }
  if (phase === 'saved' && reply) {
    const t = st.talks.find((x) => x.id === reply.talkId);
    middle = `<div class="card accent" aria-live="polite">${reply.html}
      <button class="btn wide" data-act="hear-reply" style="margin-top:10px">もう一度聞く</button></div>
      <div class="card"><b>この話を、だれに見せますか？</b>
      ${reply.askerLabel ? `<p class="small muted" style="margin:4px 0 0">聞いた${esc(reply.askerLabel)}には、もう届いています。</p>` : ''}
      ${shareButtons(reply.talkId, t?.share || 'family')}</div>
      <button class="btn primary wide" data-act="again">${currentQuestion() ? '次の質問に答える' : 'ほかにも話す'}</button>`;
  }

  const sample = q ? demoAnswers()[q.text] : gapQuestion ? demoAnswers()[gapQuestion.text] : demoFrees()[0];
  // デモ用の見本は、押して話すボタンのすぐ下（質問が届いていても画面の中に収まる）
  const demoLink =
    sample && (phase === 'idle' || phase === 'listening')
      ? `<p class="small muted" style="text-align:center;margin:0 0 10px">デモ用：<button class="linkish" data-act="sample">見本の話を入れる（声の代わり）</button></p>`
      : '';
  const typed = phase === 'saved' ? '' : `
    <details class="card"><summary>文字で入れる</summary>
      <textarea id="typed" rows="3" style="margin-top:10px" placeholder="ここに書いても残せます"></textarea>
      <button class="btn primary wide" data-act="save-typed" style="margin-top:8px">残す</button>
    </details>`;

  main.innerHTML = top + middle + demoLink + typed;
}

function renderTasks() {
  const open = st.tasks.filter((t) => !t.done);
  const done = st.tasks.filter((t) => t.done);
  const typeOrder = { 期限: 0, 続き: 1, 条件: 2 };
  // 急ぐ順（今日・明日・…）→ 種類 → 新しい話から
  open.sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9) || (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9) || b.date.localeCompare(a.date));
  const card = (t) => `<div class="card task ${t.done ? 'done' : ''}">
      <div>
        <div class="when">${esc(t.when)}</div>
        <div class="quote">${esc(t.quote)}</div>
        ${t.context ? `<div class="small muted">（${esc(t.context)}）</div>` : ''}
        <div class="small muted">${esc(t.crop)}・${esc(t.who)}</div>
      </div>
      <button class="btn ${t.done ? 'ghost' : 'primary'} done-btn" data-act="done" data-id="${t.id}" data-done="${t.done ? '0' : '1'}">${t.done ? '戻す' : '済み'}</button>
    </div>`;
  main.innerHTML = `<h1>次の作業</h1>
    <p class="lead">話したことから作りました。終わったら「済み」を押すだけ。</p>
    ${open.map(card).join('') || '<p class="muted">いまは作業がありません。</p>'}
    ${done.length ? `<h2>済んだ作業</h2>${done.map(card).join('')}` : ''}`;
}

// 話したことと、それぞれを誰に見せているか（あとから変えられる）
function renderTalks() {
  const list = [...st.talks].sort((a, b) => b.date.localeCompare(a.date));
  main.innerHTML = `<h1>話したこと</h1>
    <p class="lead">だれに見せるかは、${esc(me().label)}が決めます。あとから変えられます。</p>
    ${list
      .map(
        (t) => `<div class="card"><div class="small muted">${esc(when(t.date, st.ctx.today))}の話</div>
        <p style="margin:4px 0 0">${esc(t.text)}</p>${shareButtons(t.id, t.share || 'family')}</div>`,
      )
      .join('')}`;
}

function render() {
  if (!st) return;
  document.getElementById('who').textContent = `${me().label}の画面`;
  document.title = `つぎて帳｜${me().label}`;
  paintMode(st.ctx.mode === 'claude' ? '整理：Claude' : '整理：見本（Claude 未接続）');
  const n = st.tasks.filter((t) => !t.done).length;
  document.getElementById('taskCount').innerHTML = n ? `<span class="badge">${n}</span>` : '';
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  if (tab === 'talk') renderTalk();
  else if (tab === 'tasks') renderTasks();
  else renderTalks();
}

async function refresh() {
  const next = await api('/api/state');
  if (next.role !== 'producer') throw Object.assign(new Error('この画面は農家さん本人のための画面です'), { status: 403 });
  st = next;
  render();
}

function replyOf(r) {
  const parts = ['残しました。'];
  const html = ['<p style="margin:0 0 6px"><b>残しました。</b></p>'];
  if (r.answeredQuestion) {
    parts.push(`${r.askerLabel}に届けました。`);
    html.push(`<p style="margin:0 0 6px">${esc(r.askerLabel)}に届けました。</p>`);
  }
  if (r.newTasks.length) {
    parts.push(`次の作業が${r.newTasks.length}つできました。`);
    html.push(`<p style="margin:0 0 6px">次の作業が <b>${r.newTasks.length}つ</b> できました。</p>`);
    html.push(r.newTasks.map((t) => `<div class="small">・${esc(t.when)}：${esc(t.quote)}</div>`).join(''));
  }
  gapQuestion = null;
  if (r.followup) {
    parts.push(r.followup.text);
    if (r.followup.type !== '継ぐ人の質問') gapQuestion = r.followup;
    html.push(`<p style="margin:10px 0 0;color:var(--accent);font-weight:700">${esc(r.followup.text)}</p>`);
  }
  parts.push('この話をだれに見せるか、下から選べます。いまは家族だけです。');
  return { voice: parts.join(''), html: html.join(''), talkId: r.talk.id, askerLabel: r.askerLabel };
}

async function save(text) {
  const q = currentQuestion();
  const r = await api('/api/talk', { text, questionId: q ? q.id : null, hintCrop: !q && gapQuestion ? gapQuestion.crop || null : null });
  reply = replyOf(r);
  setBy(r.by);
  heard = '';
  phase = 'saved';
  await refresh();
  window.scrollTo(0, 0); // 返事と、右上の「だれが整理したか」が見える位置に
  speak(reply.voice);
}

main.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const q = currentQuestion();
  if (act === 'mic') {
    if (phase === 'listening') listener.stop();
    else {
      speechSynthesis?.cancel();
      heard = '';
      phase = 'listening';
      render();
      listener.start();
    }
  } else if (act === 'save') await save(heard);
  else if (act === 'save-typed') {
    const t = document.getElementById('typed').value.trim();
    if (t) await save(t);
  } else if (act === 'retry') {
    heard = '';
    phase = 'idle';
    render();
  } else if (act === 'sample') {
    heard = (q ? demoAnswers()[q.text] : gapQuestion ? demoAnswers()[gapQuestion.text] : demoFrees()[0]) || '';
    phase = heard ? 'heard' : 'idle';
    render();
    window.scrollTo(0, 0);
  } else if (act === 'hear-q' && q) speak(questionVoice(q));
  else if (act === 'hear-gap' && gapQuestion) speak(gapQuestion.text);
  else if (act === 'hear-reply' && reply) speak(reply.voice);
  else if (act === 'later' && q) {
    await api('/api/later', { questionId: q.id });
    await refresh();
  } else if (act === 'again') {
    phase = 'idle';
    reply = null;
    render();
  } else if (act === 'done') {
    await api('/api/done', { taskId: b.dataset.id, done: b.dataset.done === '1' });
    await refresh();
  } else if (act === 'share') {
    const share = b.dataset.share;
    await api('/api/share', { talkId: b.dataset.talk, share });
    await refresh();
    speak(`「${st.ctx.shareNames[share]}」にしました。`);
  }
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
    // 届いた質問が増えたら取り込む（話している途中は描き直さない）
    poll(async () => {
      if (document.querySelector('details[open]')) return; // 文字を打っている途中
      if (phase === 'idle' && tab === 'talk') await refresh();
      else if (tab === 'tasks') await refresh();
    });
  } catch (e) {
    if (e.status === 401 || e.status === 403) noKey(main);
    else main.innerHTML = `<p>${esc(e.message)}</p>`;
  }
}
