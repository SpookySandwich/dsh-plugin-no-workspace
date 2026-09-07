import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStandaloneSession } from '../lib/index.js';

test('a standalone blank is durable before its ID is returned', async () => {
  const session = { id: 'blank' };
  const calls = [];
  const result = await createStandaloneSession({
    sessions: { create: () => { calls.push('create'); return session; } },
    sessionPersistence: { async ensureMaterialized(value) { assert.equal(value, session); calls.push('persist'); } },
  });
  assert.equal(result.sessionId, 'blank');
  assert.deepEqual(calls, ['create', 'persist']);
});

test('failed materialization does not report a successfully created durable session', async () => {
  await assert.rejects(createStandaloneSession({
    sessions: { create: () => ({ id: 'blank' }) },
    sessionPersistence: { ensureMaterialized: async () => { throw new Error('disk failed'); } },
  }), /disk failed/);
});
