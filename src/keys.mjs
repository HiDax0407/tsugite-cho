// 一人ひとりの「専用リンク」の合言葉。ログインはさせず、町が QR カードなどで配る想定。
// 誰として動くかは、この合言葉からサーバーが決める（画面や要求の中身で名乗らせない）。
// 合言葉は初めて起動したときに作り、data/runtime/keys.json（リポジトリに入れない）に残す。

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export function createKeys({ file = null, ids }) {
  let byId = {};
  if (file && existsSync(file)) byId = JSON.parse(readFileSync(file, 'utf8'));
  let changed = false;
  for (const id of ids) {
    if (!byId[id]) {
      byId[id] = randomBytes(18).toString('base64url');
      changed = true;
    }
  }
  if (changed && file) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(byId, null, 2), { mode: 0o600 });
  }

  // 合言葉 → 人の id（見つからなければ null）
  function whoIs(token) {
    if (typeof token !== 'string' || token.length < 10) return null;
    const t = Buffer.from(token);
    for (const [id, k] of Object.entries(byId)) {
      const kb = Buffer.from(k);
      if (kb.length === t.length && timingSafeEqual(kb, t)) return id;
    }
    return null;
  }

  return { whoIs, tokenOf: (id) => byId[id] };
}
