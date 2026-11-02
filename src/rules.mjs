// Claude を使わない「見本の整理」の決まり。
// Claude 未接続でも流れが見えるように、決まった規則で話を文に切り、作業カードとノートの行にする。
// 本人の言葉は書き換えない（方言・言い直しもそのまま）。足すのは「いつの話か」「どの作物か」などの印だけ。

export function splitSentences(text) {
  return String(text)
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// 話した日 → 「10月下旬」
export function seasonOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const part = day <= 10 ? '上旬' : day <= 20 ? '中旬' : '下旬';
  return `${m}月${part}`;
}

const NEW_TOPIC = /^(それから|あとな|あと、|ほかに|それと|話は変わる)/;
const FEELING = /(痛|きつい|しんどい|疲れ|眠)/;
const STATUS = /(足りん|足りない|なっとる|なってる|もう終わり|終わりや)/;
const OBLIGATION = /(んといかん|ないといかん|ないといけない|なきゃ|[わらさまかがた]んと(間に合わん|割れる|いかん)?|せんと)/;
// 期限のことば（先に並べたものほど優先：「月末締めやから、今週中に」なら今週中）
const WHEN_WORDS = [/今日中?/, /明後日|あさって/, /明日|あした/, /今週中/, /今週/, /週末/, /[月火水木金土日]曜日?/, /再来週/, /来週/, /次の日/, /朝のうち/, /昼まで/, /夕方まで/, /[一-龥]{1,3}が(?:来る|続く|降る)前/, /今月中/, /月末/, /来月/];
// 急ぐ順（作業カードを並べるため）。前にあるものほど急ぐ
const URGENCY = [/今日|朝のうち|昼まで|夕方まで/, /明日|あした|次の日/, /明後日|あさって/, /今週|週末|曜/, /前$/, /来週|再来週/, /今月中|月末/, /来月/];
export function urgencyOf(when) {
  const i = URGENCY.findIndex((re) => re.test(when || ''));
  return i < 0 ? URGENCY.length : i;
}
function findWhen(s) {
  for (const re of WHEN_WORDS) {
    const m = s.match(re);
    if (m) return m[0];
  }
  return null;
}
const THEN_START = /^[^、。]{0,12}(たら|てから|終わったら)、?/;
const CONDITION = /^(.{2,40}?)(たら|ったら|とったら|できとったら)、?/;
const REASON = /(けん[、,]|けんな|やから|だから|から、|ので|と(甘くならん|持たん|割れる|ダメ|傷む|腐る))/;
const FAILURE = /(去年|前に一度|昔).*(ダメ|失敗|遅れ|やられ)/;
const NOT_TAUGHT = /(教えとらん|教えてない|教えていない|まだ教え)/;
const HARD = /(難しい|むずかしい|コツがいる)/;
const ACTION = /(とる|掘|抜|まく|ふる|ふって|寝かせ|出す|出して|切り直す|片付け|頼む|言う|言わん|植え|刈|干す|運ぶ|箱|洗|入れ|積|詰め|見に行)/;
// 家の人への頼みごと（「積んどいてくれ」「軽トラ出してくれ」）
const REQUEST = /(てくれ|といてくれ|どいてくれ|ておいて|といて|てほしい|頼むぞ|頼むわ)[。！!]?$/;
// あいまいな判断（いちばん引き継ぎたい勘どころ。どこを見て決めるかを聞き返す）
export const VAGUE = /(ええ頃|ええころ|いい頃|ころあい|頃合い|ちょうどええ|ほどほど|適当に|様子を見て|見はからって|それなりに)/;

// 質問に出てくる作物を見分けるための名前（地域の誰も作っていない作物でも「聞ける人がいない」と分かるように）
export const COMMON_CROPS = ['オクラ', 'かぼちゃ', 'さつまいも', '里芋', 'ピーマン', 'にんにく', 'たまねぎ', '玉ねぎ', 'トマト', 'なす', 'きゅうり', 'キャベツ', '白菜', '大根', 'ねぎ', 'じゃがいも', 'いちご', 'ほうれん草', 'ブロッコリー', 'にんじん', 'しょうが', '米'];

export function detectCrop(sentence, crops) {
  return crops.find((c) => sentence.includes(c)) || null;
}

// 1つの話 → 文ごとの行（ノート用）と作業カードの候補
export function organizeTalk(talk, { crops, people, startCrop = null, ownerName = '山野さん' }) {
  // 「さくらさんにも頼める」→ 前の作業の担当の候補にする（名簿にいる人だけ）
  const given = (people || []).map((p) => p.name.replace(/（.*?）/g, '').trim().split(/\s+/).pop());
  const sentences = splitSentences(talk.text);
  const season = seasonOf(talk.date);
  const lines = [];
  const tasks = [];
  let crop = startCrop; // 質問への答えなら、質問の作物から始める
  let prevTask = null;
  let prevLine = null;

  sentences.forEach((s, i) => {
    // 作物：言っていれば使う。言っていなければ同じ話の流れを引き継ぐ。話題が変われば「畑全体」
    const named = detectCrop(s, crops);
    if (named) crop = named;
    else if (NEW_TOPIC.test(s)) crop = null;

    const tags = [];
    if (REASON.test(s)) tags.push('理由つき');
    if (FAILURE.test(s)) tags.push('去年の失敗');
    if (NOT_TAUGHT.test(s)) tags.push('まだ教わっていない');
    if (HARD.test(s)) tags.push('むずかしいところ');
    if (/(たら|前に|から。|順番|見とるのは|見てるのは)/.test(s)) tags.push('判断のコツ');

    let kind = 'コツ';
    if (FEELING.test(s)) kind = 'いまの様子';
    else if (STATUS.test(s) && !OBLIGATION.test(s)) kind = 'いまの様子';

    const line = {
      talkId: talk.id,
      index: i,
      date: talk.date,
      season,
      crop: crop || '畑全体',
      kind,
      tags,
      quote: s,
    };
    lines.push(line);

    // 作業カード：期限・言い切りの作業・「〜たら」で前の作業に続くもの・条件つきのもの
    const delegate = /頼め|頼む|任せ/.test(s) && given.find((g) => s.includes(`${g}さん`));
    if (delegate && prevTask) {
      prevTask.who = `${ownerName}（${delegate}さんにも頼めるかも・本人の話）`;
      prevLine = line;
      return;
    }
    // 家の人への頼みごと：呼びかけた名前があればその人、無ければ「家の人」
    if (REQUEST.test(s) && ACTION.test(s)) {
      const to = given.find((g) => new RegExp(`^${g}(さん)?[、,]`).test(s));
      const t = {
        talkId: talk.id,
        lineIndex: i,
        crop: crop || '畑全体',
        quote: s,
        context: null,
        when: findWhen(s) || 'できるだけ早く',
        type: '期限',
        who: `${to ? `${to}さん` : '家の人'}（${ownerName}から頼まれたこと）`,
      };
      t.rank = urgencyOf(t.when);
      tasks.push(t);
      prevLine = line;
      return;
    }
    if (kind !== 'コツ' || !ACTION.test(s)) {
      prevLine = line;
      return;
    }
    const when = findWhen(s);
    const isObligation = OBLIGATION.test(s);
    const isThen = THEN_START.test(s) && prevTask;
    const cond = s.match(CONDITION);
    let task = null;
    if (when || isObligation) {
      task = { when: when || 'できるだけ早く', type: '期限' };
    } else if (isThen) {
      task = { when: '前の作業のあと', type: '続き' };
    } else if (cond) {
      task = { when: `${cond[1]}${cond[2]}`, type: '条件' };
    }
    if (task) {
      const t = {
        talkId: talk.id,
        lineIndex: i,
        crop: crop || '畑全体',
        quote: s,
        context: prevLine && prevLine.kind === 'いまの様子' ? prevLine.quote : null,
        when: task.when,
        type: task.type,
        who: ownerName,
      };
      t.rank = urgencyOf(t.when);
      tasks.push(t);
      prevTask = t;
    }
    prevLine = line;
  });

  return { lines, tasks };
}

// 継ぐ人の質問が何を聞いているか（答えに要るもの）
const ASK_KIND = [
  { kind: '置き場所', q: /(どこ|場所|置き場)/, need: /(納屋|倉庫|小屋|軒下|棚|土間|部屋|の中|の奥|の下|ハウス|置き場|むしろ|に並べ|に置い)/ },
  { kind: '量', q: /(どのくらい|どれくらい|どれだけ|量|何キロ|何袋|何杯)/, need: /([0-9０-９一二三四五六七八九十百]+|ひと|ふた)\s*(キロ|kg|ｋｇ|袋|杯|握り|にぎり|グラム|g|リットル|L|俵|箱|かご)/ },
  { kind: '決め方', q: /(何を見て|なにを見て|どうやって決め|目安|基準|決めて)/, need: /(を見て|で決め|ぐらいになったら|になったら|切ったら|が目安)/ },
  { kind: '時期', q: /(いつ|時期|何日|何月|タイミング)/, need: /(前に|たら|[0-9０-９一二三四五六七八九十]+日|週|月末|朝|夕方|霜|気温)/ },
  { kind: '見るところ', q: /(何を見|なにを見|どこを見)/, need: /(見とる|見てる|を見る|見るのは)/ },
  { kind: '理由', q: /(なぜ|なんで|どうして|理由)/, need: REASON },
];

export function questionKind(text) {
  return ASK_KIND.find((k) => k.q.test(text)) || null;
}

// 漢字・カタカナのつながりを2文字ずつ（似ている話を探す目安）
function grams(s) {
  const out = new Set();
  const runs = s.match(/[一-龥ァ-ヶー]{2,}|[一-龥][ぁ-ん]/g) || [];
  for (const r of runs) for (let i = 0; i < r.length - 1; i++) out.add(r.slice(i, i + 2));
  return out;
}

const STOP = new Set(['どこ', 'ですか', 'すか', 'いい', 'ばいい']);
// 質問の言い方に使う漢字（中身ではない）
const ASK_KANJI = new Set([...'何量場所時期理由見決目安基準方法日月']);

// 質問の中身の漢字（「種」「石灰」など）。1つも行に無ければ、その行は答えにしない
export function subjectOk(questionText, lineText) {
  const ks = [...new Set(questionText.match(/[一-龥]/g) || [])].filter((k) => !ASK_KANJI.has(k));
  if (ks.length === 0) return true;
  return ks.some((k) => lineText.includes(k));
}

export function similarity(a, b) {
  const ga = grams(a);
  const gb = grams(b);
  let n = 0;
  for (const g of ga) if (gb.has(g) && !STOP.has(g)) n++;
  return n;
}

// ノートの行の中から、質問に答えられる行を探す。無ければ「答えない」。
// 答えるときも文を作らず、本人の言葉の行をそのまま返す。
export function findAnswer(questionText, noteLines, crops) {
  const crop = detectCrop(questionText, crops);
  const kind = questionKind(questionText);
  const scored = noteLines
    .map((l) => ({ l, score: similarity(questionText, l.quote) }))
    .filter((x) => (crop ? x.l.crop === crop : x.score >= 1))
    .filter((x) => subjectOk(questionText, x.l.quote))
    .sort((a, b) => b.score - a.score);
  const related = scored.filter((x) => x.score >= 1).slice(0, 3).map((x) => x.l);
  const missing = kind ? kind.kind : null;
  if (scored.length === 0) return { answered: false, related: [], missing };
  if (!kind) {
    // 何を聞いているか分からないときは、似ている行がはっきりある場合だけ答える
    const strong = scored.filter((x) => x.score >= 2).map((x) => x.l);
    return strong.length ? { answered: true, quotes: strong.slice(0, 2), related } : { answered: false, related, missing };
  }
  // 聞かれていること（置き場所・量など）が書いてある行だけを答えにする
  const fit = scored.filter((x) => kind.need.test(x.l.quote) && (crop || x.score >= 1)).map((x) => x.l);
  if (fit.length === 0) return { answered: false, related, missing };
  return { answered: true, quotes: fit.slice(0, 2), related };
}

function l2word(s) {
  return s.match(VAGUE)[0];
}

// 本人への聞き返し（1回に1つだけ）。継ぐ人の質問がたまっていれば、それを先に聞く。
export function pickFollowup({ askList, newTasks, newLines, successorName }) {
  if (askList.length > 0) {
    const q = askList[0];
    return { type: '継ぐ人の質問', questionId: q.id, text: `${q.askerVoice || `${successorName}さん`}が聞きたいそうです。「${q.text}」` };
  }
  const vague = newLines.find((l) => VAGUE.test(l.quote));
  if (vague) {
    const word = l2word(vague.quote);
    return { type: '見るところ', crop: vague.crop, text: `「${word}」は、どこを見て決めとりますか？` };
  }
  const noWhen = newTasks.find((t) => t.when === 'できるだけ早く' && !REQUEST.test(t.quote));
  if (noWhen) return { type: '時期', crop: noWhen.crop, text: `「${noWhen.quote}」は、いつごろやりますか？` };
  const noAmount = newLines.find((l) => /(まく|ふる|ふって|やる|入れる)/.test(l.quote) && !questionKind('どのくらい').need.test(l.quote));
  if (noAmount) return { type: '量', crop: noAmount.crop, text: `「${noAmount.quote}」は、どのくらいの量ですか？` };
  const noReason = newLines.find((l) => l.tags.includes('判断のコツ') && !l.tags.includes('理由つき'));
  if (noReason) return { type: '理由', crop: noReason.crop, text: `「${noReason.quote}」は、なんでそうするんですか？` };
  return null;
}
