#!/usr/bin/env node
/**
 * 18-viewport headless Chromium CDP mobile layout audit for TideBot.
 *
 * Usage:
 *   AUDIT_URL=http://127.0.0.1:8787 node scripts/mobile-audit.mjs
 *
 * Optional env vars:
 *   AUDIT_URL      Target URL (default: http://127.0.0.1:8787)
 *   AUDIT_OUT_DIR  Directory for screenshots (default: <tmpdir>/tidebot-mobile-audit)
 *   CHROME_PATH    Path to Chrome/Chromium binary (auto-detected if omitted)
 *   CDP_PORT       Remote debugging port (default: 9223)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT_DIR = process.env.AUDIT_OUT_DIR || path.join(os.tmpdir(), 'tidebot-mobile-audit');
fs.mkdirSync(OUT_DIR, { recursive: true });

function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Could not find Chrome/Chromium binary. Set CHROME_PATH to your browser executable.');
}

const PORT = Number(process.env.CDP_PORT || 9223);
const chrome = spawn(resolveChrome(), [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`,
  '--window-size=390,844',
  'about:blank',
], { stdio: 'ignore' });

async function waitForDebugger() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Chromium CDP failed to start');
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  }
  async screenshot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT_DIR, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
  close() {
    this.ws.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Audit function run inside the page to detect layout/mobile bugs
const AUDIT_JS = `
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const docScrollW = document.documentElement.scrollWidth;
  const bodyScrollW = document.body.scrollWidth;
  const issues = [];

  if (docScrollW > vw + 1) {
    issues.push({ type: 'horizontal-overflow', detail: \`document scrollWidth (\${docScrollW}) > viewport (\${vw})\` });
  }

  // Check all visible elements for offscreen right/left or tiny touch targets
  const all = Array.from(document.querySelectorAll('*'));
  for (const el of all) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    // Ignore intentionally off-canvas drawers or scrollable children
    if (el.closest('.sidebar:not(.is-mobile-open)')) continue;

    // Check if an interactive button/input is clipped off the viewport horizontally
    const tag = el.tagName.toLowerCase();
    const isInteractive = tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' || el.getAttribute('role') === 'button';
    if (isInteractive) {
      // Check if inside a horizontal scroll container
      const inHScroll = el.closest('.app-settings__nav, .cfg-nav, .cat-pills, .composer-telemetry, .signin__shader-bar');
      if (!inHScroll && (rect.right > vw + 2 || rect.left < -2)) {
        issues.push({
          type: 'clipped-control',
          selector: tag + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : ''),
          text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 40),
          rect: { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) },
        });
      }
    }
  }

  // Check overlapping sibling children in headers/bars
  for (const containerSel of ['.chat__header', '.tasks-view__header', '.composer', '.modal__header', '.apps-modal__head', '.signin__chrome']) {
    const container = document.querySelector(containerSel);
    if (!container) continue;
    const children = Array.from(container.children).filter((c) => {
      const s = getComputedStyle(c);
      return s.display !== 'none' && s.visibility !== 'hidden' && c.getBoundingClientRect().width > 0;
    });
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        const a = children[i].getBoundingClientRect();
        const b = children[j].getBoundingClientRect();
        const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (overlapX > 4 && overlapY > 4) {
          issues.push({
            type: 'sibling-overlap',
            container: containerSel,
            a: children[i].className,
            b: children[j].className,
            overlapX: Math.round(overlapX),
            overlapY: Math.round(overlapY),
          });
        }
      }
    }
  }

  return { vw, vh, docScrollW, bodyScrollW, issues };
`;

async function main() {
  const targets = await waitForDebugger();
  const pageTarget = targets.find((t) => t.type === 'page');
  const cdp = new CDP(pageTarget.webSocketDebuggerUrl);
  await cdp.ready();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });

  const report = {};

  // 1. Navigate to app (logged out -> Sign In view)
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCookies');
  await cdp.send('Page.navigate', { url: process.env.AUDIT_URL || 'http://127.0.0.1:8787' });
  await sleep(1200);
  await cdp.screenshot('01-signin-390');
  report['01-signin-390'] = await cdp.eval(AUDIT_JS);

  // Also check 360px narrow on SignIn
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  await cdp.screenshot('01b-signin-360');
  report['01b-signin-360'] = await cdp.eval(AUDIT_JS);

  // Restore 390x844 and log in via dev login button
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(200);
  await cdp.eval(`
    const btn = document.querySelector('form.signin__dev button[type="submit"]');
    if (btn) btn.click();
  `);
  await sleep(1500);
  await cdp.screenshot('02-chat-main');
  report['02-chat-main'] = await cdp.eval(AUDIT_JS);

  // 2. Test Slash Command Palette on mobile
  await cdp.eval(`
    const ta = document.querySelector('.composer__input');
    if (ta) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeInputValueSetter.call(ta, '/');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  await sleep(400);
  await cdp.screenshot('03-slash-palette');
  report['03-slash-palette'] = await cdp.eval(AUDIT_JS);

  // Clear slash input
  await cdp.eval(`
    const ta = document.querySelector('.composer__input');
    if (ta) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeInputValueSetter.call(ta, '');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  await sleep(200);

  // 3. Test Left Mobile Sidebar Drawer
  await cdp.eval(`document.querySelector('.mobile-nav-btn')?.click()`);
  await sleep(450);
  await cdp.screenshot('04-left-sidebar-drawer');
  report['04-left-sidebar-drawer'] = await cdp.eval(AUDIT_JS);

  // Close left drawer
  await cdp.eval(`document.querySelector('.mobile-scrim')?.click()`);
  await sleep(350);

  // 4. Test Right Details Drawer (Activity, Tasks, Library tabs)
  await cdp.eval(`document.querySelector('.chat__header-right button[aria-label="Show details"]')?.click()`);
  await sleep(450);
  await cdp.screenshot('05-right-details-activity');
  report['05-right-details-activity'] = await cdp.eval(AUDIT_JS);

  // Switch to Library tab in Details drawer
  await cdp.eval(`
    const tabs = Array.from(document.querySelectorAll('.details__tabs button'));
    tabs.find(b => b.textContent.includes('Library'))?.click();
  `);
  await sleep(500);
  await cdp.screenshot('06-right-details-library');
  report['06-right-details-library'] = await cdp.eval(AUDIT_JS);

  // Close right drawer
  await cdp.eval(`document.querySelector('.details__top button[aria-label="Close details"]')?.click()`);
  await sleep(350);

  // 5. Test Search / Command Palette Modal on mobile
  await cdp.eval(`document.querySelector('.chat__header-right button[aria-label="Command palette"]')?.click()`);
  await sleep(450);
  await cdp.screenshot('07-search-command-palette');
  report['07-search-command-palette'] = await cdp.eval(AUDIT_JS);
  await cdp.eval(`document.querySelector('.modal-scrim')?.click()`);
  await sleep(300);

  // 6. Test Create New Operator Modal on mobile
  await cdp.eval(`document.querySelector('.mobile-nav-btn')?.click()`);
  await sleep(350);
  await cdp.eval(`document.querySelector('.sidebar__controls button[aria-label="New Bot"]')?.click()`);
  await sleep(450);
  await cdp.screenshot('08-create-bot-modal');
  report['08-create-bot-modal'] = await cdp.eval(AUDIT_JS);
  await cdp.eval(`document.querySelector('.modal__close')?.click()`);
  await sleep(300);

  // 7. Test Connect Apps Marketplace Modal on mobile
  await cdp.eval(`
    const chips = Array.from(document.querySelectorAll('.composer-telemetry__chip'));
    chips.find(c => c.textContent.includes('COMPOSIO'))?.click();
  `);
  await sleep(800);
  await cdp.screenshot('09-connect-apps-modal');
  report['09-connect-apps-modal'] = await cdp.eval(AUDIT_JS);
  await cdp.eval(`document.querySelector('.modal__close')?.click()`);
  await sleep(300);

  // 8. Test Operator Settings Modal (General, Skills, Memories, Routines)
  await cdp.eval(`document.querySelector('.chat__header-right button[aria-label="Show details"]')?.click()`);
  await sleep(350);
  await cdp.eval(`document.querySelector('.details__gear')?.click()`);
  await sleep(500);
  await cdp.screenshot('10-bot-settings-general');
  report['10-bot-settings-general'] = await cdp.eval(AUDIT_JS);

  await cdp.eval(`Array.from(document.querySelectorAll('.cfg-nav__item')).find(b => b.textContent.includes('Skills'))?.click()`);
  await sleep(400);
  await cdp.screenshot('11-bot-settings-skills');
  report['11-bot-settings-skills'] = await cdp.eval(AUDIT_JS);

  await cdp.eval(`Array.from(document.querySelectorAll('.cfg-nav__item')).find(b => b.textContent.includes('Memories'))?.click()`);
  await sleep(400);
  await cdp.screenshot('12-bot-settings-memories');
  report['12-bot-settings-memories'] = await cdp.eval(AUDIT_JS);

  await cdp.eval(`Array.from(document.querySelectorAll('.cfg-nav__item')).find(b => b.textContent.includes('Routines'))?.click()`);
  await sleep(400);
  await cdp.screenshot('13-bot-settings-routines');
  report['13-bot-settings-routines'] = await cdp.eval(AUDIT_JS);

  await cdp.eval(`document.querySelector('.bot-settings .modal__close')?.click()`);
  await sleep(300);

  // 9. Test App Settings (General & Shaders, Models & BYOM, Computer, Permissions, Apps, Account)
  await cdp.eval(`document.querySelector('.composer-telemetry__chip')?.click()`);
  await sleep(500);
  await cdp.screenshot('14-app-settings-models');
  report['14-app-settings-models'] = await cdp.eval(AUDIT_JS);

  await cdp.eval(`Array.from(document.querySelectorAll('.app-settings__nav .cfg-nav__item')).find(b => b.textContent.includes('General'))?.click()`);
  await sleep(400);
  await cdp.screenshot('15-app-settings-general');
  report['15-app-settings-general'] = await cdp.eval(AUDIT_JS);

  await cdp.eval(`Array.from(document.querySelectorAll('.app-settings__nav .cfg-nav__item')).find(b => b.textContent.includes('Computer'))?.click()`);
  await sleep(400);
  await cdp.screenshot('16-app-settings-computer');
  report['16-app-settings-computer'] = await cdp.eval(AUDIT_JS);

  await cdp.eval(`document.querySelector('.app-settings__close')?.click()`);
  await sleep(300);

  // 10. Test Tasks Command Center on mobile
  await cdp.eval(`document.querySelector('.mobile-nav-btn')?.click()`);
  await sleep(350);
  await cdp.eval(`document.querySelector('.sidebar-island')?.click()`);
  await sleep(500);
  await cdp.screenshot('17-tasks-view');
  report['17-tasks-view'] = await cdp.eval(AUDIT_JS);

  console.log(JSON.stringify(report, null, 2));
  const totalIssues = Object.values(report).reduce((sum, r) => sum + (r?.issues?.length ?? 0), 0);
  cdp.close();
  chrome.kill();
  if (totalIssues > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  chrome.kill();
  process.exit(1);
});
