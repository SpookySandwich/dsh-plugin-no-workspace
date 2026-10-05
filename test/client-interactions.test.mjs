import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as React from 'react';

const tick = () => new Promise(resolve => setImmediate(resolve));
const summary = (id, fields = {}) => ({ id, blank: false, retainedBy: {}, ...fields });
const sessions = (...rows) => ({ phase: 'ready', ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])) });
const main = id => summary(id, { retainedBy: { mainView: 1 } });
const workspace = (workspaceId, ...sessionIds) => ({ workspaceId, sessionIds });
const response = value => ({ ok: true, json: async () => ({ ok: true, ...value }) });

function harness(t, { request } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://qa.test/' });
  let plugin;
  const requests = [];
  const opened = [];
  const errors = [];
  let sessionSnapshot = sessions(main('selected'));
  let workspaceSnapshot = { phase: 'ready', items: [], archivedSessionIds: [] };
  const listeners = new Set();
  const subscribe = fn => { const listener = () => fn(); listeners.add(listener); return () => listeners.delete(listener); };
  dom.window.__ModuleLoader__ = { load({ factory }) { plugin = factory(() => React); } };
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    MutationObserver: dom.window.MutationObserver, queueMicrotask,
    console: { ...console, error: (...args) => errors.push(args) }, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return request ? request(url, options) : response({ detached: true, sessionId: 'created' });
    },
  });
  const entry = { options: { priority: 0 }, component: function NativePicker() {} };
  const composer = { options: { priority: 0 }, component: function NativeComposer() {} };
  const nativeSidebar = function NativeSidebar() {};
  const sidebar = { options: { priority: 0 }, component: nativeSidebar };
  const nativeStarts = [];
  const nativeReceivers = [];
  const uiWorkspace = Object.create({
    startSession(workspaceId) { nativeStarts.push(workspaceId); nativeReceivers.push(this); return 'native-result'; },
    openSession(id) { opened.push(id); },
  });
  const originalStart = uiWorkspace.startSession;
  // DSH caches these closures before third-party plugins load. Every route
  // resolves the navigation method when invoked, including native IPC commands.
  const routes = {
    sidebar: () => uiWorkspace.startSession(),
    titleBar: () => uiWorkspace.startSession(),
    nativeMenu: () => uiWorkspace.startSession(),
    nativeChord: () => uiWorkspace.startSession(),
    webShortcut: () => uiWorkspace.startSession(),
  };
  const entries = { sidebar, 'shell.leading': sidebar, 'conversation.hero.workspace': entry, 'conversation.composer.bar': composer };
  const ctx = {
    effect(setup) { return setup(); },
    sessions: { list: { getSnapshot: () => sessionSnapshot, subscribe } },
    workspaces: { list: { getSnapshot: () => workspaceSnapshot, subscribe } },
    uiWorkspace,
    slots: { inject(_name, register) { register(); }, entries: name => entries[name] ? [entries[name]] : [], subscribe: () => () => {} },
  };
  const disposers = [plugin.apply(ctx)];
  t.after(() => { disposers.reverse().forEach(dispose => dispose()); dom.window.close(); });
  return {
    requests, opened, listeners, errors, nativeStarts, nativeReceivers, uiWorkspace, originalStart, routes,
    sidebar, nativeSidebar, composer,
    dispose: () => disposers[0](),
    reapply() { const dispose = plugin.apply(ctx); disposers.push(dispose); return dispose; },
    start(workspaceId) { return uiWorkspace.startSession(workspaceId); },
    pick(id, onPick = () => {}) {
      return entry.component({ useWorkspaces: select => select(workspaceSnapshot), onPick, onClose() {} }).props.onPick(id);
    },
    update(nextSessions, nextWorkspaces) {
      if (nextSessions) sessionSnapshot = nextSessions;
      if (nextWorkspaces) workspaceSnapshot = { ...workspaceSnapshot, ...nextWorkspaces };
      for (const fn of [...listeners]) fn();
    },
  };
}

test('No Workspace detaches the main-view conversation while the workspace feed is behind', async t => {
  const h = harness(t);
  h.update(sessions(summary('preview', { retainedBy: { preview: 1 } }), main('selected')));
  await h.pick('::dsh-no-workspace');
  assert.deepEqual(h.requests, [{ url: '/no-workspace/detach', body: { sessionId: 'selected' } }]);
  assert.deepEqual(h.opened, ['selected']);
});

for (const route of ['sidebar', 'titleBar', 'nativeMenu', 'nativeChord', 'webShortcut']) {
  test(`${route} uses the shared navigation action without replacing native components or keyboard dispatch`, async t => {
    const h = harness(t);
    await h.routes[route]();
    assert.deepEqual(h.requests, [{ url: '/no-workspace/create', body: {} }]);
    assert.deepEqual(h.opened, ['created']);
    assert.deepEqual(h.nativeStarts, []);
    assert.equal(h.sidebar.component, h.nativeSidebar);
  });
}

test('explicit workspace creation preserves the native receiver and return value', t => {
  const h = harness(t);
  assert.equal(h.start('workspace'), 'native-result');
  assert.deepEqual(h.nativeStarts, ['workspace']);
  assert.equal(h.nativeReceivers[0], h.uiWorkspace);
  assert.deepEqual(h.requests, []);
});

test('a standalone blank is reused without reusing attached, archived or subagent conversations', async t => {
  const h = harness(t);
  h.update(sessions(
    summary('attached', { blank: true }), summary('archived', { blank: true }),
    summary('child', { blank: true, origin: 'subagent' }), summary('standalone', { blank: true }),
  ), { items: [workspace('workspace', 'attached')], archivedSessionIds: ['archived'] });
  await h.start();
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.opened, ['standalone']);
});

test('No Workspace creates a standalone conversation when no main view is retained', async t => {
  const h = harness(t);
  h.update(sessions(summary('preview', { retainedBy: { preview: 1 } })));
  await h.pick('::dsh-no-workspace');
  assert.deepEqual(h.requests, [{ url: '/no-workspace/create', body: {} }]);
  assert.deepEqual(h.opened, ['created']);
});

for (const first of ['sessions', 'workspaces']) {
  test(`a quick No Workspace pick waits for both feeds when ${first} arrives first`, async t => {
    const h = harness(t);
    h.pick('destination-workspace');
    const picked = h.pick('::dsh-no-workspace');
    await tick();
    assert.equal(h.requests.length, 0);
    const nextSessions = sessions(main('destination-session'));
    const nextWorkspaces = { items: [workspace('destination-workspace', 'destination-session')] };
    h.update(first === 'sessions' ? nextSessions : null, first === 'workspaces' ? nextWorkspaces : null);
    await tick();
    assert.equal(h.requests.length, 0, 'Neither feed alone settles the transition');
    h.update(nextSessions, nextWorkspaces);
    await picked;
    assert.deepEqual(h.requests, [{ url: '/no-workspace/detach', body: { sessionId: 'destination-session' } }]);
    assert.deepEqual(h.opened, ['destination-session']);
    assert.equal(h.listeners.size, 0);
  });
}

test('repeated creation actions share one request and one navigation', async t => {
  let complete;
  const h = harness(t, { request: () => new Promise(resolve => { complete = resolve; }) });
  const first = h.routes.nativeChord();
  const second = h.routes.sidebar();
  await tick();
  assert.equal(h.requests.length, 1);
  complete(response({ sessionId: 'created' }));
  await Promise.all([first, second]);
  assert.deepEqual(h.opened, ['created']);
});

test('disposal restores the inherited navigation method and native actions', async t => {
  const h = harness(t);
  h.dispose();
  assert.equal(h.uiWorkspace.startSession, h.originalStart);
  assert.equal(Object.hasOwn(h.uiWorkspace, 'startSession'), false);
  assert.equal(h.routes.nativeMenu(), 'native-result');
  await tick();
  assert.deepEqual(h.requests, []);
});

test('disposal preserves a later wrapper while deactivating the old standalone adapter', async t => {
  const h = harness(t);
  const standalone = h.uiWorkspace.startSession;
  const later = function (...args) { return standalone.apply(this, args); };
  h.uiWorkspace.startSession = later;
  h.dispose();
  assert.equal(h.uiWorkspace.startSession, later);
  assert.equal(h.start(), 'native-result');
  await tick();
  assert.deepEqual(h.requests, []);
});

test('disposal cancels queued standalone actions and releases workspace subscriptions', async t => {
  const h = harness(t);
  h.pick('destination-workspace');
  const selected = h.pick('::dsh-no-workspace');
  const created = h.start();
  assert.equal(h.listeners.size, 2);
  h.dispose();
  await Promise.all([selected, created]);
  assert.equal(h.listeners.size, 0);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.errors, []);
});

for (const action of ['create', 'detach']) {
  test(`a late ${action} response after disposal cannot navigate a newly loaded plugin`, async t => {
    let complete;
    const h = harness(t, { request: () => new Promise(resolve => { complete = resolve; }) });
    const pending = action === 'create' ? h.start() : h.pick('::dsh-no-workspace');
    await tick();
    h.dispose();
    h.reapply();
    complete(response({ sessionId: 'late' }));
    await pending;
    assert.deepEqual(h.opened, []);
    assert.deepEqual(h.errors, []);
  });
}

test('native picker failures release navigation subscriptions immediately', t => {
  const h = harness(t);
  assert.throws(() => h.pick('workspace', () => { throw new Error('navigation failed'); }), /navigation failed/);
  assert.equal(h.listeners.size, 0);
});

test('standalone composer remains usable and native enabled composers keep their props', t => {
  const h = harness(t);
  const enabled = { sessionId: 'standalone', disabled: false };
  assert.deepEqual(h.composer.component(enabled).props, enabled);
  const adapted = h.composer.component({ sessionId: 'standalone', disabled: true, workspacePickerOpen: true, onRequestWorkspace() {} }).props;
  assert.equal(adapted.disabled, false);
  assert.equal(adapted.workspacePickerOpen, false);
  assert.equal(adapted.onRequestWorkspace, undefined);
});
