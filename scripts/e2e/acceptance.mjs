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
assert.ok(fs.existsSync(cli), 'Set DSH_QA_MODULES to an official DSH 0.2.0-rc.2 node_modules directory');
const version = JSON.parse(fs.readFileSync(path.join(modules, '@deepseek-ai/dsh/package.json'), 'utf8')).version;
assert.equal(version, '0.2.0-rc.2', 'This acceptance suite targets the official DSH 0.2.0-rc.2 API');
const browserPath = process.env.DSH_QA_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
assert.ok(fs.existsSync(browserPath), 'Set DSH_QA_BROWSER to a Chromium or Edge executable');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-no-workspace-e2e-'));
const profile = path.join(home, 'profiles/web');
const output = path.join(root, 'scratch/e2e-current');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(profile, 'node_modules'), { recursive: true });
fs.symlinkSync(path.join(modules, '@deepseek-ai'), path.join(profile, 'node_modules/@deepseek-ai'), 'junction');
fs.symlinkSync(root, path.join(profile, 'node_modules/dsh-plugin-no-workspace'), 'junction');
fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'no-workspace-qa', private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-no-workspace'] } } }));
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
  // This fresh profile has no provider credentials. DSH loads the provider
  // settings after the welcome step, rendering nothing while that load runs.
  await driver.clickText('button', 'Configure later', { timeoutMs: 60000 });
  await driver.waitFor(`!document.querySelector('[role="dialog"][aria-modal="true"]') && document.getElementById('root')?.inert === false`, {
    label: 'provider onboarding released keyboard ownership',
  });
  const noWorkspace = `[...document.querySelectorAll('button[data-dsh-nw-chip]')].some(b=>b.innerText.trim()==='No Workspace')`;
  const inWorkspace = `[...document.querySelectorAll('button[aria-haspopup="menu"]')].some(b=>b.innerText.trim()==='No Workspace acceptance')`;
  await driver.eval(`[...document.querySelectorAll('button[aria-label="New session"]')].find(b=>b.getBoundingClientRect().width>0).click()`);
  await driver.waitFor(noWorkspace, { label: 'standalone navigation' });
  assert.equal(requests.filter(r => r.path === '/no-workspace/create').length, 1);
  await driver.eval(`document.querySelector('button[aria-label="New session in No Workspace acceptance"]').click()`);
  await driver.waitFor(inWorkspace, { label: 'explicit workspace navigation' });
  assert.equal(requests.filter(r => r.path === '/no-workspace/create').length, 1, 'Explicit workspace calls remain native');
  // The shipped Windows Web binding is Ctrl+Alt+N. Exercise DSH's dispatcher.
  for (const type of ['keyDown', 'keyUp']) await driver.send('Input.dispatchKeyEvent', {
    type, key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78, modifiers: 3,
  });
  await driver.waitFor(noWorkspace, { label: 'native Web shortcut' });
  assert.equal(requests.filter(r => r.path === '/no-workspace/create').length, 1, 'The standalone blank is reused');
  await driver.typeInto('[data-composer-input]', 'LOCAL NO WORKSPACE QA DRAFT');
  await driver.waitFor(`document.querySelector('[data-composer-input]').innerText.includes('LOCAL NO WORKSPACE QA DRAFT')`, { label: 'editable standalone composer' });
  await driver.click('button[data-dsh-nw-chip]');
  await driver.clickText('button[role="menuitem"]', 'No Workspace acceptance');
  await driver.waitFor(inWorkspace, { label: 'workspace picker selection' });
  await driver.waitFor(`document.querySelector('[data-composer-input]').innerText.includes('LOCAL NO WORKSPACE QA DRAFT')`, { label: 'native draft transfer' });
  await driver.clickText('button[aria-haspopup="menu"]', 'No Workspace acceptance');
  await driver.clickText('button[role="menuitem"]', 'No Workspace');
  await driver.waitFor(noWorkspace, { label: 'workspace detachment' });
  await waitFor(() => requests.some(r => r.path === '/no-workspace/detach' && r.body.sessionId), 'detach request');
  const membership = await driver.eval(`fetch('/qa/no-workspace').then(r=>r.json())`);
  assert.equal(membership.sessionIds.length, 0, 'The selected conversation leaves its workspace');
  assert.equal(await driver.eval(`document.querySelector('[data-composer-input]').innerText.includes('LOCAL NO WORKSPACE QA DRAFT')`), true);
  assert.deepEqual(driver.appErrors(), []);
  const screenshot = await driver.shot('acceptance');
  const report = { ok: true, dsh: '0.2.0-rc.2', requests, screenshot, checks: ['client boot', 'standalone creation', 'explicit workspace creation', 'Web shortcut', 'blank reuse', 'draft transfer', 'detachment', 'no browser errors'] };
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
