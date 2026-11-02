// 本人（山野さん）の画面：話す／次の作業。打つ・選ぶ・覚える操作をさせない。
import { api, esc, speak, makeListener, MIC_SVG, poll } from '/common.js';

const main = document.getElementById('main');
let st = null;
let demo = null;
let tab = 'talk';
let phase = 'idle'; // idle → listening → heard → saved
let heard = '';
let reply = null; // 残したあとの返事
let gapQuestion = null; // 抜けの聞き返し（継ぐ人の質問がないとき）

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

function askList() {
  return st.questions.filter((q) => q.status === '本人に聞く');
}

function currentQuestion() {
  return askList()[0] || null;
}

function questionVoice(q) {
  return `${st.ctx.successorName}さんが聞きたいそうです。「${q.text}」`;
}

function renderTalk() {
  const q = currentQuestion();
  const left = askList().length;
  let top = '';
  if (phase === 'saved') {
    // 返事だけを見せる（次の質問は返事の中で1つだけ）
  } else if (q) {
    top = `<div class="card accent ask-card">
      <div class="label">${esc(st.ctx.successorName)}さんが聞きたいこと${left > 1 ? `（あと${left}つ）` : ''}</div>
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
    middle = `<div class="card accent" aria-live="polite">${reply.html}
      <button class="btn wide" data-act="hear-reply" style="margin-top:10px">もう一度聞く</button>
      <button class="btn primary wide" data-act="again" style="margin-top:10px">${currentQuestion() ? '次の質問に答える' : 'ほかにも話す'}</button></div>`;
  }

  const sample = q ? demo?.answers?.[q.text] : demo?.free_talks?.[0];
  const typed = phase === 'saved' ? '' : `
    <details class="card"><summary>文字で入れる</summary>
      <textarea id="typed" rows="3" style="margin-top:10px" placeholder="ここに書いても残せます"></textarea>
      <button class="btn primary wide" data-act="save-typed" style="margin-top:8px">残す</button>
    </details>
    ${sample ? `<p class="small muted">デモ用：<button class="linkish" data-act="sample">見本の話を入れる（声の代わり）</button></p>` : ''}`;

  main.innerHTML = top + middle + typed;
}

function renderTasks() {
  const open = st.tasks.filter((t) => !t.done);
  const done = st.tasks.filter((t) => t.done);
  const typeOrder = { 期限: 0, 続き: 1, 条件: 2 };
  open.sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9) || b.date.localeCompare(a.date));
  const card = (t) => `<div class="card task ${t.done ? 'done' : ''}">
      <div>
        <div class="when">${esc(t.type === '条件' ? `${t.when}` : t.when)}</div>
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

function render() {
  if (!st) return;
  document.getElementById('mode').textContent = st.ctx.mode === 'claude' ? '整理：Claude' : '整理：見本（Claude 未接続）';
  const n = st.tasks.filter((t) => !t.done).length;
  document.getElementById('taskCount').innerHTML = n ? `<span class="badge">${n}</span>` : '';
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  if (tab === 'talk') renderTalk();
  else renderTasks();
}

async function refresh() {
  st = await api('/api/state');
  render();
}

function replyOf(r) {
  const parts = ['残しました。'];
  const html = ['<p style="margin:0 0 6px"><b>残しました。</b></p>'];
  if (r.answeredQuestion) {
    parts.push(`${st.ctx.successorName}さんに届けました。`);
    html.push(`<p style="margin:0 0 6px">${esc(st.ctx.successorName)}さんに届けました。</p>`);
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
  return { voice: parts.join(''), html: html.join('') };
}

async function save(text) {
  const q = currentQuestion();
  const r = await api('/api/talk', { text, questionId: q ? q.id : null });
  reply = replyOf(r);
  heard = '';
  phase = 'saved';
  await refresh();
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
    heard = q ? demo.answers[q.text] : demo.free_talks[0];
    phase = 'heard';
    render();
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
  }
});

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  render();
});

demo = await api('/api/demo');
await refresh();
// 継ぐ人の質問が増えたら取り込む（話している途中は描き直さない）
poll(async () => {
  if (document.querySelector('details[open]')) return; // 文字を打っている途中
  if (phase === 'idle' && tab === 'talk') await refresh();
  else if (tab === 'tasks') await refresh();
});
