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
