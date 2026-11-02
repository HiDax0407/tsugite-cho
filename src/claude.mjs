// Claude API とのつなぎ口。
// キー（ANTHROPIC_API_KEY）が無いあいだは使わない。ハッカソン専用のキーと使用上限を決めてから中身を書く。

export function enabled() {
  return false;
}

function notYet() {
  throw new Error('Claude はまだつないでいません');
}

export const organize = notYet;
export const answer = notYet;
export const followup = notYet;
export const rephrase = notYet;
