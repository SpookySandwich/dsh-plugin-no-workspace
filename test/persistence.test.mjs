import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStandaloneSession } from '../lib/index.js';

test('modern standalone creation uses the native durable Session Controller transaction', async () => {
  let received;
  const result = await createStandaloneSession({
    sessionController: { async create(options) { received = options; return { sessionId: options.sessionId }; } },
    sessions: { create() { throw new Error('The raw store does not own modern persistence'); } },
  }, { sessionId: 'standalone', cwd: '/qa', agentPreset: 'qa-preset' });
  assert.deepEqual(received, { sessionId: 'standalone', cwd: '/qa', agentPreset: 'qa-preset' });
  assert.deepEqual(result, { ok: true, sessionId: 'standalone' });
});

test('modern creation failure cannot fall back to a non-durable blank', async () => {
  await assert.rejects(createStandaloneSession({
    sessionController: { async create() { throw new Error('disk failed'); } },
    sessions: { create() { throw new Error('unsafe fallback'); } },
  }), /disk failed/);
});

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
