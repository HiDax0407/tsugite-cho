// 秘密情報の検査のテスト（キーの見本は文字をつないで作り、このファイル自体が引っかからないようにする）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, badFileName } from '../scripts/check-secrets.mjs';

const fake = (head, n) => head + 'A1b2C3d4'.repeat(Math.ceil(n / 8)).slice(0, n);

test('Anthropic のキーを見つける', () => {
  assert.ok(scanText(`key = ${fake('sk-' + 'ant-api03-', 40)}`).includes('Anthropic の API キー'));
});

test('見本の値（xxxxx）は問題にしない', () => {
  assert.deepEqual(scanText('ANTHROPIC_API_KEY=sk-' + 'ant-xxxxxxxxxxxxxxxxxxxxxxxx'), []);
});

test('1つ目が見本でも、あとに本物があれば見つける', () => {
  const text = 'A=sk-' + 'ant-xxxxxxxxxxxxxxxxxxxxxxxx\nB=' + fake('sk-' + 'ant-', 40);
  assert.ok(scanText(text).includes('Anthropic の API キー'));
});

test('GitHub のトークン・秘密鍵を見つける', () => {
  assert.ok(scanText(fake('gh' + 'p_', 36)).length > 0);
  assert.ok(scanText('-----BEGIN ' + 'OPENSSH PRIVATE KEY-----').length > 0);
});

test('.env や鍵のファイル名は止める・.env.example は通す', () => {
  assert.ok(badFileName('.env'));
  assert.ok(badFileName('config/.env.local'));
  assert.ok(badFileName('server.pem'));
  assert.equal(badFileName('.env.example'), null);
  assert.equal(badFileName('README.md'), null);
});
