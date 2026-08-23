// dsh-plugin-no-workspace — host half.
//
// Owns the /no-workspace HTTP route and Cordis service orchestration:
// - POST /no-workspace/detach: Detaches a session from its owning workspace(s),
//   moving it into the standalone/direct chats view without losing session history.
// - POST /no-workspace/create: Creates a fresh standalone session without a workspace.
// - GET /no-workspace/status: Diagnostics endpoint.

import { homedir } from 'node:os';

const NO_WORKSPACE_PATH = '/no-workspace';

export const name = 'no-workspace';
export const inject = [
  'sessions',
  'agents',
  'sessionPersistence',
  'sessionQuery',
  'webServer',
  'workspaceRegistry',
];

function respondJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function requestJson(request) {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let text = '';
    request.on('data', (chunk) => {
      text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    });
    request.on('end', () => {
      try {
        text += decoder.decode();
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function sessionIdOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('sessionId must be a non-empty string.');
  }
  return value.trim();
}

/**
 * Detach a session from all workspaces it belongs to.
 */
export async function detachSessionFromWorkspaces(ctx, sessionId) {
  const targetId = sessionIdOf(sessionId);
  const registry = ctx.get('workspaceRegistry') || ctx.workspaceRegistry;
  if (!registry) {
    throw new Error('workspaceRegistry service is not available.');
  }

  const rawWorkspaces = typeof registry.list === 'function' ? registry.list() : [];
  const workspaces = Array.isArray(rawWorkspaces) ? rawWorkspaces : [];
  const matches = workspaces.filter(
    (w) => w && Array.isArray(w.sessionIds) && w.sessionIds.includes(targetId)
  );

  if (matches.length === 0) {
    return { ok: true, detached: false, message: 'Session is not attached to any workspace.' };
  }

  const fromWorkspaces = [];
  for (const workspace of matches) {
    if (typeof workspace.detachSession === 'function') {
      await workspace.detachSession(targetId);
      fromWorkspaces.push({
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
      });
    }
  }

  return {
    ok: true,
    detached: true,
    detachedCount: fromWorkspaces.length,
    fromWorkspaces,
  };
}

/**
 * Create a new standalone session without associating it with any workspace.
 */
export async function createStandaloneSession(ctx, options = {}) {
  const opts = options || {};
  const sessionId = opts.sessionId || `session-${crypto.randomUUID()}`;
  // A standalone chat has no project directory. Use the account home as its
  // neutral execution directory instead of inheriting the DSH server process's
  // launch directory (which is an implementation detail and varies by profile).
  const cwd = opts.cwd || homedir();

  const session = await ctx.sessions.create(sessionId, {
    meta: {
      cwd,
      ...opts.agentPreset ? { agentPreset: opts.agentPreset } : {},
    },
  });

  return {
    ok: true,
    sessionId: session?.id || sessionId,
  };
}

async function handleRoute(ctx, request, response) {
  const url = new URL(request.url || NO_WORKSPACE_PATH, 'http://no-workspace.local');
  const pathname = url.pathname.replace(/\/+$/, '');

  try {
    if (request.method === 'GET') {
      if (pathname === NO_WORKSPACE_PATH || pathname === `${NO_WORKSPACE_PATH}/status` || pathname === `${NO_WORKSPACE_PATH}/info`) {
        respondJson(response, 200, {
          ok: true,
          plugin: 'dsh-plugin-no-workspace',
          version: '1.0.0',
          features: ['detach', 'create-standalone', 'workspace-free'],
        });
        return;
      }
      respondJson(response, 404, { error: `Not found: ${url.pathname}` });
      return;
    }

    if (request.method === 'POST') {
      const body = await requestJson(request);

      if (pathname === `${NO_WORKSPACE_PATH}/detach` || body.action === 'detach') {
        const result = await detachSessionFromWorkspaces(ctx, body.sessionId);
        respondJson(response, 200, result);
        return;
      }

      if (pathname === `${NO_WORKSPACE_PATH}/create` || body.action === 'create') {
        const result = await createStandaloneSession(ctx, body);
        respondJson(response, 200, result);
        return;
      }

      respondJson(response, 400, { error: `Unknown action or path: ${pathname}` });
      return;
    }

    response.writeHead(405);
    response.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error instanceof TypeError || error instanceof SyntaxError) ? 400 : 500;
    respondJson(response, status, { error: message });
  }
}

export function apply(ctx) {
  const webServer = ctx.get('webServer') || ctx.webServer;
  if (webServer && typeof webServer.register === 'function') {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: NO_WORKSPACE_PATH,
      handler: (request, response) => handleRoute(ctx, request, response),
    }), 'no-workspace: HTTP route');
  }
}
