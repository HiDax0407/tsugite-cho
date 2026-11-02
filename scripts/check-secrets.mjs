#!/usr/bin/env node
// 秘密情報（API キー・秘密鍵・.env など）がリポジトリに入るのを止める検査。
// 見つけたら、または読めないものがあったら、終了コード 1 で止める（「分からないときは止める」）。
//
//   node scripts/check-secrets.mjs --staged     コミットしようとしている中身（git の pre-commit）
//   node scripts/check-secrets.mjs --push       push で送るコミットを1つずつ（git の pre-push・標準入力を読む）
//   node scripts/check-secrets.mjs --worktree   今のファイル全部（追跡中＋まだ追跡していないもの）
//   node scripts/check-secrets.mjs --history    全履歴の全コミット（GitHub Actions 用）
//   node scripts/check-secrets.mjs --text <文字列>  テスト用：文字列だけを調べる

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// 中身で見つけるもの（名前・形）
export const CONTENT_RULES = [
  { name: 'Anthropic の API キー', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI の API キー', re: /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'GitHub のトークン', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { name: 'AWS のアクセスキー', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'Google の API キー', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack のトークン', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe の秘密キー', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { name: '秘密鍵', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: 'キー・パスワードらしき値の直書き',
    re: /\b(?:api[_-]?key|secret|token|passw(?:or)?d)\b["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i,
  },
];

// ファイル名で止めるもの
export function badFileName(path) {
  const b = basename(path).toLowerCase();
  if (b === '.env.example') return null;
  if (b === '.env' || b.startsWith('.env.')) return '.env（環境変数のファイル）';
  if (/\.(pem|key|p12|pfx)$/.test(b)) return '鍵のファイル';
  if (/^id_(rsa|ed25519|ecdsa|dsa)/.test(b)) return 'SSH の鍵';
  if (/^credentials.*\.json$/.test(b)) return '認証情報のファイル';
  return null;
}

// 見本の値（xxxxx や「ここに入れる」）は問題にしない
const PLACEHOLDER = /(x{5,}|<[^>]+>|ここに|your[_-]?|example|dummy|placeholder)/i;

export function scanText(text) {
  const found = [];
  for (const rule of CONTENT_RULES) {
    const m = text.match(rule.re);
    if (m && !PLACEHOLDER.test(m[0])) found.push(rule.name);
  }
  return found;
}

function git(args, opts = {}) {
  return execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024, ...opts });
}

// NUL 区切りの一覧（日本語のファイル名を崩さずに読む）
function nulList(buf) {
  return buf.toString('utf8').split('\0').filter(Boolean);
}

const problems = [];
function report(where, what) {
  problems.push(`${where}：${what}`);
}

function checkBlob(label, path, getBuf) {
  const nameProblem = badFileName(path);
  if (nameProblem) report(label, `${nameProblem} は入れられません`);
  let buf;
  try {
    buf = getBuf();
  } catch (e) {
    report(label, '中身を読めませんでした（分からないので止めます）');
    return;
  }
  // 画像なども飛ばさない（キーは英数字なので latin1 で読めば見つかる）
  for (const name of scanText(buf.toString('latin1'))) report(label, name);
}

function checkStaged() {
  const files = nulList(git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRTUXB']));
  for (const f of files) checkBlob(`（コミット予定）${f}`, f, () => git(['show', `:${f}`]));
}

function filesOfCommit(sha) {
  // 親ごとに調べる（まとめコミットも見逃さない）。親がなければ全部。
  const parents = git(['rev-list', '--parents', '-n', '1', sha]).toString().trim().split(' ').slice(1);
  if (parents.length === 0) return nulList(git(['ls-tree', '-r', '--name-only', '-z', sha]));
  const set = new Set();
  for (const p of parents) {
    for (const f of nulList(git(['diff', '--name-only', '-z', '--diff-filter=ACMRTUXB', p, sha]))) set.add(f);
  }
  return [...set];
}

function checkCommit(sha) {
  const short = sha.slice(0, 7);
  for (const f of filesOfCommit(sha)) checkBlob(`（コミット ${short}）${f}`, f, () => git(['show', `${sha}:${f}`]));
}

function checkPush() {
  const ZERO = /^0+$/;
  const input = readFileSync(0, 'utf8').trim();
  if (!input) return;
  for (const line of input.split('\n')) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha)) continue; // 消す push
    const range = remoteSha && !ZERO.test(remoteSha) ? [localSha, `^${remoteSha}`] : [localSha, '--not', '--remotes'];
    const commits = git(['rev-list', ...range]).toString().split('\n').filter(Boolean);
    for (const c of commits) checkCommit(c);
    // 送る先頭のコミットは、変わったところだけでなく全ファイルを見る
    for (const f of nulList(git(['ls-tree', '-r', '--name-only', '-z', localSha]))) {
      checkBlob(`（送る版）${f}`, f, () => git(['show', `${localSha}:${f}`]));
    }
  }
}

function checkWorktree() {
  const files = nulList(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']));
  for (const f of files) {
    checkBlob(f, f, () => readFileSync(f));
  }
}

function checkHistory() {
  const commits = git(['rev-list', '--all']).toString().split('\n').filter(Boolean);
  for (const c of commits) checkCommit(c);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();

function main() {
  const mode = process.argv[2];
  try {
    if (mode === '--text') {
      const found = scanText(process.argv.slice(3).join(' '));
      for (const f of found) report('文字列', f);
    } else if (mode === '--staged') checkStaged();
    else if (mode === '--push') checkPush();
    else if (mode === '--worktree') checkWorktree();
    else if (mode === '--history') checkHistory();
    else {
      console.error('使い方：--staged / --push / --worktree / --history / --text');
      process.exit(1);
    }
  } catch (e) {
    report('検査', `途中で失敗しました（分からないので止めます）：${e.message.split('\n')[0]}`);
  }

  if (problems.length) {
    console.error('\n秘密情報らしきものが見つかりました。止めます。\n');
    for (const p of [...new Set(problems)]) console.error('  - ' + p);
    console.error('\nキーは .env に置き、リポジトリには .env.example（値なし）だけを入れてください。\n');
    process.exit(1);
  }
  if (mode !== '--text') console.log('秘密情報の検査：問題なし');
}
