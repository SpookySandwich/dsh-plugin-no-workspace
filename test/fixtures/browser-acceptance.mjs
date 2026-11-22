import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export const inject = ['workspaceRegistry', 'webServer', 'sessions', 'sessionProjections', 'sessionPersistence', 'sessionController'];
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
      if (request.method === 'PATCH') {
        const title = new URL(request.url, 'http://qa.local').searchParams.get('title');
        assert.ok(['No Workspace', 'Choose workspace', '研究資料', 'No Workspace acceptance'].includes(title));
        await workspace.setTitle(title);
      }
      const params = new URL(request.url, 'http://qa.local').searchParams;
      let sessionId = params.get('sessionId');
      if (request.method === 'POST' && !sessionId) {
        ({ sessionId } = await ctx.sessionController.create({ workspaceId: workspace.id }));
      }
      const session = sessionId && ctx.sessions.get(sessionId);
      if (request.method === 'POST') {
        const { createUserMessage } = await import('@deepseek-ai/dsh-llm');
        session.append('turn/start', { turn: 1 });
        session.append('user/message', createUserMessage({ source: { kind: 'user' },
          content: [{ type: 'text', text: `Persisted message for ${sessionId}` }],
        }), { surfaceOp: 'append' });
        const reason = params.has('failed') ? { kind: 'error', error: { code: 'UNKNOWN', message: 'Fixture failure' } } : { kind: 'completed' };
        session.append('turn/end', { turn: 1, reason });
        await ctx.sessionPersistence.flush();
      }
      const stored = sessionId ? await ctx.sessionPersistence.stat(sessionId) : undefined;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ workspaceId: workspace.id, sessionIds: [...workspace.sessionIds],
        memberships: sessionId ? ctx.workspaceRegistry.list().filter(w => w.sessionIds.includes(sessionId)).map(w => w.id) : [],
        agentPreset: session ? ctx.sessionProjections.stateOf(session, 'agentPreset') : stored?.header.agentPreset,
        stored: stored ?? null,
      }));
    },
  }));
}
