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

function harness(t, { request, draftResult = 'applied', locale = 'en' } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://qa.test/' });
  dom.window.document.documentElement.lang = locale;
  let plugin;
  const requests = [];
  const opened = [];
  const errors = [];
  const drafts = [];
  const notices = [];
  const retained = new Set();
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
  const nativeOptions = [];
  const nativeReceivers = [];
  const uiWorkspace = Object.create({
    startSession(workspaceId, options) { nativeStarts.push(workspaceId); nativeOptions.push(options); nativeReceivers.push(this); return 'native-result'; },
    openSession(id) { opened.push(id); },
    notify(notice) { notices.push(notice); },
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
    sessions: {
      list: { getSnapshot: () => sessionSnapshot, subscribe },
      retain(id) {
        retained.add(id);
        return { binding: { sessionId: id }, release() { retained.delete(id); } };
      },
    },
    conversation: { input: { requestDraftInitialization(binding, options) {
      assert.ok(retained.has(binding.sessionId));
      drafts.push({ sessionId: binding.sessionId, ...options });
      return draftResult;
    } } },
    workspaces: { list: { getSnapshot: () => workspaceSnapshot, subscribe } },
    uiWorkspace,
    slots: { inject(_name, register) { register(); }, entries: name => entries[name] ? [entries[name]] : [], subscribe: () => () => {} },
  };
  const disposers = [plugin.apply(ctx)];
  t.after(() => { disposers.reverse().forEach(dispose => dispose()); dom.window.close(); });
  return {
    requests, opened, listeners, errors, nativeStarts, nativeOptions, nativeReceivers, uiWorkspace, originalStart, routes,
    sidebar, nativeSidebar, composer, drafts, notices, retained, document: dom.window.document,
    dispose: () => disposers[0](),
    reapply() { const dispose = plugin.apply(ctx); disposers.push(dispose); return dispose; },
    start(workspaceId, options) { return uiWorkspace.startSession(workspaceId, options); },
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

for (const hasWorkspace of [false, true]) {
  test(`preset and draft creation stays standalone with workspace=${hasWorkspace}`, async t => {
    const h = harness(t);
    h.update(sessions(main('selected'), summary('standalone', { blank: true })),
      { items: hasWorkspace ? [workspace('current', 'selected')] : [] });
    await h.start(undefined, { agentPreset: 'cordis', prompt: 'Prepare this draft', clearPreviousDraft: true });
    assert.deepEqual(h.requests, [{ url: '/no-workspace/create', body: { agentPreset: 'cordis' } }]);
    assert.deepEqual(h.nativeStarts, []);
    assert.deepEqual(h.opened, ['created']);
    assert.deepEqual(h.drafts, [{ sessionId: 'created', prompt: 'Prepare this draft', clearPreviousDraft: true }]);
    assert.equal(h.retained.size, 0);
  });
}

test('preset helper without initial text creates a fresh standalone with the requested preset', async t => {
  const h = harness(t);
  h.update(sessions(summary('other-preset', { blank: true })));
  await h.start(undefined, { agentPreset: 'cordis', clearPreviousDraft: false });
  assert.deepEqual(h.requests, [{ url: '/no-workspace/create', body: { agentPreset: 'cordis' } }]);
  assert.deepEqual(h.opened, ['created']);
  assert.deepEqual(h.drafts, []);
});

for (const clearPreviousDraft of [false, true]) {
  test(`draft-only requests reuse standalone blanks and pass clearPreviousDraft=${clearPreviousDraft}`, async t => {
    const h = harness(t, { draftResult: clearPreviousDraft ? 'applied' : 'preserved' });
    h.update(sessions(summary('attached', { blank: true }), summary('standalone', { blank: true })),
      { items: [workspace('recent', 'attached')] });
    await h.start(undefined, { prompt: 'Requested draft', clearPreviousDraft });
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.opened, ['standalone']);
    assert.deepEqual(h.drafts, [{ sessionId: 'standalone', prompt: 'Requested draft', clearPreviousDraft }]);
    assert.deepEqual(h.notices, []);
    assert.equal(h.retained.size, 0);
  });
}

for (const whenDraftExists of ['keep', 'replace', 'append']) {
  test(`explicit draft policy ${whenDraftExists} reaches the native input resolver`, async t => {
    const h = harness(t);
    await h.start(undefined, { prompt: 'Next paragraph', clearPreviousDraft: true, whenDraftExists });
    assert.equal(h.drafts[0].whenDraftExists, whenDraftExists);
  });
}

test('replace without a prompt clears the selected standalone draft', async t => {
  const h = harness(t);
  h.update(sessions(summary('selected', { blank: true, retainedBy: { mainView: 1 } })));
  await h.start(undefined, { whenDraftExists: 'replace' });
  assert.equal(h.drafts.length, 1);
  assert.equal(h.drafts[0].whenDraftExists, 'replace');
});

test('different concurrent draft policies are not coalesced', async t => {
  const h = harness(t);
  await Promise.all(['keep', 'replace'].map(whenDraftExists => h.start(undefined, {
    agentPreset: 'cordis', prompt: 'Draft', whenDraftExists,
  })));
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.drafts.map(d => d.whenDraftExists), ['keep', 'replace']);
});

test('Creator preserves a selected blank that lists a different preset', async t => {
  const h = harness(t);
  h.update(sessions(summary('selected', { blank: true, retainedBy: { mainView: 1 },
    projectionValues: { agentPreset: 'standard' } })));
  await h.start(undefined, { agentPreset: 'cordis', clearPreviousDraft: false });
  assert.deepEqual(h.requests, [{ url: '/no-workspace/create', body: { agentPreset: 'cordis' } }]);
  assert.deepEqual(h.opened, ['created']);
});

test('blocked draft initialization shows a creation refusal and leaves the current view selected', async t => {
  const h = harness(t, { draftResult: 'blocked' });
  await h.start(undefined, { prompt: 'Requested draft' });
  assert.deepEqual(h.opened, []);
  assert.equal(h.notices[0].kind, 'createFailed');
  assert.match(h.notices[0].message, /Could not fill the draft/);
  assert.equal(h.retained.size, 0);
});

test('different concurrent preset requests retain their own creation and draft options', async t => {
  let count = 0;
  const h = harness(t, { request: async () => response({ sessionId: `created-${++count}` }) });
  await Promise.all(['first', 'second'].map(agentPreset => h.start(undefined, { agentPreset, prompt: agentPreset })));
  assert.deepEqual(h.requests.map(r => r.body.agentPreset), ['first', 'second']);
  assert.deepEqual(h.drafts.map(d => [d.sessionId, d.prompt]), [['created-1', 'first'], ['created-2', 'second']]);
});

test('late preset creation after disposal cannot prepare a draft or navigate', async t => {
  let complete;
  const h = harness(t, { request: () => new Promise(resolve => { complete = resolve; }) });
  const pending = h.start(undefined, { agentPreset: 'cordis', prompt: 'late' });
  await tick();
  h.dispose();
  complete(response({ sessionId: 'late' }));
  await pending;
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.drafts, []);
});

test('explicit workspace creation forwards DSH draft/preset options', t => {
  const h = harness(t);
  const options = { agentPreset: 'cordis', clearPreviousDraft: false };
  assert.equal(h.start('workspace', options), 'native-result');
  assert.deepEqual(h.nativeStarts, ['workspace']);
  assert.equal(h.nativeOptions[0], options);
  assert.equal(h.nativeReceivers[0], h.uiWorkspace);
  assert.deepEqual(h.requests, []);
});

test('draft requests reuse a standalone blank without reusing attached, archived or subagent conversations', async t => {
  const h = harness(t);
  h.update(sessions(
    summary('attached', { blank: true }), summary('archived', { blank: true }),
    summary('child', { blank: true, origin: 'subagent' }), summary('standalone', { blank: true }),
  ), { items: [workspace('workspace', 'attached')], archivedSessionIds: ['archived'] });
  await h.start(undefined, { prompt: 'Draft' });
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.opened, ['standalone']);
});

test('preset helper reuses only the current eligible standalone blank through the host', async t => {
  const h = harness(t, { request: async (_url, options) => response({ sessionId: JSON.parse(options.body).sessionId }) });
  h.update(sessions(summary('other-blank', { blank: true }), summary('selected', { blank: true, cwd: '/detached/project', retainedBy: { mainView: 1 } })));
  await h.start(undefined, { agentPreset: 'cordis', clearPreviousDraft: false });
  assert.deepEqual(h.requests, [{ url: '/no-workspace/create', body: { sessionId: 'selected', cwd: '/detached/project', agentPreset: 'cordis' } }]);
  assert.deepEqual(h.opened, ['selected']);
  assert.deepEqual(h.nativeStarts, []);
});

for (const kind of ['attached', 'archived', 'subagent', 'started']) {
  test(`preset request cannot adopt the current ${kind} session or another blank`, async t => {
    const h = harness(t);
    h.update(sessions(summary('other', { blank: true }), summary('selected', {
      blank: kind !== 'started', origin: kind === 'subagent' ? 'subagent' : undefined, retainedBy: { mainView: 1 },
    })), { items: kind === 'attached' ? [workspace('current', 'selected')] : [], archivedSessionIds: kind === 'archived' ? ['selected'] : [] });
    await h.start(undefined, { agentPreset: 'cordis' });
    assert.deepEqual(h.requests, [{ url: '/no-workspace/create', body: { agentPreset: 'cordis' } }]);
  });
}

test('host refusal to reuse a stale blank opens the actual returned session', async t => {
  const h = harness(t);
  h.update(sessions(summary('selected', { blank: true, retainedBy: { mainView: 1 } })));
  await h.start(undefined, { agentPreset: 'cordis', prompt: 'New draft' });
  assert.equal(h.requests[0].body.sessionId, 'selected');
  assert.deepEqual(h.opened, ['created']);
  assert.equal(h.drafts[0].sessionId, 'created');
});

test('plain New Session creates a default blank instead of reopening a leftover Creator blank', async t => {
  const h = harness(t);
  h.update(sessions(summary('creator', { blank: true, projectionValues: { agentPreset: 'cordis' }, retainedBy: { mainView: 1 } })));
  await h.start();
  assert.deepEqual(h.requests, [{ url: '/no-workspace/create', body: {} }]);
  assert.deepEqual(h.opened, ['created']);
});

test('identical concurrent preset requests share one host creation and navigation', async t => {
  let complete;
  const h = harness(t, { request: () => new Promise(resolve => { complete = resolve; }) });
  const options = { agentPreset: 'cordis', clearPreviousDraft: false };
  const first = h.start(undefined, options);
  const second = h.start(undefined, { ...options });
  await tick();
  assert.equal(h.requests.length, 1);
  complete(response({ sessionId: 'created' }));
  await Promise.all([first, second]);
  assert.deepEqual(h.opened, ['created']);
});

test('blocked draft initialization reports a localized Chinese notice', async t => {
  const h = harness(t, { draftResult: 'blocked', locale: 'zh-CN' });
  await h.start(undefined, { prompt: 'Draft' });
  assert.equal(h.notices[0].message, '暂时无法填入草稿，请稍后重试');
  assert.deepEqual(h.opened, []);
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

for (const [locale, expected] of [['en', 'No Workspace'], ['zh-CN', '无工作区'], ['ZH-tw', '无工作区'], ['fr', 'No Workspace'], ['', 'No Workspace']]) {
  test(`standalone section heading follows locale ${JSON.stringify(locale)} and updates in place`, async t => {
    const h = harness(t, { locale });
    const doc = h.document;
    doc.body.innerHTML = `<div id="real"><div role="treeitem" aria-expanded="true" data-row-key="workspace:real">Ungrouped</div></div>
      <div id="standalone"><div role="treeitem" aria-expanded="true" data-row-key="workspace:">Ungrouped</div>
      <div role="treeitem" aria-selected="true"><span></span><span>Standalone session</span></div></div>`;
    const section = doc.getElementById('standalone');
    const children = [...section.childNodes];
    await tick();
    assert.equal(section.getAttribute('data-dsh-nw-heading'), expected);
    assert.equal(doc.getElementById('real').hasAttribute('data-dsh-nw-ungrouped'), false);
    assert.equal(doc.getElementById('real').hasAttribute('data-dsh-nw-heading'), false);
    const header = section.firstElementChild;
    assert.equal(doc.defaultView.getComputedStyle(header).display, 'none');
    doc.documentElement.lang = expected === 'No Workspace' ? 'zh-CN' : 'en-US';
    await tick();
    assert.equal(section.getAttribute('data-dsh-nw-heading'), expected === 'No Workspace' ? '无工作区' : 'No Workspace');
    assert.deepEqual([...section.childNodes], children, 'Native React children stay mounted');
    h.dispose();
    assert.equal(section.hasAttribute('data-dsh-nw-heading'), false);
    assert.notEqual(doc.defaultView.getComputedStyle(header).display, 'none');
  });
}

test('a collapsed standalone section expands once and releases its heading when reused as a workspace', async t => {
  const h = harness(t);
  const doc = h.document;
  doc.body.innerHTML = '<div><div role="treeitem" aria-expanded="false" data-row-key="workspace:">未分组</div></div>';
  const row = doc.querySelector('[role="treeitem"]');
  let clicks = 0;
  row.addEventListener('click', () => { clicks++; row.setAttribute('aria-expanded', 'true'); });
  await tick();
  assert.equal(clicks, 1);
  assert.equal(row.parentElement.getAttribute('data-dsh-nw-heading'), 'No Workspace');
  row.setAttribute('data-row-key', 'workspace:real');
  row.textContent = 'Actual workspace';
  await tick();
  assert.equal(row.parentElement.hasAttribute('data-dsh-nw-ungrouped'), false);
  assert.equal(row.parentElement.hasAttribute('data-dsh-nw-heading'), false);
});
