import test from 'node:test';
import assert from 'node:assert/strict';
import { detachSessionFromWorkspaces, createStandaloneSession } from '../lib/index.js';

test('detachSessionFromWorkspaces: handles session not in any workspace', async () => {
  const fakeRegistry = {
    list() {
      return [
        { id: 'w1', title: 'Alpha', path: '/alpha', sessionIds: ['s1', 's2'], detachSession: async () => {} },
      ];
    },
  };
  const ctx = {
    get: (key) => key === 'workspaceRegistry' ? fakeRegistry : undefined,
  };

  const result = await detachSessionFromWorkspaces(ctx, 's999');
  assert.equal(result.ok, true);
  assert.equal(result.detached, false);
});

test('detachSessionFromWorkspaces: detaches session attached to a workspace', async () => {
  let detachedId = null;
  const fakeRegistry = {
    list() {
      return [
        {
          id: 'w1',
          title: 'Alpha',
          path: '/alpha',
          sessionIds: ['s1', 's2'],
          detachSession: async (id) => { detachedId = id; },
        },
      ];
    },
  };
  const ctx = {
    get: (key) => key === 'workspaceRegistry' ? fakeRegistry : undefined,
  };

  const result = await detachSessionFromWorkspaces(ctx, 's1');
  assert.equal(result.ok, true);
  assert.equal(result.detached, true);
  assert.equal(result.detachedCount, 1);
  assert.equal(detachedId, 's1');
  assert.equal(result.fromWorkspaces[0].id, 'w1');
});

test('detachSessionFromWorkspaces: rejects invalid or empty sessionId', async () => {
  const ctx = { get: () => ({ list: () => [] }) };
  await assert.rejects(
    async () => detachSessionFromWorkspaces(ctx, ''),
    /sessionId must be a non-empty string/
  );
  await assert.rejects(
    async () => detachSessionFromWorkspaces(ctx, null),
    /sessionId must be a non-empty string/
  );
});

test('createStandaloneSession: creates a session without workspaceId', async () => {
  let createdMeta = null;
  let createdId = null;
  const ctx = {
    sessions: {
      create: async (id, opts) => {
        createdId = id;
        createdMeta = opts.meta;
        return { id };
      },
    },
  };

  const result = await createStandaloneSession(ctx, { cwd: '/test/cwd', agentPreset: 'code' });
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, createdId);
  assert.equal(createdMeta.cwd, '/test/cwd');
  assert.equal(createdMeta.agentPreset, 'code');
});
