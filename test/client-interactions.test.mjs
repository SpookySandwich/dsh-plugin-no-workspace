import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as React from 'react';

function harness(t) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://qa.test/' });
  let plugin;
  const requests = [];
  const opened = [];
  let sessionSnapshot = { current: 'selected', ids: ['selected'], byId: {} };
  let workspaceSnapshot = { items: [] };
  const listeners = new Set();
  const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  dom.window.__ModuleLoader__ = { load({ factory }) { plugin = factory(() => React); } };
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    MutationObserver: dom.window.MutationObserver, queueMicrotask, console, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true, detached: true }) };
    },
  });
  const entry = { options: { priority: 0 }, component: function NativePicker() {} };
  const ctx = {
    sessions: { list: { getSnapshot: () => sessionSnapshot, subscribe }, open: id => opened.push(id) },
    workspaces: { list: { getSnapshot: () => workspaceSnapshot, subscribe } },
    slots: { inject(_name, register) { register(); },
      entries: name => name === 'conversation.hero.workspace' ? [entry] : [], subscribe: () => () => {} },
  };
  const dispose = plugin.apply(ctx);
  t.after(() => { dispose(); dom.window.close(); });
  return {
    requests, opened, listeners,
    pick(id) { entry.component({ useWorkspaces: select => select(workspaceSnapshot), onPick() {}, onClose() {} }).props.onPick(id); },
    update(sessions, workspaces) {
      if (sessions) sessionSnapshot = sessions;
      if (workspaces) workspaceSnapshot = workspaces;
      for (const fn of [...listeners]) fn();
    },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('No Workspace selection reaches the host when the workspace feed is behind the current session', async t => {
  const h = harness(t);
  h.pick('::dsh-no-workspace');
  await tick();
  assert.deepEqual(h.requests, [{ url: '/no-workspace/detach', body: { sessionId: 'selected' } }]);
  assert.deepEqual(h.opened, ['selected']);
});

test('a quick No Workspace pick waits for native workspace navigation and detaches its destination', async t => {
  const h = harness(t);
  h.pick('destination-workspace');
  h.pick('::dsh-no-workspace');
  await tick();
  assert.equal(h.requests.length, 0, 'The old selected conversation must not be detached');
  h.update(null, { items: [{ workspaceId: 'destination-workspace', sessionIds: ['destination-session'] }] });
  await tick();
  assert.equal(h.requests.length, 0, 'Workspace membership alone is not navigation completion');
  h.update({ current: 'destination-session' }, null);
  await tick();
  assert.deepEqual(h.requests, [{ url: '/no-workspace/detach', body: { sessionId: 'destination-session' } }]);
  assert.deepEqual(h.opened, ['destination-session']);
  assert.equal(h.listeners.size, 0, 'Navigation subscriptions are disposed after settlement');
});
