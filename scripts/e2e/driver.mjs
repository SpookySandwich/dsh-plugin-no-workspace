// Minimal CDP driver for end-to-end runs against a live DSH instance.
//
// Owns one websocket for the whole run so console output, request interception
// and input all share a session. Everything is polling-based with explicit
// deadlines: DSH renders asynchronously and fixed sleeps make the suite flaky.

import fs from 'node:fs';
import path from 'node:path';

export class Driver {
  constructor({ debugPort, appOrigin, shotDir }) {
    this.debugPort = debugPort;
    this.appOrigin = appOrigin;
    this.shotDir = shotDir;
    this.logs = [];
    this._id = 0;
    this._pending = new Map();
    this._listeners = [];
  }

  static async attach(options) {
    const driver = new Driver(options);
    await driver._connect();
    return driver;
  }

  async _connect() {
    const targets = await (await fetch(`http://127.0.0.1:${this.debugPort}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page' && t.url.includes(this.appOrigin.replace(/^https?:\/\//, '')))
      ?? targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
    if (!page) throw new Error('no attachable page target');
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this._pending.has(message.id)) {
        const settle = this._pending.get(message.id);
        this._pending.delete(message.id);
        settle(message);
        return;
      }
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
        this.logs.push(`[${message.params.type}] ${message.params.args.map((a) => String(a.value ?? a.description ?? '')).join(' ').slice(0, 400)}`);
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.logs.push(`[exception] ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
      }
      for (const listener of this._listeners) listener(message);
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this._id;
      this._pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  onMessage(listener) { this._listeners.push(listener); }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }

  async reload({ settleMs = 6000 } = {}) {
    await this.send('Page.navigate', { url: this.appOrigin });
    await this.waitFor('document.readyState === "complete"', { timeoutMs: 20000 });
    await this.sleep(settleMs);
  }

  sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /** Poll `expression` until it evaluates truthy. Returns the truthy value. */
  async waitFor(expression, { timeoutMs = 15000, intervalMs = 250, label } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.eval(`(() => { try { return (${expression}); } catch (e) { return undefined; } })()`);
        if (last) return last;
      } catch { /* transient navigation errors are expected while DSH re-renders */ }
      await this.sleep(intervalMs);
    }
    throw new Error(`waitFor timed out${label ? ` (${label})` : ''}: ${expression} — last value ${JSON.stringify(last)}`);
  }

  /** A visible, enabled, hit-testable target; hidden portal measurement is not readiness. */
  box(selector, text, exact = false) {
    return this.eval(`(() => {
      const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = candidates.find(e => {
        const label = (e.innerText || '').trim();
        return ${text === undefined ? 'true' : exact ? `label === ${JSON.stringify(text)}` : `label.includes(${JSON.stringify(text)})`}
          && getComputedStyle(e).visibility === 'visible' && !e.matches(':disabled')
          && !e.closest('[inert]') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
      });
      if (!el) return null;
      let r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        r = el.getBoundingClientRect();
      }
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (!el.contains(document.elementFromPoint(x, y))) return null;
      window.__dshQaClickTarget = el;
      return { x, y, w: r.width, h: r.height, text: (el.innerText || '').trim().slice(0, 80) };
    })()`);
  }

  /** Bounding box of the first element matching `selector` whose text contains `text`. */
  boxWithText(selector, text, exact = false) {
    return this.box(selector, text, exact);
  }

  async clickAt(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  }

  async click(selector, { timeoutMs = 10000 } = {}) {
    return this.clickReady(() => this.box(selector), selector, timeoutMs);
  }

  async clickText(selector, text, { timeoutMs = 10000, exact = false } = {}) {
    return this.clickReady(() => this.boxWithText(selector, text, exact), `${selector} text ${JSON.stringify(text)}`, timeoutMs);
  }

  async clickReady(locate, label, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const target = await locate();
      if (!target) { await this.sleep(50); continue; }
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
      // Native portals track their anchor per frame. Hover may also move or
      // replace a row. Recheck identity, geometry and hit testing after paint.
      const frameBudget = Math.min(250, Math.max(0, deadline - Date.now()));
      if (!frameBudget) break;
      let frameTimer;
      const frameWait = this.eval(`new Promise(resolve => {
        let frame;
        const finish = value => { clearTimeout(timer); cancelAnimationFrame(frame); resolve(value); };
        const timer = setTimeout(() => finish(false), ${frameBudget});
        const el = window.__dshQaClickTarget;
        const matches = () => {
          if (!el?.isConnected || el.matches(':disabled') || el.closest('[inert]') || getComputedStyle(el).visibility !== 'visible') return false;
          const r = el.getBoundingClientRect();
          return Math.abs(r.left + r.width/2 - ${target.x}) < 0.5 && Math.abs(r.top + r.height/2 - ${target.y}) < 0.5
            && el.contains(document.elementFromPoint(${target.x}, ${target.y}));
        };
        frame = requestAnimationFrame(() => { const first = matches(); frame = requestAnimationFrame(() => finish(first && matches())); });
      })`);
      // Background tabs can suspend animation frames and throttle page timers.
      // The Node timer also bounds the CDP promise by the remaining click budget.
      let ready;
      try {
        ready = await Promise.race([frameWait, new Promise(resolve => {
          frameTimer = setTimeout(() => resolve(false), frameBudget);
        })]);
      } finally { clearTimeout(frameTimer); }
      if (!ready) continue;
      if (Date.now() >= deadline) break;
      // Once pressed, never retry: a second activation could duplicate a real
      // action. The captured click must belong to the target we just checked.
      await this.eval(`window.__dshQaClicked = false; document.addEventListener('click', function observe(e) {
        window.__dshQaClicked = window.__dshQaClickTarget?.contains(e.target) === true;
      }, {capture:true, once:true})`);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await this.send('Input.dispatchMouseEvent', { type, x: target.x, y: target.y, button: 'left', clickCount: 1 });
      }
      if (!await this.eval('window.__dshQaClicked')) throw new Error(`click target changed during input: ${label}`);
      return target;
    }
    throw new Error(`click: no stable actionable target for ${label}`);
  }

  /** Hover a row first so its hover-only action buttons mount, then click one. */
  async hoverThenClick(hoverSelector, clickSelector) {
    const hover = await this.box(hoverSelector);
    if (!hover) throw new Error(`hoverThenClick: no element for ${hoverSelector}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover.x, y: hover.y });
    await this.sleep(400);
    return this.click(clickSelector);
  }

  async typeInto(selector, text) {
    await this.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await this.send('Input.insertText', { text });
  }

  async pressKey(key) {
    const keys = {
      Enter: { windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r' },
      Escape: { windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' },
    };
    const spec = keys[key];
    if (!spec) throw new Error(`pressKey: unsupported key ${key}`);
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...spec });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...spec });
  }

  async shot(name) {
    fs.mkdirSync(this.shotDir, { recursive: true });
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(this.shotDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  }

  /** Console errors that are ours, not the browser profile's extensions. */
  appErrors() {
    return this.logs.filter((line) => line.startsWith('[error]') || line.startsWith('[exception]'))
      .filter((line) => !/chrome-extension|grm ERROR|Iterable|DEFAULT root logger/.test(line));
  }

  close() { try { this.ws.close(); } catch { /* already closed */ } }
}
