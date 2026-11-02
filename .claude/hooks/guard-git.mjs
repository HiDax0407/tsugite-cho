#!/usr/bin/env node
// Claude Code のフック（PreToolUse・Bash）。
// Claude Code が git でコミット・push しようとしたら、その前に秘密情報の検査を通す。
// 見つかった・読めない・検査を飛ばす指定がある → 終了コード 2 で止める（理由は Claude に返る）。

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

function block(msg) {
  process.stderr.write(`つぎて帳のフック：${msg}\n`);
  process.exit(2);
}

let cmd = '';
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  cmd = String(input?.tool_input?.command ?? '');
} catch {
  block('フックへの入力が読めませんでした（分からないので止めます）');
}

// git を含まない命令は関係ない
if (!/\bgit\b/i.test(cmd)) process.exit(0);

// 検査を飛ばす指定は止める
if (/--no-verify|--no-v\b|core\.hookspath|GIT_CONFIG_|\s-c\s+core\./i.test(cmd)) {
  block('検査を飛ばす指定（--no-verify・hooksPath の上書きなど）は使えません');
}
if (/\bcommit\b[^|;&]*\s-[a-zA-Z]*n[a-zA-Z]*\b/.test(cmd)) {
  block('git commit の -n（検査を飛ばす）は使えません');
}

const touchesRepo = /\b(commit|push)\b/i.test(cmd);
if (!touchesRepo) process.exit(0);

const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// git のフック（いちばん確実な守り）が切られていたら止める
try {
  const hooksPath = execFileSync('git', ['config', 'core.hooksPath'], { cwd: dir }).toString().trim();
  if (hooksPath !== '.githooks') throw new Error();
} catch {
  block('git のフックが有効になっていません。先に `npm run setup-hooks` を実行してください');
}
const script = join(dir, 'scripts', 'check-secrets.mjs');
// コミットなら「入れる予定のもの」、push なら「今のファイル全部」を先に見る（送るコミットは git の pre-push が見る）
const modes = /\bcommit\b/i.test(cmd) ? ['--staged', '--worktree'] : ['--worktree'];
for (const mode of modes) {
  try {
    execFileSync('node', [script, mode], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const out = (e.stderr?.toString() || '') + (e.stdout?.toString() || '');
    block('秘密情報の検査で止まりました。\n' + out.trim());
  }
}
process.exit(0);
