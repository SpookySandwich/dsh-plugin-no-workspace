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
  const nativeSidebar = function NativeSidebar() {};
  const sidebar = { options: { priority: 0 }, component: nativeSidebar };
  const leading = { options: { priority: 0 }, component: function NativeLeadingControls() {} };
  const nativeStarts = [];
  let shortcutRows;
  const ctx = {
    get: name => name === 'shortcuts' && shortcutRows
      ? { catalog: { getSnapshot: () => shortcutRows } }
      : undefined,
    sessions: { list: { getSnapshot: () => sessionSnapshot, subscribe }, open: id => opened.push(id) },
    workspaces: { list: { getSnapshot: () => workspaceSnapshot, subscribe } },
    slots: { inject(_name, register) { register(); },
      entries: name => name === 'conversation.hero.workspace' ? [entry]
        : name === 'sidebar' ? [sidebar]
          : name === 'shell.leading' ? [leading] : [],
      subscribe: () => () => {} },
  };
  const dispose = plugin.apply(ctx);
  t.after(() => { dispose(); dom.window.close(); });
  return {
    requests, opened, listeners, window: dom.window,
    nativeStarts,
    setShortcuts(rows) { shortcutRows = rows; },
    start(workspaceId) { sidebar.component({ startSession: id => nativeStarts.push(id) }).props.startSession(workspaceId); },
    leadingStart(workspaceId) { leading.component({ startSession: id => nativeStarts.push(id) }).props.startSession(workspaceId); },
    press(code, modifiers = {}) {
      const event = new dom.window.KeyboardEvent('keydown', {
        code, bubbles: true, cancelable: true, ...modifiers,
      });
      dom.window.dispatchEvent(event);
      return event;
    },
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

test('sidebar adapts already-injected props and preserves native workspace creation', async t => {
  const h = harness(t);
  h.start('workspace');
  assert.deepEqual(h.nativeStarts, ['workspace']);
  h.start(undefined);
  await tick();
  assert.equal(h.requests[0].url, '/no-workspace/create');
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

test('the window-chrome New Session control also creates a standalone session', async t => {
  const h = harness(t);
  h.leadingStart(undefined);
  await tick();
  assert.deepEqual(h.requests, [{ url: '/no-workspace/create', body: {} }]);
  h.leadingStart('workspace');
  await tick();
  assert.deepEqual(h.nativeStarts, ['workspace'], 'A real workspace request stays with DSH');
});

test('the rebindable New Session accelerator is consumed before DSH dispatches it', async t => {
  const h = harness(t);
  h.setShortcuts([{ id: 'session.new', binding: { code: 'KeyN', modifiers: ['control'] }, issue: null, conflicts: [], aria: 'Control+N' }]);
  const pressed = h.press('KeyN', { ctrlKey: true });
  await tick();
  assert.equal(pressed.defaultPrevented, true);
  assert.deepEqual(h.requests, [{ url: '/no-workspace/create', body: {} }]);
});

test('an accelerator DSH would not run is left untouched', async t => {
  const h = harness(t);
  h.setShortcuts([
    { id: 'session.new', binding: { code: 'KeyN', modifiers: ['control'] }, issue: null, conflicts: [{ id: 'other' }], aria: 'Control+N' },
    { id: 'session.search', binding: { code: 'KeyK', modifiers: ['control'] }, issue: null, conflicts: [], aria: 'Control+K' },
  ]);
  const conflicting = h.press('KeyN', { ctrlKey: true });
  await tick();
  assert.equal(conflicting.defaultPrevented, false);
  const unrelated = h.press('KeyK', { ctrlKey: true });
  await tick();
  assert.equal(unrelated.defaultPrevented, false);
  assert.deepEqual(h.requests, []);
});

test('a rebuilt accelerator with different modifiers is matched exactly', async t => {
  const h = harness(t);
  h.setShortcuts([{ id: 'session.new', binding: { code: 'KeyN', modifiers: ['control', 'shift'] }, issue: null, conflicts: [], aria: 'Control+Shift+N' }]);
  const stale = h.press('KeyN', { ctrlKey: true });
  await tick();
  assert.equal(stale.defaultPrevented, false, 'The previous binding must not fire');
  const current = h.press('KeyN', { ctrlKey: true, shiftKey: true });
  await tick();
  assert.equal(current.defaultPrevented, true);
  assert.deepEqual(h.requests, [{ url: '/no-workspace/create', body: {} }]);
});

test('without a shortcut registry the accelerator stays native', async t => {
  const h = harness(t);
  const pressed = h.press('KeyN', { ctrlKey: true });
  await tick();
  assert.equal(pressed.defaultPrevented, false);
  assert.deepEqual(h.requests, []);
});

test('an open menu keeps keyboard ownership, as it does in DSH', async t => {
  const h = harness(t);
  h.setShortcuts([{ id: 'session.new', binding: { code: 'KeyN', modifiers: ['control'] }, issue: null, conflicts: [], aria: 'Control+N' }]);
  const menu = h.window.document.createElement('div');
  menu.setAttribute('role', 'menu');
  h.window.document.body.appendChild(menu);
  const owned = h.press('KeyN', { ctrlKey: true });
  await tick();
  assert.equal(owned.defaultPrevented, false, 'A foreground menu owns the keystroke');
  assert.deepEqual(h.requests, []);
  menu.remove();
  const released = h.press('KeyN', { ctrlKey: true });
  await tick();
  assert.equal(released.defaultPrevented, true);
  assert.deepEqual(h.requests, [{ url: '/no-workspace/create', body: {} }]);
});
