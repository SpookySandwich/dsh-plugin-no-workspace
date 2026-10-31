import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function fixture() {
  const window = {};
  let plugin, settle, active = 'en', calls = 0;
  const scope = { set() { calls++; return new Promise(resolve => { settle = resolve; }); } };
  const original = scope.set;
  const ctx = {
    configForms: { get: () => scope },
    locale: { setLocale(id) { active = id; scope.set('preference', id); }, getSnapshot: () => ({active}) },
    uiWorkspace: { openWorkspace() {} }, effect() {},
  };
  window.__ModuleLoader__ = { load({factory}) { plugin = factory(); } };
  runInNewContext(readFileSync(new URL('./fixtures/browser-acceptance.client.js', import.meta.url), 'utf8'), {window});
  plugin.apply(ctx);
  return { qa:window.__noWorkspaceQa, scope, original, get calls() {return calls;}, adopt: value => {active=value;}, settle: ok => settle(ok) };
}

test('locale QA awaits native acceptance through a stale Host adoption before taking a snapshot', async () => {
  const h = fixture();
  let completed = false;
  const pending = h.qa.setLocale('zh').then(value => {completed=true;return value;});
  h.adopt('en'); // Older Host update follows the optimistic Chinese publication.
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(h.calls, 1);
  assert.equal(h.scope.set, h.original);
  h.adopt('zh');
  h.settle(true);
  assert.equal(await pending, 'zh');
});

test('locale QA reports rejected persistence instead of accepting optimistic UI', async () => {
  const h=fixture();
  const pending=h.qa.setLocale('zh');
  h.settle(false);
  await assert.rejects(pending, /not saved/);
  assert.equal(h.scope.set,h.original);
});
