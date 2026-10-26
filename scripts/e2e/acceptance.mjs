// Real DSH 0.2 browser acceptance; owns its host, browser and disposable home.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Driver } from './driver.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const modules = path.resolve(process.env.DSH_QA_MODULES ?? path.join(root, 'node_modules'));
const cli = path.join(modules, '@deepseek-ai/dsh/lib/bin.js');
assert.ok(fs.existsSync(cli), 'Set DSH_QA_MODULES to an official DSH node_modules directory');
const version = JSON.parse(fs.readFileSync(path.join(modules, '@deepseek-ai/dsh/package.json'), 'utf8')).version;
assert.ok(['0.2.0-rc.2', '0.2.1-rc.2'].includes(version), `Unsupported acceptance runtime: ${version}`);
const browserPath = process.env.DSH_QA_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
assert.ok(fs.existsSync(browserPath), 'Set DSH_QA_BROWSER to a Chromium or Edge executable');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-no-workspace-e2e-'));
const profile = path.join(home, 'profiles/web');
const output = path.resolve(process.env.DSH_QA_OUTPUT ?? path.join(root, 'scratch/e2e-current'));
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(profile, 'node_modules'), { recursive: true });
fs.symlinkSync(path.join(modules, '@deepseek-ai'), path.join(profile, 'node_modules/@deepseek-ai'), 'junction');
fs.symlinkSync(root, path.join(profile, 'node_modules/dsh-plugin-no-workspace'), 'junction');
const qaClient = path.join(profile, 'node_modules/no-workspace-qa-client');
fs.mkdirSync(qaClient);
fs.writeFileSync(path.join(qaClient, 'package.json'), JSON.stringify({ name: 'no-workspace-qa-client', version: '0.0.0', type: 'module',
  main: 'index.js', exports: { '.': './index.js', './client': './client.js' }, dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: [
    '@deepseek-ai/dsh-client-ui-workspace', '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-api-workspace-controller', '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-agent-preset',
    '@deepseek-ai/dsh-client-locale',
  ] } } }));
fs.writeFileSync(path.join(qaClient, 'index.js'), 'export function apply() {}');
fs.writeFileSync(path.join(qaClient, 'cordis.patch.yml'), '- insert:\n    - id: qa-client\n      name: no-workspace-qa-client\n');
fs.copyFileSync(path.join(root, 'test/fixtures/browser-acceptance.client.js'), path.join(qaClient, 'client.js'));
fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'no-workspace-qa', private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-no-workspace', 'no-workspace-qa-client'] } } }));
// Keep the fixture outside the plugin package so the client-module registry
// does not mistake its host-only entry for a second copy of the client bundle.
fs.copyFileSync(path.join(root, 'test/fixtures/browser-acceptance.mjs'), path.join(profile, 'fixture.mjs'));
fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '- insert:\n    - id: no-workspace-qa\n      name: ./fixture.mjs\n');
const host = spawn(process.execPath, ['--expose-internals', cli, '--profile', 'web', '--no-open', '--port', '0'], {
  env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let hostLog = '', browserLog = '', browser, driver;
host.stdout.on('data', data => hostLog += data);
host.stderr.on('data', data => hostLog += data);
async function waitFor(get, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = get();
    if (value) return value;
    if (host.exitCode !== null) throw new Error(`Host stopped: ${hostLog}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const done = once(child, 'exit');
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/F', '/T'], { windowsHide: true, stdio: 'ignore' });
  else child.kill();
  await done;
}
try {
  const url = await waitFor(() => hostLog.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/)?.[1], 'host startup', 180000);
  browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--lang=en-US',
    '--remote-debugging-port=0', `--user-data-dir=${path.join(home, 'browser')}`, '--window-size=1440,1000', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  browser.stderr.on('data', data => browserLog += data);
  const port = Number(await waitFor(() => browserLog.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1], 'browser startup'));
  driver = await Driver.attach({ debugPort: port, appOrigin: new URL(url).origin, shotDir: output });
  const requests = [];
  driver.onMessage(message => {
    const request = message.params?.request;
    if (message.method === 'Network.requestWillBeSent' && request.url.includes('/no-workspace/')) {
      requests.push({ path: new URL(request.url).pathname, body: request.postData ? JSON.parse(request.postData) : null });
    }
  });
  await driver.send('Network.enable');
  await driver.send('Page.navigate', { url });
  await driver.waitFor(`document.body.innerText.includes('Preview Notice')`, { timeoutMs: 60000, label: 'client boot' });
  await driver.clickText('button', 'Continue');
  await driver.waitFor(`!document.body.innerText.includes('Preview Notice')`, { label: 'welcome acknowledgement' });
  // 0.2.0 opens provider onboarding after the welcome step; 0.2.1 uses
  // a dismissible account dialog. Neither run needs provider credentials.
  const onboarding = await driver.waitFor(`
    [...document.querySelectorAll('button')].some(b => b.innerText.includes('Configure later')) ? 'dialog'
      : [...document.querySelectorAll('[role="dialog"]')].some(d => d.innerText.includes('Get started')
        && d.querySelector('button[aria-label="Close"]')) ? 'account' : false
  `, { timeoutMs: 60000, label: 'provider or account onboarding' });
  if (onboarding === 'dialog') await driver.clickText('button', 'Configure later');
  else await driver.click('[role="dialog"] button[aria-label="Close"]');
  await driver.waitFor(`!document.querySelector('[role="dialog"][aria-modal="true"]') && document.getElementById('root')?.inert === false`, {
    label: 'provider onboarding released keyboard ownership',
  });
  const noWorkspace = `[...document.querySelectorAll('button[data-dsh-nw-chip]')].some(b=>b.innerText.trim()==='No Workspace')`;
  const inWorkspace = `[...document.querySelectorAll('button[aria-haspopup="menu"]')].some(b=>b.innerText.trim()==='No Workspace acceptance')`;
  await driver.eval(`[...document.querySelectorAll('button[aria-label="New session"]')].find(b=>b.getBoundingClientRect().width>0).click()`);
  await driver.waitFor(noWorkspace, { label: 'standalone navigation' });
  assert.equal(requests.filter(r => r.path === '/no-workspace/create').length, 1);
  // The empty real workspace immediately precedes the standalone bucket: hiding
  // Ungrouped must leave a visible boundary, including after a live locale change.
  await driver.waitFor(`!!document.querySelector('[data-dsh-nw-ungrouped] [aria-selected]')`, { label: 'standalone sidebar row' });
  await driver.waitFor('!!window.__noWorkspaceQa', { label: 'QA client registration' });
  const sidebarChecks = [];
  for (const [locale, title] of [['en', 'No Workspace'], ['zh', '无工作区'], ['en', 'No Workspace']]) {
    await driver.eval(`window.__noWorkspaceQa.setLocale(${JSON.stringify(locale)})`);
    await driver.waitFor(`document.documentElement.lang === ${JSON.stringify(locale === 'zh' ? 'zh-CN' : locale)}`, { label: 'native locale switch' });
    const sidebar = await driver.eval(`(() => {
      const section = document.querySelector('[data-dsh-nw-ungrouped]');
      const header = getComputedStyle(section, '::before');
      const row = section.querySelector('[aria-selected]');
      const nativeHeader = section.querySelector('[data-row-key="workspace:"]');
      const workspace = document.querySelector('[data-row-key^="workspace:"]:not([data-row-key="workspace:"])');
      return { locale: document.documentElement.lang, content: header.content,
        label: section.getAttribute('data-dsh-nw-heading'), display: header.display,
        border: getComputedStyle(section).borderTopWidth,
        gap: row.getBoundingClientRect().top - section.getBoundingClientRect().top,
        nativeHeader: getComputedStyle(nativeHeader).display,
        workspaceVisible: workspace.getBoundingClientRect().height > 0,
        workspaceMarked: workspace.parentElement.hasAttribute('data-dsh-nw-ungrouped'),
        rowVisible: row.getBoundingClientRect().height > 0 };
    })()`);
    sidebarChecks.push(sidebar);
    fs.writeFileSync(path.join(output, 'sidebar.json'), JSON.stringify(sidebarChecks, null, 2));
    await driver.shot(`sidebar-${locale}`);
    assert.ok(sidebar.content.includes(title) || (sidebar.content.includes('attr(') && sidebar.label === title),
      `Standalone section needs a localized visible heading: ${JSON.stringify(sidebar)}`);
    assert.equal(sidebar.display, 'block');
    assert.equal(sidebar.border, '1px');
    assert.ok(sidebar.gap >= 28, 'Heading reserves space above standalone rows');
    assert.equal(sidebar.nativeHeader, 'none');
    assert.equal(sidebar.workspaceVisible, true);
    assert.equal(sidebar.workspaceMarked, false);
    assert.equal(sidebar.rowVisible, true);
  }
  const workspaceRow = '[data-row-key^="workspace:"]:not([data-row-key="workspace:"])';
  const expanded = await driver.eval(`document.querySelector(${JSON.stringify(workspaceRow)}).getAttribute('aria-expanded')`);
  await driver.click(workspaceRow);
  await driver.waitFor(`document.querySelector(${JSON.stringify(workspaceRow)}).getAttribute('aria-expanded') !== ${JSON.stringify(expanded)}`, { label: 'native workspace toggle' });
  assert.ok(await driver.eval(`document.querySelector('[data-dsh-nw-ungrouped] [aria-selected]').getBoundingClientRect().height > 0`),
    'Standalone row remains visible when the adjacent workspace toggles');
  await driver.click(workspaceRow);
  await driver.eval(`document.querySelector('button[aria-label="New session in No Workspace acceptance"]').click()`);
  await driver.waitFor(inWorkspace, { label: 'explicit workspace navigation' });
  assert.equal(requests.filter(r => r.path === '/no-workspace/create').length, 1, 'Explicit workspace calls remain native');
  // The shipped Windows Web binding is Ctrl+Alt+N. Exercise DSH's dispatcher.
  for (const type of ['keyDown', 'keyUp']) await driver.send('Input.dispatchKeyEvent', {
    type, key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78, modifiers: 3,
  });
  await driver.waitFor(noWorkspace, { label: 'native Web shortcut' });
  assert.equal(requests.filter(r => r.path === '/no-workspace/create').length, 2, 'Ordinary New Session creates a fresh default-preset blank');
  await driver.typeInto('[data-composer-input]', 'LOCAL NO WORKSPACE QA DRAFT');
  await driver.waitFor(`document.querySelector('[data-composer-input]').innerText.includes('LOCAL NO WORKSPACE QA DRAFT')`, { label: 'editable standalone composer' });
  await driver.click('button[data-dsh-nw-chip]');
  await driver.clickText('button[role="menuitem"]', 'No Workspace acceptance');
  await driver.waitFor(inWorkspace, { label: 'workspace picker selection' });
  await driver.waitFor(`document.querySelector('[data-composer-input]').innerText.includes('LOCAL NO WORKSPACE QA DRAFT')`, { label: 'native draft transfer' });
  const beforeDetach = await driver.eval(`fetch('/qa/no-workspace').then(r=>r.json())`);
  await driver.clickText('button[aria-haspopup="menu"]', 'No Workspace acceptance');
  await driver.clickText('button[role="menuitem"]', 'No Workspace');
  await driver.waitFor(noWorkspace, { label: 'workspace detachment' });
  const detachedId = await waitFor(() => requests.find(r => r.path === '/no-workspace/detach' && r.body.sessionId)?.body.sessionId, 'detach request');
  assert.ok(beforeDetach.sessionIds.includes(detachedId), 'The detached conversation belonged to the selected workspace');
  await driver.waitFor(`fetch('/qa/no-workspace').then(r=>r.json()).then(value => !value.sessionIds.includes(${JSON.stringify(detachedId)}))`, {
    label: 'host workspace detachment committed',
  });
  const membership = await driver.eval(`fetch('/qa/no-workspace').then(r=>r.json())`);
  assert.deepEqual(membership.sessionIds, beforeDetach.sessionIds.filter(id => id !== detachedId),
    'Only the selected conversation leaves its workspace');
  assert.equal(await driver.eval(`document.querySelector('[data-composer-input]').innerText.includes('LOCAL NO WORKSPACE QA DRAFT')`), true);
  const optionChecks = [];
  if (version === '0.2.1-rc.2') {
    await driver.waitFor('window.__noWorkspaceQa', { label: 'QA client registration' });
    // Invoke the actual Settings/Add-plugin creator callback, including seat.stage().
    const originalBlank = await driver.eval('window.__noWorkspaceQa.current()');
    await driver.waitFor(`window.__noWorkspaceQa.blanks().find(b => b.id === ${JSON.stringify(originalBlank)})?.preset === 'standard'`, { label: 'original blank preset projection' });
    const blanksBeforeCreator = await driver.eval('window.__noWorkspaceQa.blanks()');
    const createCount = requests.filter(r => r.path === '/no-workspace/create').length;
    await driver.eval('window.__noWorkspaceQa.creator()');
    await waitFor(() => requests.filter(r => r.path === '/no-workspace/create').length > createCount, 'real creator request');
    await driver.waitFor(`fetch('/qa/no-workspace?sessionId=' + ${JSON.stringify(originalBlank)}).then(r=>r.json()).then(s=>s.agentPreset === 'cordis')`, { label: 'creator reuses and changes selected blank' });
    assert.equal(await driver.eval('window.__noWorkspaceQa.current()'), originalBlank);
    assert.equal(requests.filter(r => r.path === '/no-workspace/create').at(-1).body.sessionId, originalBlank);
    const afterCreator = await driver.eval('window.__noWorkspaceQa.blanks()');
    assert.deepEqual(afterCreator.map(b => b.id).sort(), blanksBeforeCreator.map(b => b.id).sort(), 'Creator creates no duplicate blank');
    for (const other of blanksBeforeCreator.filter(b => b.id !== originalBlank)) {
      assert.equal((await driver.eval(`fetch('/qa/no-workspace?sessionId=' + ${JSON.stringify(other.id)}).then(r=>r.json())`)).agentPreset, other.preset,
        'Creator must not change another blank preset');
    }
    await driver.eval(`[...document.querySelectorAll('button[aria-label="New session"]')].find(b=>b.getBoundingClientRect().width>0).click()`);
    await driver.waitFor(`window.__noWorkspaceQa.current() !== ${JSON.stringify(originalBlank)}`, { label: 'plain New Session after creator' });
    const plainId = await driver.eval('window.__noWorkspaceQa.current()');
    assert.equal((await driver.eval(`fetch('/qa/no-workspace?sessionId=' + ${JSON.stringify(plainId)}).then(r=>r.json())`)).agentPreset, 'standard');
    optionChecks.push('real preset creator reuses selected blank without changing other blanks', 'plain New Session restores default preset');
    for (const withWorkspace of [true, false]) {
      if (!withWorkspace) {
        await driver.eval(`fetch('/qa/no-workspace', {method: 'DELETE'}).then(r=>r.json())`);
        await driver.waitFor('window.__noWorkspaceQa.workspaceCount() === 0', { label: 'no registered workspaces' });
      } else {
        await driver.eval(`document.querySelector('button[aria-label="New session in No Workspace acceptance"]').click()`);
        await driver.waitFor(inWorkspace, { label: 'active workspace before preset helper' });
      }
      const id = await driver.eval(`window.__noWorkspaceQa.start({agentPreset: 'cordis', clearPreviousDraft: false})`);
      assert.ok(id);
      await driver.waitFor(noWorkspace, { label: 'preset helper stays standalone' });
      const state = await driver.eval(`fetch('/qa/no-workspace?sessionId=' + ${JSON.stringify(id)}).then(r=>r.json())`);
      assert.deepEqual(state.memberships, []);
      assert.equal(state.agentPreset, 'cordis', 'Host applies the requested preset');
      const prompt = `STANDALONE OPTIONS ${withWorkspace}`;
      const draftId = await driver.eval(`window.__noWorkspaceQa.start({prompt: ${JSON.stringify(prompt)}, clearPreviousDraft: true})`);
      await driver.waitFor(`document.querySelector('[data-composer-input]')?.innerText.includes(${JSON.stringify(prompt)})`, { label: 'standalone prompt initialized' });
      assert.deepEqual(await driver.eval(`fetch('/qa/no-workspace?sessionId=' + ${JSON.stringify(draftId)}).then(r=>r.json()).then(s=>s.memberships)`), []);
      await driver.eval(`window.__noWorkspaceQa.start({prompt: 'MUST NOT REPLACE', clearPreviousDraft: false})`);
      assert.equal(await driver.eval(`document.querySelector('[data-composer-input]').innerText.includes(${JSON.stringify(prompt)})`), true);
      await driver.eval(`window.__noWorkspaceQa.start({clearPreviousDraft: true})`);
      await driver.waitFor(`document.querySelector('[data-composer-input]')?.innerText.trim() === ''`, { label: 'explicit draft clear' });
      const combined = await driver.eval(`window.__noWorkspaceQa.start({agentPreset: 'cordis', prompt: 'COMBINED PRESET AND DRAFT', clearPreviousDraft: true})`);
      await driver.waitFor(`document.querySelector('[data-composer-input]')?.innerText.includes('COMBINED PRESET AND DRAFT')`, { label: 'fresh preset draft initialized before navigation' });
      const combinedState = await driver.eval(`fetch('/qa/no-workspace?sessionId=' + ${JSON.stringify(combined)}).then(r=>r.json())`);
      assert.deepEqual(combinedState.memberships, []);
      assert.equal(combinedState.agentPreset, 'cordis');
      optionChecks.push(`preset and draft standalone with workspace=${withWorkspace}`);
    }
  }
  assert.deepEqual(driver.appErrors(), []);
  const screenshot = await driver.shot('acceptance');
  const report = { ok: true, dsh: version, requests, screenshot, sidebarChecks, checks: ['client boot', 'standalone creation', 'localized sidebar heading and separator', 'explicit workspace creation', 'Web shortcut', 'fresh default-preset blank', 'draft transfer', 'detachment', ...optionChecks, 'no browser errors'] };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  if (driver) {
    await driver.shot('failure').catch(() => {});
    console.error(JSON.stringify({ text: await driver.eval('document.body.innerText').catch(() => ''), logs: driver.logs }));
  }
  throw error;
} finally {
  driver?.close();
  await stop(browser);
  await stop(host);
  fs.writeFileSync(path.join(output, 'host.log'), hostLog.replace(/\?token=[^\s]+/g, '?token=[test token omitted]'));
  assert.equal(path.dirname(home), path.resolve(os.tmpdir()));
  assert.ok(path.basename(home).startsWith('dsh-no-workspace-e2e-'));
  fs.rmSync(home, { recursive: true, force: true });
}
