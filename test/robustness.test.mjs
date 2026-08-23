import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';
import {
  name,
  inject,
  apply,
  detachSessionFromWorkspaces,
  createStandaloneSession,
} from '../lib/index.js';

// Helper to spin up an HTTP server with the plugin handler captured from apply(ctx)
function createTestServer(ctxOverrides = {}) {
  let routeHandler = null;

  const fakeWebServer = {
    register({ kind, path, handler }) {
      routeHandler = handler;
    },
  };

  const defaultRegistry = {
    list() {
      return [
        {
          id: 'w1',
          title: 'Workspace 1',
          path: '/path/1',
          sessionIds: ['sess-1', 'sess-shared'],
          async detachSession(id) {
            this.sessionIds = this.sessionIds.filter((s) => s !== id);
          },
        },
        {
          id: 'w2',
          title: 'Workspace 2',
          path: '/path/2',
          sessionIds: ['sess-2', 'sess-shared'],
          async detachSession(id) {
            this.sessionIds = this.sessionIds.filter((s) => s !== id);
          },
        },
      ];
    },
  };

  const defaultSessions = {
    async create(id, opts) {
      return { id, meta: opts?.meta };
    },
  };

  const ctx = {
    webServer: fakeWebServer,
    workspaceRegistry: defaultRegistry,
    sessions: defaultSessions,
    get(key) {
      return this[key];
    },
    effect(fn) {
      fn();
    },
    ...ctxOverrides,
  };

  apply(ctx);

  if (!routeHandler) {
    throw new Error('Failed to capture route handler from apply()');
  }

  const server = http.createServer((req, res) => {
    routeHandler(req, res);
  });

  return {
    server,
    ctx,
    async start() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          resolve(`http://127.0.0.1:${addr.port}`);
        });
      });
    },
    async close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

describe('Robustness & Security QA Suite: dsh-plugin-no-workspace', () => {

  // =========================================================================
  // 1. CONCURRENCY & RACE CONDITIONS
  // =========================================================================
  describe('1. Concurrency & Race Condition Stress Tests', () => {
    it('handles 50 concurrent detaches on the SAME session without race conditions', async () => {
      let detachCallCount = 0;
      const workspace = {
        id: 'w1',
        title: 'Concurrent Workspace',
        path: '/workspace/concurrent',
        sessionIds: ['shared-target-session'],
        async detachSession(id) {
          detachCallCount++;
          // Simulate non-zero async I/O latency
          await new Promise((r) => setTimeout(r, 5));
          this.sessionIds = this.sessionIds.filter((s) => s !== id);
        },
      };

      const ctx = {
        get: (key) => (key === 'workspaceRegistry' ? { list: () => [workspace] } : undefined),
      };

      // Launch 50 concurrent detach calls
      const results = await Promise.all(
        Array.from({ length: 50 }, () =>
          detachSessionFromWorkspaces(ctx, 'shared-target-session')
        )
      );

      // All calls should resolve successfully
      for (const res of results) {
        assert.equal(res.ok, true);
        assert.ok(res.detached === true || res.detached === false);
      }

      // First callers found the session and detached it
      assert.ok(detachCallCount >= 1);
      // Final state: session is no longer in workspace
      assert.equal(workspace.sessionIds.includes('shared-target-session'), false);
    });

    it('handles 100 concurrent detaches across MULTIPLE distinct sessions', async () => {
      const sessionCount = 100;
      const sessionIds = Array.from({ length: sessionCount }, (_, i) => `session-${i}`);
      
      const workspaceA = {
        id: 'wa',
        title: 'Workspace A',
        path: '/path/a',
        sessionIds: [...sessionIds.slice(0, 50)],
        async detachSession(id) {
          await new Promise((r) => setTimeout(r, 1));
          this.sessionIds = this.sessionIds.filter((s) => s !== id);
        },
      };

      const workspaceB = {
        id: 'wb',
        title: 'Workspace B',
        path: '/path/b',
        sessionIds: [...sessionIds.slice(50, 100)],
        async detachSession(id) {
          await new Promise((r) => setTimeout(r, 1));
          this.sessionIds = this.sessionIds.filter((s) => s !== id);
        },
      };

      const ctx = {
        get: (key) =>
          key === 'workspaceRegistry'
            ? { list: () => [workspaceA, workspaceB] }
            : undefined,
      };

      const promises = sessionIds.map((id) => detachSessionFromWorkspaces(ctx, id));
      const results = await Promise.all(promises);

      assert.equal(results.length, 100);
      for (let i = 0; i < sessionCount; i++) {
        const res = results[i];
        assert.equal(res.ok, true);
        assert.equal(res.detached, true);
        assert.equal(res.detachedCount, 1);
        const expectedWs = i < 50 ? 'wa' : 'wb';
        assert.equal(res.fromWorkspaces[0].id, expectedWs);
      }

      assert.equal(workspaceA.sessionIds.length, 0);
      assert.equal(workspaceB.sessionIds.length, 0);
    });

    it('handles high-load mixed concurrent detaches (existing vs non-existing sessions)', async () => {
      const workspace = {
        id: 'w-mix',
        title: 'Mixed Workspace',
        path: '/path/mix',
        sessionIds: ['valid-1', 'valid-2', 'valid-3'],
        async detachSession(id) {
          this.sessionIds = this.sessionIds.filter((s) => s !== id);
        },
      };

      const ctx = {
        get: (key) => (key === 'workspaceRegistry' ? { list: () => [workspace] } : undefined),
      };

      const requests = [];
      for (let i = 0; i < 150; i++) {
        const target = i % 2 === 0 ? `valid-${(i % 3) + 1}` : `ghost-session-${i}`;
        requests.push(detachSessionFromWorkspaces(ctx, target));
      }

      const results = await Promise.all(requests);
      assert.equal(results.length, 150);
      for (const res of results) {
        assert.equal(res.ok, true);
      }
    });

    it('handles concurrent createStandaloneSession calls with unique UUID generation', async () => {
      const createdSessions = new Map();
      const ctx = {
        sessions: {
          async create(id, opts) {
            if (createdSessions.has(id)) {
              throw new Error(`Collision detected: ${id}`);
            }
            createdSessions.set(id, opts);
            return { id };
          },
        },
      };

      const count = 100;
      const tasks = Array.from({ length: count }, (_, i) =>
        createStandaloneSession(ctx, { cwd: `/cwd/${i}` })
      );

      const results = await Promise.all(tasks);
      assert.equal(results.length, count);
      const uniqueIds = new Set(results.map((r) => r.sessionId));
      assert.equal(uniqueIds.size, count);
      assert.equal(createdSessions.size, count);
    });
  });

  // =========================================================================
  // 2. DETACHING FROM MULTIPLE, ZERO, OR MALFORMED WORKSPACES
  // =========================================================================
  describe('2. Multi-workspace, Zero-workspace & Malformed Workspace Registry', () => {
    it('detaches a session belonging to ZERO workspaces gracefully', async () => {
      const ctx = {
        get: () => ({
          list: () => [
            { id: 'w1', sessionIds: ['s1', 's2'], detachSession: async () => {} },
            { id: 'w2', sessionIds: ['s3'], detachSession: async () => {} },
          ],
        }),
      };

      const result = await detachSessionFromWorkspaces(ctx, 'isolated-session');
      assert.deepEqual(result, {
        ok: true,
        detached: false,
        message: 'Session is not attached to any workspace.',
      });
    });

    it('detaches a session belonging to MULTIPLE (3+) workspaces simultaneously', async () => {
      const detachedCalls = [];
      const workspaces = [
        {
          id: 'w1',
          title: 'Workspace 1',
          path: '/w1',
          sessionIds: ['multi-sess', 'other-1'],
          async detachSession(id) {
            detachedCalls.push({ ws: 'w1', id });
          },
        },
        {
          id: 'w2',
          title: 'Workspace 2',
          path: '/w2',
          sessionIds: ['multi-sess', 'other-2'],
          async detachSession(id) {
            detachedCalls.push({ ws: 'w2', id });
          },
        },
        {
          id: 'w3',
          title: 'Workspace 3',
          path: '/w3',
          sessionIds: ['other-3'],
          async detachSession(id) {
            detachedCalls.push({ ws: 'w3', id });
          },
        },
        {
          id: 'w4',
          title: 'Workspace 4',
          path: '/w4',
          sessionIds: ['multi-sess'],
          async detachSession(id) {
            detachedCalls.push({ ws: 'w4', id });
          },
        },
      ];

      const ctx = {
        get: () => ({ list: () => workspaces }),
      };

      const result = await detachSessionFromWorkspaces(ctx, 'multi-sess');
      assert.equal(result.ok, true);
      assert.equal(result.detached, true);
      assert.equal(result.detachedCount, 3);
      assert.equal(result.fromWorkspaces.length, 3);
      assert.deepEqual(
        result.fromWorkspaces.map((w) => w.id),
        ['w1', 'w2', 'w4']
      );
      assert.equal(detachedCalls.length, 3);
    });

    it('handles workspaces with missing or corrupt sessionIds (null, undefined, non-array)', async () => {
      const ctx = {
        get: () => ({
          list: () => [
            null,
            undefined,
            {},
            { id: 'w-null', sessionIds: null, detachSession: async () => {} },
            { id: 'w-undefined', sessionIds: undefined, detachSession: async () => {} },
            { id: 'w-string', sessionIds: 'sess-1', detachSession: async () => {} },
            { id: 'w-number', sessionIds: 12345, detachSession: async () => {} },
            { id: 'w-obj', sessionIds: { 'sess-1': true }, detachSession: async () => {} },
            {
              id: 'w-valid',
              title: 'Valid',
              path: '/valid',
              sessionIds: ['sess-1'],
              detachSession: async () => {},
            },
          ],
        }),
      };

      const result = await detachSessionFromWorkspaces(ctx, 'sess-1');
      assert.equal(result.ok, true);
      assert.equal(result.detached, true);
      assert.equal(result.detachedCount, 1);
      assert.equal(result.fromWorkspaces[0].id, 'w-valid');
    });

    it('handles workspace without detachSession method without crashing', async () => {
      const ctx = {
        get: () => ({
          list: () => [
            {
              id: 'w-no-method',
              title: 'No Method',
              path: '/no-method',
              sessionIds: ['sess-orphan'],
              // detachSession is intentionally undefined
            },
          ],
        }),
      };

      const result = await detachSessionFromWorkspaces(ctx, 'sess-orphan');
      assert.equal(result.ok, true);
      assert.equal(result.detached, true);
      assert.equal(result.detachedCount, 0);
      assert.equal(result.fromWorkspaces.length, 0);
    });

    it('propagates error when workspace.detachSession throws an unexpected error', async () => {
      const ctx = {
        get: () => ({
          list: () => [
            {
              id: 'w-failing',
              title: 'Failing WS',
              path: '/fail',
              sessionIds: ['sess-fail'],
              async detachSession() {
                throw new Error('EACCES: permission denied during workspace state write');
              },
            },
          ],
        }),
      };

      await assert.rejects(
        () => detachSessionFromWorkspaces(ctx, 'sess-fail'),
        /EACCES: permission denied/
      );
    });

    it('throws when workspaceRegistry service is missing from context', async () => {
      const ctx = {
        get: () => undefined,
      };

      await assert.rejects(
        () => detachSessionFromWorkspaces(ctx, 'some-session'),
        /workspaceRegistry service is not available\./
      );
    });

    it('uses fallback ctx.workspaceRegistry if ctx.get returns undefined', async () => {
      const ctx = {
        get: () => undefined,
        workspaceRegistry: {
          list: () => [
            {
              id: 'fallback-ws',
              title: 'Fallback',
              path: '/fb',
              sessionIds: ['fb-sess'],
              detachSession: async () => {},
            },
          ],
        },
      };

      const result = await detachSessionFromWorkspaces(ctx, 'fb-sess');
      assert.equal(result.ok, true);
      assert.equal(result.detached, true);
      assert.equal(result.fromWorkspaces[0].id, 'fallback-ws');
    });

    it('handles registry where list() is not a function gracefully', async () => {
      const ctx = {
        get: () => ({
          list: null, // not a function
        }),
      };

      const result = await detachSessionFromWorkspaces(ctx, 'any-session');
      assert.equal(result.ok, true);
      assert.equal(result.detached, false);
      assert.equal(result.message, 'Session is not attached to any workspace.');
    });

    it('handles registry where list() returns non-array (null/undefined) gracefully', async () => {
      const ctx = {
        get: () => ({
          list: () => null,
        }),
      };

      const result = await detachSessionFromWorkspaces(ctx, 'any-session');
      assert.equal(result.ok, true);
      assert.equal(result.detached, false);
    });
  });

  // =========================================================================
  // 3. SESSION ID VALIDATION & INJECTION / ATTACK PAYLOADS
  // =========================================================================
  describe('3. Session ID Validation & Malicious Payloads', () => {
    const invalidSessionIds = [
      { label: 'null', val: null },
      { label: 'undefined', val: undefined },
      { label: 'empty string', val: '' },
      { label: 'spaces only', val: '   ' },
      { label: 'tabs and newlines only', val: '\t\n\r  ' },
      { label: 'number integer', val: 12345 },
      { label: 'number float', val: 3.1415 },
      { label: 'boolean true', val: true },
      { label: 'boolean false', val: false },
      { label: 'empty object', val: {} },
      { label: 'array', val: ['s1'] },
      { label: 'function', val: () => {} },
      { label: 'symbol', val: Symbol('s1') },
      { label: 'NaN', val: NaN },
      { label: 'Infinity', val: Infinity },
    ];

    for (const { label, val } of invalidSessionIds) {
      it(`rejects invalid sessionId type/value (${label}) with TypeError`, async () => {
        const ctx = { get: () => ({ list: () => [] }) };
        await assert.rejects(
          () => detachSessionFromWorkspaces(ctx, val),
          (err) => {
            assert.ok(err instanceof TypeError);
            assert.match(err.message, /sessionId must be a non-empty string\./);
            return true;
          }
        );
      });
    }

    it('trims leading and trailing whitespace from valid sessionId before lookup', async () => {
      let passedTarget = null;
      const ctx = {
        get: () => ({
          list: () => [
            {
              id: 'w1',
              title: 'W1',
              path: '/w1',
              sessionIds: ['valid-trimmed-id'],
              detachSession: async (id) => {
                passedTarget = id;
              },
            },
          ],
        }),
      };

      const result = await detachSessionFromWorkspaces(ctx, '   \t valid-trimmed-id \n  ');
      assert.equal(result.ok, true);
      assert.equal(result.detached, true);
      assert.equal(passedTarget, 'valid-trimmed-id');
    });

    const attackPayloads = [
      { type: 'Path Traversal (Unix)', payload: '../../../../etc/passwd' },
      { type: 'Path Traversal (Windows)', payload: '..\\..\\Windows\\System32\\calc.exe' },
      { type: 'Path Traversal (Absolute)', payload: '/etc/shadow' },
      { type: 'SQL Injection 1', payload: "' OR '1'='1" },
      { type: 'SQL Injection 2', payload: '"; DROP TABLE sessions; --' },
      { type: 'Command Injection (Bash)', payload: '; rm -rf / ; echo 1' },
      { type: 'Command Injection (Subshell)', payload: '$(whoami)' },
      { type: 'Command Injection (Windows)', payload: '& calc.exe &' },
      { type: 'Command Injection (Pipe)', payload: '| net user evil /add' },
      { type: 'XSS Script Tag', payload: '<script>alert(document.cookie)</script>' },
      { type: 'XSS Image Tag', payload: '<img src=x onerror=alert(1)>' },
      { type: 'XSS SVG Tag', payload: '<svg/onload=alert`xss`>' },
      { type: 'Null Byte Injection', payload: 'session\x00_hidden' },
      { type: 'Control Characters (Escape/Bell)', payload: '\x1b[31mRed\x07' },
      { type: 'Unicode RTL Override', payload: '\u202Ereversed_id\u202D' },
      { type: 'Unicode Emojis & Multibyte', payload: '👾-session-🚀-🔥-123' },
      { type: 'Massive string (100,000 chars)', payload: 's'.repeat(100000) },
    ];

    for (const { type, payload } of attackPayloads) {
      it(`safely handles malicious / unusual sessionId string: ${type}`, async () => {
        let searchedTarget = null;
        const ctx = {
          get: () => ({
            list: () => [
              {
                id: 'w1',
                title: 'W1',
                path: '/w1',
                sessionIds: [payload.trim()],
                detachSession: async (id) => {
                  searchedTarget = id;
                },
              },
            ],
          }),
        };

        const result = await detachSessionFromWorkspaces(ctx, payload);
        assert.equal(result.ok, true);
        assert.equal(result.detached, true);
        assert.equal(searchedTarget, payload.trim());
      });
    }
  });

  // =========================================================================
  // 4. HTTP ENDPOINT ERROR RESPONSES, MALFORMED JSON & OVERSIZED PAYLOADS
  // =========================================================================
  describe('4. HTTP Endpoint Robustness, Error Responses & Security', () => {
    let app;
    let baseUrl;

    test.before(async () => {
      app = createTestServer();
      baseUrl = await app.start();
    });

    test.after(async () => {
      await app.close();
    });

    it('GET /no-workspace, /no-workspace/status, /no-workspace/info return 200 with metadata', async () => {
      const endpoints = ['/no-workspace', '/no-workspace/status', '/no-workspace/info'];
      for (const ep of endpoints) {
        const res = await fetch(`${baseUrl}${ep}`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
        assert.equal(res.headers.get('cache-control'), 'no-store');
        const json = await res.json();
        assert.equal(json.ok, true);
        assert.equal(json.plugin, 'dsh-plugin-no-workspace');
        assert.equal(json.version, '1.0.0');
        assert.deepEqual(json.features, ['detach', 'create-standalone', 'workspace-free']);
      }
    });

    it('GET with trailing slashes (/no-workspace/, /no-workspace/status/) normalizes and returns 200', async () => {
      const res = await fetch(`${baseUrl}/no-workspace/status/`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, true);
    });

    it('GET /no-workspace/unrecognized returns 404 Not Found', async () => {
      const res = await fetch(`${baseUrl}/no-workspace/unrecognized`);
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.match(json.error, /Not found: \/no-workspace\/unrecognized/);
    });

    it('rejects unsupported HTTP methods (PUT, DELETE, PATCH, OPTIONS) with 405 Method Not Allowed', async () => {
      const methods = ['PUT', 'DELETE', 'PATCH', 'OPTIONS'];
      for (const method of methods) {
        const res = await fetch(`${baseUrl}/no-workspace/detach`, {
          method,
          body: method === 'OPTIONS' ? undefined : JSON.stringify({ sessionId: 's1' }),
        });
        assert.equal(res.status, 405, `Method ${method} should return 405`);
      }
    });

    it('POST /no-workspace/detach returns 400 when sessionId is missing, null, or empty string', async () => {
      const badBodies = [
        {},
        { sessionId: '' },
        { sessionId: '   ' },
        { sessionId: null },
        { sessionId: 12345 },
        { sessionId: {} },
      ];

      for (const body of badBodies) {
        const res = await fetch(`${baseUrl}/no-workspace/detach`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        assert.equal(res.status, 400);
        const json = await res.json();
        assert.match(json.error, /sessionId must be a non-empty string\./);
      }
    });

    it('POST /no-workspace/detach successfully detaches valid session', async () => {
      const res = await fetch(`${baseUrl}/no-workspace/detach`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-1' }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, true);
      assert.equal(json.detached, true);
      assert.equal(json.detachedCount, 1);
    });

    it('POST /no-workspace with { action: "detach" } works via body routing', async () => {
      const res = await fetch(`${baseUrl}/no-workspace`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'detach', sessionId: 'sess-2' }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, true);
      assert.equal(json.detached, true);
      assert.equal(json.detachedCount, 1);
    });

    it('POST /no-workspace/create successfully creates standalone session', async () => {
      const res = await fetch(`${baseUrl}/no-workspace/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/custom/path', agentPreset: 'architect' }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, true);
      assert.match(json.sessionId, /^session-/);
    });

    it('POST /no-workspace with { action: "create" } works via body routing', async () => {
      const res = await fetch(`${baseUrl}/no-workspace`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', sessionId: 'fixed-sess-id' }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, true);
      assert.equal(json.sessionId, 'fixed-sess-id');
    });

    it('POST /no-workspace/unknown returns 400 for unknown action or subpath', async () => {
      const res = await fetch(`${baseUrl}/no-workspace/unknown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'destroy_everything' }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.error, /Unknown action or path/);
    });

    it('POST with MALFORMED JSON returns 400 error response without crashing server', async () => {
      const malformedPayloads = [
        '{"sessionId": "s1",',               // unclosed object
        '{"action": "create", "options": ',  // truncated
        '{sessionId: s1}',                   // unquoted keys and strings
        'This is completely plain text',     // not JSON at all
        '{"a": 1}{"b": 2}',                  // double JSON
        '\x00\x01\x02\x03\xFF',              // binary junk
      ];

      for (const malformed of malformedPayloads) {
        const res = await fetch(`${baseUrl}/no-workspace/detach`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: malformed,
        });
        assert.equal(res.status, 400);
        const json = await res.json();
        assert.ok(typeof json.error === 'string');
      }
    });

    it('POST with EMPTY BODY (0 bytes) returns expected fallback response', async () => {
      // For create: empty body resolves to {} and creates session
      const createRes = await fetch(`${baseUrl}/no-workspace/create`, {
        method: 'POST',
      });
      assert.equal(createRes.status, 200);
      const createJson = await createRes.json();
      assert.equal(createJson.ok, true);
      assert.match(createJson.sessionId, /^session-/);

      // For detach: empty body has no sessionId, so should return 400
      const detachRes = await fetch(`${baseUrl}/no-workspace/detach`, {
        method: 'POST',
      });
      assert.equal(detachRes.status, 400);
      const detachJson = await detachRes.json();
      assert.match(detachJson.error, /sessionId must be a non-empty string/);
    });

    it('handles OVERSIZED PAYLOADS (1MB+) streamed in multiple chunks', async () => {
      const largePadding = 'A'.repeat(1024 * 1024); // 1 MB string
      const largePayload = JSON.stringify({
        sessionId: 'sess-shared',
        padding: largePadding,
      });

      const res = await fetch(`${baseUrl}/no-workspace/detach`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: largePayload,
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, true);
      assert.equal(json.detached, true);
    });

    it('handles network / stream error on request without crashing', async () => {
      // Create a mock stream that emits an error
      const mockReq = new EventEmitter();
      mockReq.url = '/no-workspace/detach';
      mockReq.method = 'POST';

      let responseStatus = null;
      let responseBody = '';
      const mockRes = {
        writeHead(status, headers) {
          responseStatus = status;
        },
        end(chunk) {
          responseBody = chunk;
        },
      };

      // Emulate route handler processing mockReq
      const serverApp = createTestServer();
      const testUrl = await serverApp.start();
      await serverApp.close();

      // Trigger requestJson with stream error
      const capturedHandler = app.server.listeners('request')[0];
      
      const handlerPromise = capturedHandler(mockReq, mockRes);
      // Emit error after listener attaches
      mockReq.emit('error', new Error('Simulated socket abort / ECONNRESET'));
      await handlerPromise;

      assert.equal(responseStatus, 500);
      const json = JSON.parse(responseBody);
      assert.match(json.error, /Simulated socket abort/);
    });

    it('returns 500 when backend service throws unexpected runtime error during POST', async () => {
      const brokenApp = createTestServer({
        workspaceRegistry: {
          list() {
            throw new Error('Database locked / storage failure');
          },
        },
      });
      const brokenUrl = await brokenApp.start();

      try {
        const res = await fetch(`${brokenUrl}/no-workspace/detach`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: 's1' }),
        });
        assert.equal(res.status, 500);
        const json = await res.json();
        assert.match(json.error, /Database locked/);
      } finally {
        await brokenApp.close();
      }
    });
  });

  // =========================================================================
  // 5. CREATE STANDALONE SESSION OPTIONS MATRIX & EDGE CASES
  // =========================================================================
  describe('5. createStandaloneSession Options & Edge Cases Matrix', () => {
    it('handles undefined / empty options object with standard defaults', async () => {
      let createdId = null;
      let createdMeta = null;
      const ctx = {
        sessions: {
          create: async (id, opts) => {
            createdId = id;
            createdMeta = opts.meta;
            return { id };
          },
        },
      };

      const result = await createStandaloneSession(ctx);
      assert.equal(result.ok, true);
      assert.match(result.sessionId, /^session-[0-9a-f-]+$/);
      assert.equal(result.sessionId, createdId);
      assert.equal(createdMeta.cwd, homedir());
      assert.equal('agentPreset' in createdMeta, false);
    });

    it('handles explicit null options object without crashing', async () => {
      let createdId = null;
      let createdMeta = null;
      const ctx = {
        sessions: {
          create: async (id, opts) => {
            createdId = id;
            createdMeta = opts.meta;
            return { id };
          },
        },
      };

      const result = await createStandaloneSession(ctx, null);
      assert.equal(result.ok, true);
      assert.match(result.sessionId, /^session-[0-9a-f-]+$/);
      assert.equal(result.sessionId, createdId);
      assert.equal(createdMeta.cwd, homedir());
      assert.equal('agentPreset' in createdMeta, false);
    });

    it('preserves explicitly provided custom sessionId', async () => {
      let createdId = null;
      const ctx = {
        sessions: {
          create: async (id) => {
            createdId = id;
            return { id };
          },
        },
      };

      const result = await createStandaloneSession(ctx, { sessionId: 'my-custom-id-999' });
      assert.equal(result.ok, true);
      assert.equal(result.sessionId, 'my-custom-id-999');
      assert.equal(createdId, 'my-custom-id-999');
    });

    const cwdVariations = [
      { label: 'Standard Windows path', cwd: 'D:\\Projects\\Workspace-1' },
      { label: 'Standard POSIX path', cwd: '/home/developer/repo' },
      { label: 'Relative path', cwd: './sub/folder' },
      { label: 'Path with spaces', cwd: '/var/app/My Project (Draft) [1]/' },
      { label: 'Path with special symbols', cwd: '/tmp/!@#$%^&*()_+{}[]|:;' },
      { label: 'Path with Unicode & Emojis', cwd: '/work/📁/项目/🌟/üñîçødé' },
      { label: 'Path traversal notation', cwd: '../../../../etc/nginx' },
      { label: 'Path with single and double quotes', cwd: '/data/"quotes"/\'single\'' },
      { label: 'Extremely long cwd path (4096 chars)', cwd: '/x/' + 'a'.repeat(4090) },
      { label: 'Path with null byte', cwd: '/safe/path\0/hidden' },
      { label: 'Path with newlines and tabs', cwd: '/path\n/with\t/whitespace' },
    ];

    for (const { label, cwd } of cwdVariations) {
      it(`handles cwd variation: ${label}`, async () => {
        let recordedCwd = null;
        const ctx = {
          sessions: {
            create: async (id, opts) => {
              recordedCwd = opts.meta.cwd;
              return { id };
            },
          },
        };

        const result = await createStandaloneSession(ctx, { cwd });
        assert.equal(result.ok, true);
        assert.equal(recordedCwd, cwd);
      });
    }

    const agentPresets = [
      { label: 'Standard preset name', val: 'coder', expectIncluded: true },
      { label: 'Special chars preset', val: 'agent:v2.0@beta#1', expectIncluded: true },
      { label: 'Empty string preset', val: '', expectIncluded: false },
      { label: 'Undefined preset', val: undefined, expectIncluded: false },
      { label: 'Null preset', val: null, expectIncluded: false },
      { label: 'Boolean false preset', val: false, expectIncluded: false },
    ];

    for (const { label, val, expectIncluded } of agentPresets) {
      it(`handles agentPreset variation: ${label}`, async () => {
        let recordedMeta = null;
        const ctx = {
          sessions: {
            create: async (id, opts) => {
              recordedMeta = opts.meta;
              return { id };
            },
          },
        };

        const result = await createStandaloneSession(ctx, { agentPreset: val });
        assert.equal(result.ok, true);
        if (expectIncluded) {
          assert.equal(recordedMeta.agentPreset, val);
        } else {
          assert.equal('agentPreset' in recordedMeta, false);
        }
      });
    }

    it('ignores extraneous unrecognized options safely', async () => {
      let passedOpts = null;
      const ctx = {
        sessions: {
          create: async (id, opts) => {
            passedOpts = opts;
            return { id };
          },
        },
      };

      const result = await createStandaloneSession(ctx, {
        cwd: '/test/cwd',
        agentPreset: 'planner',
        maliciousPayload: '<script>alert(1)</script>',
        __proto__: { evil: true },
        extraConfig: { nested: 123 },
      });

      assert.equal(result.ok, true);
      assert.deepEqual(passedOpts.meta, {
        cwd: '/test/cwd',
        agentPreset: 'planner',
      });
    });

    it('falls back to generated sessionId if ctx.sessions.create returns an object without id', async () => {
      const ctx = {
        sessions: {
          create: async () => {
            return {}; // no id field returned
          },
        },
      };

      const result = await createStandaloneSession(ctx, { sessionId: 'my-explicit-id' });
      assert.equal(result.ok, true);
      assert.equal(result.sessionId, 'my-explicit-id');
    });

    it('propagates rejection when ctx.sessions.create fails', async () => {
      const ctx = {
        sessions: {
          create: async () => {
            throw new Error('QuotaExceeded: maximum sessions reached');
          },
        },
      };

      await assert.rejects(
        () => createStandaloneSession(ctx),
        /QuotaExceeded: maximum sessions reached/
      );
    });
  });

  // =========================================================================
  // 6. PLUGIN METADATA & APPLY LIFECYCLE
  // =========================================================================
  describe('6. Plugin Lifecycle & Cordis Metadata', () => {
    it('exports correct plugin name and inject array', () => {
      assert.equal(name, 'no-workspace');
      assert.ok(Array.isArray(inject));
      assert.ok(inject.includes('sessions'));
      assert.ok(inject.includes('webServer'));
      assert.ok(inject.includes('workspaceRegistry'));
    });

    it('apply() does nothing if webServer is not available', () => {
      const ctx = {
        get: () => undefined,
        effect: () => {
          throw new Error('Should not be called');
        },
      };

      assert.doesNotThrow(() => apply(ctx));
    });

    it('apply() does nothing if webServer.register is not a function', () => {
      const ctx = {
        get: (k) => (k === 'webServer' ? {} : undefined),
        effect: () => {
          throw new Error('Should not be called');
        },
      };

      assert.doesNotThrow(() => apply(ctx));
    });

    it('apply() registers prefix route correctly with ctx.effect', () => {
      let registered = null;
      let effectDesc = null;
      const ctx = {
        get: (k) =>
          k === 'webServer'
            ? {
                register(spec) {
                  registered = spec;
                },
              }
            : undefined,
        effect(fn, desc) {
          effectDesc = desc;
          fn();
        },
      };

      apply(ctx);
      assert.ok(registered);
      assert.equal(registered.kind, 'prefix');
      assert.equal(registered.path, '/no-workspace');
      assert.equal(typeof registered.handler, 'function');
      assert.equal(effectDesc, 'no-workspace: HTTP route');
    });
  });
});

