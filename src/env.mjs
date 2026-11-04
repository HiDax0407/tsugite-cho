// .env を読む（キーはリポジトリに入れない）。
// ES モジュールの import は本文より先に動くので、server.mjs の「最初の import」にして、
// ほかのモジュール（src/claude.mjs など）が process.env を見る前に読み込む。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// すでに環境変数にある名前は上書きしない。読み込んだ名前だけを返す（値は返さない）
export function loadEnv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return [];
  const names = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2];
    names.push(m[1]);
  }
  return names;
}

loadEnv();
