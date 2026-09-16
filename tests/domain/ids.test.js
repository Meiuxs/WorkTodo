import assert from 'node:assert/strict';
import test from 'node:test';

import { generateId } from '../../src/shared/ids.js';

function withCrypto(cryptoValue, callback) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: cryptoValue,
  });
  try {
    callback();
  } finally {
    Object.defineProperty(globalThis, 'crypto', originalDescriptor);
  }
}

test('generateId 返回 crypto.randomUUID 的结果且只调用一次', () => {
  let calls = 0;
  withCrypto({
    randomUUID() {
      calls += 1;
      return 'generated-uuid';
    },
  }, () => {
    assert.equal(generateId(), 'generated-uuid');
  });
  assert.equal(calls, 1);
});

test('generateId 在 crypto.randomUUID 不可用时抛出明确错误', () => {
  withCrypto(undefined, () => {
    assert.throws(
      () => generateId(),
      /crypto\.randomUUID 不可用/,
    );
  });
});
