// 画面で使う小さな道具（サーバーとのやりとり・声・日付）

// 専用リンク（…?k=合言葉）で開く。誰として動くかはサーバーが合言葉から決める
export const KEY = new URLSearchParams(location.search).get('k') || '';

export async function api(path, body) {
  const headers = { 'X-Tsugite-Key': KEY };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'うまくいきませんでした'), { status: res.status });
  return data;
}

// 専用リンクで開いていないときの案内
export function noKey(main) {
  main.innerHTML = `<h1>専用リンクから開いてください</h1>
    <p class="lead">つぎて帳は、一人ひとりに配られた専用リンク（QR カードなど）で開きます。ログインはいりません。</p>
    <p><a class="btn primary" href="/">デモの入口へ</a></p>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// 「10月30日（3日前）」
export function when(dateStr, today) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const t = new Date(today + 'T00:00:00+09:00');
  const days = Math.round((t - d) / 86400000);
  const rel = days === 0 ? '今日' : days === 1 ? '昨日' : `${days}日前`;
  return `${d.getMonth() + 1}月${d.getDate()}日（${rel}）`;
}

// 読み上げ（端末の声）
export function speak(text) {
  if (!('speechSynthesis' in window) || !text) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = 0.9;
  speechSynthesis.speak(u);
  return true;
}

// 声の入力（ブラウザの音声入力）。使えない端末では null
export function makeListener({ onText, onEnd }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'ja-JP';
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onText(finalText + interim);
  };
  rec.onend = () => onEnd(finalText);
  rec.onerror = () => {};
  return {
    start() {
      finalText = '';
      rec.start();
    },
    stop() {
      rec.stop();
    },
  };
}

export const MIC_SVG =
  '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

// 別の画面で起きたこと（本人が答えた等）を、数秒ごとに取り込む
export function poll(fn, ms = 4000) {
  setInterval(() => {
    if (document.visibilityState === 'visible') fn();
  }, ms);
}

// 「字を大きく」の切り替え（継ぐ人・新人・町の画面。本人の画面は最初から大きい）。選んだ大きさは端末に覚える
export function sizeToggle() {
  const KEY = 'tsugite-large';
  let on = false;
  try {
    on = localStorage.getItem(KEY) === '1';
  } catch {}
  const apply = () => document.body.classList.toggle('large', on);
  apply();
  const el = document.getElementById('size');
  if (!el) return;
  const paint = () => {
    el.textContent = on ? '字を戻す' : '字を大きく';
    el.setAttribute('aria-pressed', String(on));
  };
  paint();
  el.addEventListener('click', () => {
    on = !on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {}
    apply();
    paint();
  });
}

// 画面の右上に「いまの整理のしかた」を出す。AI が働いた直後だけ「役：だれが」を少しのあいだ出す
//   例：「照合：Claude Opus 5.5」／キーが無いあいだは「照合：見本（未接続）」
let modeDefault = '';
let byNow = null;
let byTimer = null;
export function paintMode(def) {
  if (def !== undefined) modeDefault = def;
  const el = document.getElementById('mode');
  if (!el) return;
  const working = byNow && byNow.length;
  // 役ごとに1行（途中で折り返さない）
  el.innerHTML = working ? byNow.map((b) => `<span style="display:block;white-space:nowrap">${esc(b.role)}：${esc(b.by)}</span>`).join('') : esc(modeDefault);
  el.classList.toggle('working', !!working);
}
export function setBy(list) {
  byNow = (list || []).filter(Boolean);
  clearTimeout(byTimer);
  byTimer = setTimeout(() => {
    byNow = null;
    paintMode();
  }, 20000);
  paintMode();
}

// 「使い方」：見出しの下のチップを押すと、その下に白いカード（3行の説明＋読み上げ＋閉じる）が開く。もう一度押すと閉じる。
//   覆いかぶさるモーダルにはしない。lines は文の配列か、いまの画面に合わせて配列を返す関数（新人の画面は「聞く」「ノート」で文が違う）
export function helpToggle(lines) {
  const btn = document.getElementById('help');
  const card = document.getElementById('helpCard');
  if (!btn || !card) return { repaint() {} };
  let open = false;
  let speaking = false;
  const canSpeak = 'speechSynthesis' in window;
  const texts = () => (typeof lines === 'function' ? lines() : lines) || [];
  const paintSpeak = () => {
    const b = card.querySelector('[data-help="speak"]');
    if (!b) return;
    b.textContent = speaking ? '読み上げを止める' : '読み上げ';
    b.setAttribute('aria-pressed', String(speaking));
  };
  // 自分が読み上げているときだけ止める（本人の画面のほかの読み上げは邪魔しない）
  const stop = () => {
    if (speaking && canSpeak) speechSynthesis.cancel();
    speaking = false;
    paintSpeak();
  };
  const paint = () => {
    btn.setAttribute('aria-expanded', String(open));
    card.hidden = !open;
    if (!open) return;
    card.innerHTML = `<div class="help-lines">${texts()
      .map((t) => `<p>${esc(t)}</p>`)
      .join('')}</div>
      <div class="row">${canSpeak ? '<button class="btn" type="button" data-help="speak" aria-pressed="false">読み上げ</button>' : ''}
      <button class="btn ghost" type="button" data-help="close">閉じる</button></div>`;
    paintSpeak();
  };
  btn.addEventListener('click', () => {
    open = !open;
    if (!open) stop();
    paint();
  });
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-help]');
    if (!b) return;
    if (b.dataset.help === 'close') {
      open = false;
      stop();
      paint();
    } else if (b.dataset.help === 'speak') {
      if (speaking) return stop(); // 途中でもう一度押すと止まる
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texts().join(' '));
      u.lang = 'ja-JP';
      u.rate = 0.9;
      u.onend = u.onerror = () => {
        speaking = false;
        paintSpeak();
      };
      speaking = true;
      paintSpeak();
      speechSynthesis.speak(u);
    }
  });
  return {
    // 画面（タブ）が変わったとき、開いていれば文を入れ替える（読み上げ中なら止める）
    repaint() {
      if (!open) return;
      stop();
      paint();
    },
  };
}
