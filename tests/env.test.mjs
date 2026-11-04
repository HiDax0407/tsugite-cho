// .env の読み込み（src/env.mjs）：値を入れる・すでにある名前は上書きしない・無ければ何もしない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { loadEnv } = await import('../src/env.mjs');

test('.env の名前＝値を process.env に入れる。すでにある名前は上書きしない。空行とコメントは飛ばす', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsugite-env-'));
  const file = join(dir, '.env');
  process.env.TSUGITE_TEST_KEEP = 'もとの値';
  delete process.env.TSUGITE_TEST_NEW;
  delete process.env.TSUGITE_TEST_EMPTY;
  writeFileSync(file, '# 注釈\n\nTSUGITE_TEST_NEW=あたらしい値 \nTSUGITE_TEST_KEEP=上書きしない\nTSUGITE_TEST_EMPTY=\n', 'utf8');
  try {
    const names = loadEnv(file);
    assert.deepEqual(names, ['TSUGITE_TEST_NEW', 'TSUGITE_TEST_EMPTY']);
    assert.equal(process.env.TSUGITE_TEST_NEW, 'あたらしい値');
    assert.equal(process.env.TSUGITE_TEST_KEEP, 'もとの値');
    assert.equal(process.env.TSUGITE_TEST_EMPTY, '');
    assert.deepEqual(loadEnv(join(dir, 'nothing.env')), []); // 無ければ何もしない
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.TSUGITE_TEST_KEEP;
    delete process.env.TSUGITE_TEST_NEW;
    delete process.env.TSUGITE_TEST_EMPTY;
  }
});
