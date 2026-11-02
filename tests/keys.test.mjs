// 専用リンクの合言葉：知らない合言葉は誰でもない／人ごとに違う
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeys } from '../src/keys.mjs';

test('合言葉から人が決まる。知らない合言葉・短い合言葉は誰でもない', () => {
  const k = createKeys({ ids: ['p1', 'p6', 'town'] });
  assert.equal(k.whoIs(k.tokenOf('p6')), 'p6');
  assert.notEqual(k.tokenOf('p1'), k.tokenOf('p6'));
  assert.equal(k.whoIs('p6'), null);
  assert.equal(k.whoIs(''), null);
  assert.equal(k.whoIs(undefined), null);
  assert.equal(k.whoIs(k.tokenOf('p1').slice(0, -1) + 'A'), k.tokenOf('p1').endsWith('A') ? 'p1' : null);
});
