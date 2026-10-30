import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export const inject = ['workspaceRegistry', 'webServer', 'sessions', 'sessionProjections', 'sessionPersistence'];
export async function apply(ctx) {
  const home = resolve(process.env.DSH_HOME ?? '.');
  assert.equal(dirname(home), resolve(tmpdir()));
  assert.ok(basename(home).startsWith('dsh-no-workspace-e2e-'));
  const folder = join(home, 'fixture-workspace');
  await mkdir(folder, { recursive: true });
  const workspace = ctx.workspaceRegistry.list().find(w => w.path === folder)
    ?? await ctx.workspaceRegistry.create(folder, 'No Workspace acceptance');
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/qa/no-workspace',
    async handler(request, response) {
      if (request.method === 'DELETE') await ctx.workspaceRegistry.delete(workspace.id);
      const sessionId = new URL(request.url, 'http://qa.local').searchParams.get('sessionId');
      const session = sessionId && ctx.sessions.get(sessionId);
      const stored = sessionId ? await ctx.sessionPersistence.stat(sessionId) : undefined;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ sessionIds: [...workspace.sessionIds],
        memberships: sessionId ? ctx.workspaceRegistry.list().filter(w => w.sessionIds.includes(sessionId)).map(w => w.id) : [],
        agentPreset: session ? ctx.sessionProjections.stateOf(session, 'agentPreset') : stored?.header.agentPreset,
        stored: stored ?? null,
      }));
    },
  }));
}
