#!/usr/bin/env node
// Generates the selected (first, detailed) portal icon package from
// artwork/proposed/portal-source.svg. Node >= 22, Node built-ins only, no dependencies.
//
//   BROWSER_BIN=/absolute/path/to/chromium node scripts/render-portal-artwork.mjs
//
// See docs/artwork-provenance.md for the procedure and provenance notes.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_VERSION = 2;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DRAFT = 'artwork/proposed/portal-source.svg';
const DRAFT_SHA256 = 'dd3dca7aa4ded407963d20b6b9ccb6bcba62bc40b38915251c228d0587f4ad41';
const PROVISIONAL_COMMENT =
  '<!-- Original geometric portal artwork for this project; no external image assets. The repository MIT license applies. -->';
const SOURCE = 'public/icons/portal-source.svg';
const FAVICON = 'public/favicon.svg';
const REPORT = 'artwork/rendered-assets.json';
const LOCK = '.portal-artwork-render.lock';
const TARGETS = [
  { path: 'public/apple-touch-icon.png', size: 180, purpose: 'apple-touch-icon' },
  { path: 'public/icons/portal-192.png', size: 192, purpose: 'any' },
  { path: 'public/icons/portal-512.png', size: 512, purpose: 'any' },
  { path: 'public/icons/portal-maskable-512.png', size: 512, purpose: 'maskable' },
];

const STARTUP_MS = 30_000;
const COMMAND_MS = 15_000;
const EXIT_MS = 10_000;
const MAX_CAPTURES = 6;
const PROFILE_PREFIX = 'portal-artwork-chromium-';

// Sandbox stays enabled: no --no-sandbox or similar flag is ever passed.
const CHROMIUM_FLAGS = [
  '--headless=new',
  '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=0',
  '--disable-background-networking',
  '--disable-client-side-phishing-detection',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--disable-extensions',
  '--disable-sync',
  '--disable-breakpad',
  '--disable-features=MediaRouter,OptimizationHints,Translate',
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--no-first-run',
  '--no-default-browser-check',
  '--no-service-autorun',
  '--password-store=basic',
  '--use-mock-keychain',
  '--force-color-profile=srgb',
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  '--mute-audio',
  '--window-size=512,512',
];

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_ALLOWED = {
  svg: ['xmlns', 'viewBox'],
  defs: [],
  linearGradient: ['id', 'x1', 'y1', 'x2', 'y2'],
  stop: ['offset', 'stop-color'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'fill', 'stroke', 'stroke-width'],
  path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
  circle: ['cx', 'cy', 'r', 'fill'],
};
const SVG_TAG = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z][A-Za-z0-9-]*="[^"<>&]*")*)\s*(\/?)>/y;
const SVG_SPACE = /[ \t\r\n]+/y;
const SVG_ATTR = /\s+([A-Za-z][A-Za-z0-9-]*)="([^"<>&]*)"/g;
const SAFE_VALUE = /^[#A-Za-z0-9 .,()-]*$/;
const LOCAL_URL = /url\(#([A-Za-z][A-Za-z0-9_-]*)\)/g;
const WS_PATH = /^\/devtools\/browser\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from('0000000049454e44ae426082', 'hex');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const abs = (rel) => path.join(ROOT, ...rel.split('/'));

function checkRuntime() {
  const major = Number(process.versions.node.split('.')[0]);
  if (!(major >= 22)) throw new Error(`Node >= 22 is required, found ${process.version}`);
  if (typeof globalThis.WebSocket !== 'function') throw new Error('This Node build has no native WebSocket');
}

function resolveBrowserBin() {
  const bin = process.env.BROWSER_BIN;
  if (!bin || !path.isAbsolute(bin)) {
    throw new Error('Set BROWSER_BIN to the absolute path of an already-installed Chromium executable');
  }
  if (!fs.statSync(bin).isFile()) throw new Error('BROWSER_BIN is not a regular file');
  fs.accessSync(bin, fs.constants.X_OK);
  return bin;
}

// Allow-list validation: only whitespace and the listed elements/attributes are accepted.
// Comments, processing instructions, DOCTYPE/entities, CDATA, text, scripts, styles,
// event handlers, href attributes and non-local url() references are all rejected.
function validateSvg(text) {
  const stack = [];
  const ids = new Set();
  const refs = [];
  let roots = 0;
  let i = 0;
  while (i < text.length) {
    SVG_SPACE.lastIndex = i;
    if (SVG_SPACE.test(text)) {
      i = SVG_SPACE.lastIndex;
      continue;
    }
    SVG_TAG.lastIndex = i;
    const match = SVG_TAG.exec(text);
    if (!match) throw new Error(`SVG rejected: unsupported markup at offset ${i}`);
    i = SVG_TAG.lastIndex;
    const [, closing, name, attrText, selfClosing] = match;
    if (closing) {
      if (attrText || selfClosing || stack.pop() !== name) throw new Error(`SVG rejected: unbalanced </${name}>`);
      continue;
    }
    if (!Object.hasOwn(SVG_ALLOWED, name)) throw new Error(`SVG rejected: element <${name}> is not allowed`);
    if (stack.length === 0 && (name !== 'svg' || roots++ > 0)) throw new Error('SVG rejected: expected a single <svg> root');
    if (stack.length > 0 && name === 'svg') throw new Error('SVG rejected: nested <svg>');
    const seen = new Set();
    for (const [, attr, value] of attrText.matchAll(SVG_ATTR)) {
      if (seen.has(attr)) throw new Error(`SVG rejected: duplicate ${attr} on <${name}>`);
      seen.add(attr);
      if (!SVG_ALLOWED[name].includes(attr)) throw new Error(`SVG rejected: attribute ${attr} on <${name}> is not allowed`);
      if (attr === 'xmlns') {
        // The namespace URI is an identifier, not a resource fetch; only the SVG namespace is accepted.
        if (value !== SVG_NS) throw new Error('SVG rejected: unexpected namespace');
        continue;
      }
      if (!SAFE_VALUE.test(value)) throw new Error(`SVG rejected: unsafe characters in ${attr} on <${name}>`);
      const remainder = value.replace(LOCAL_URL, (_, id) => {
        refs.push(id);
        return '';
      });
      if (/url|[()]/i.test(remainder)) throw new Error(`SVG rejected: non-local reference in ${attr} on <${name}>`);
      if (attr === 'id') {
        if (ids.has(value)) throw new Error(`SVG rejected: duplicate id ${value}`);
        ids.add(value);
      }
    }
    if (name === 'svg' && !seen.has('xmlns')) throw new Error('SVG rejected: root lacks the SVG namespace');
    if (!selfClosing) stack.push(name);
  }
  if (stack.length !== 0 || roots !== 1) throw new Error('SVG rejected: incomplete document');
  for (const id of refs) {
    if (!ids.has(id)) throw new Error(`SVG rejected: url(#${id}) has no local target`);
  }
}

// The only transformation: drop the provisional leading comment and its newline.
function deliverySvg() {
  const draft = fs.readFileSync(abs(DRAFT));
  if (sha256(draft) !== DRAFT_SHA256) throw new Error(`${DRAFT} does not match the selected design hash`);
  const text = draft.toString('utf8');
  const prefix = `${PROVISIONAL_COMMENT}\n`;
  if (!text.startsWith(prefix)) throw new Error(`${DRAFT} does not start with the expected provisional comment`);
  const delivery = text.slice(prefix.length);
  validateSvg(delivery);
  const bytes = Buffer.from(delivery, 'utf8');
  if (!Buffer.concat([Buffer.from(prefix, 'utf8'), bytes]).equals(draft)) {
    throw new Error('Comment removal was not a byte-exact prefix removal');
  }
  return bytes;
}

function checkPng(data, size) {
  const valid =
    data.length >= 8 + 25 + 12 &&
    data.subarray(0, 8).equals(PNG_SIGNATURE) &&
    data.readUInt32BE(8) === 13 &&
    data.toString('latin1', 12, 16) === 'IHDR' &&
    data.subarray(-12).equals(PNG_IEND);
  if (!valid) throw new Error('Capture is not a complete PNG');
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== size || height !== size) throw new Error(`Capture is ${width}x${height}, expected ${size}x${size}`);
  return { width, height };
}

function writeAtomic(rel, data) {
  const target = abs(rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  let created = false;
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx' });
    created = true;
    fs.renameSync(temporary, target);
  } catch (error) {
    if (created) fs.rmSync(temporary, { force: true });
    throw error;
  }
}

class Cdp {
  #ws;
  #nextId = 1;
  #pending = new Map();
  #waiters = new Set();

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Timed out connecting to the DevTools WebSocket'));
      }, COMMAND_MS);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new Cdp(ws));
      }, { once: true });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('DevTools WebSocket handshake failed; do not work around this by widening --remote-allow-origins'));
      }, { once: true });
    });
  }

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (event) => this.#onMessage(event));
    ws.addEventListener('close', () => this.#failAll(new Error('DevTools connection closed')));
  }

  #onMessage(event) {
    if (typeof event.data !== 'string') return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const entry = this.#pending.get(message.id);
      if (!entry) return;
      this.#pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(`${entry.method} failed: ${message.error.message}`));
      else entry.resolve(message.result ?? {});
      return;
    }
    for (const waiter of this.#waiters) {
      if (waiter.method === message.method && waiter.sessionId === message.sessionId) {
        this.#waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(message.params ?? {});
      }
    }
  }

  #failAll(error) {
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.#pending.clear();
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.#waiters.clear();
  }

  send(method, params = {}, sessionId = undefined) {
    if (this.#ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`${method}: DevTools connection is not open`));
    }
    const id = this.#nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out after ${COMMAND_MS} ms`));
      }, COMMAND_MS);
      this.#pending.set(id, { method, resolve, reject, timer });
      this.#ws.send(JSON.stringify(message));
    });
  }

  // Register before triggering the event; the returned promise is pre-handled so an
  // early failure elsewhere cannot surface as an unhandled rejection.
  waitFor(method, sessionId) {
    const promise = new Promise((resolve, reject) => {
      const waiter = { method, sessionId, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.#waiters.delete(waiter);
        reject(new Error(`${method} not received within ${COMMAND_MS} ms`));
      }, COMMAND_MS);
      this.#waiters.add(waiter);
    });
    promise.catch(() => {});
    return promise;
  }

  close() {
    if (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING) this.#ws.close();
  }
}

async function devToolsEndpoint(profile, child, log) {
  const file = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + STARTUP_MS;
  let seen = false;
  while (Date.now() < deadline) {
    if (log.spawnError) throw new Error(`Could not start Chromium: ${log.spawnError.message}`);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Chromium exited during startup${log.stderr ? `:\n${log.stderr}` : ''}`);
    }
    let text = '';
    try {
      if (!fs.lstatSync(file).isFile()) throw new Error('DevToolsActivePort is not a regular file');
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (text) {
      seen = true;
      const lines = text.trim().split(/\r?\n/);
      const port = Number(lines[0]);
      if (
        lines.length === 2 &&
        /^[0-9]{1,5}$/.test(lines[0]) &&
        port >= 1 &&
        port <= 65535 &&
        WS_PATH.test(lines[1])
      ) {
        return `ws://127.0.0.1:${port}${lines[1]}`;
      }
    }
    await sleep(100);
  }
  throw new Error(seen ? 'DevToolsActivePort did not contain a valid port and browser path' : 'Timed out waiting for DevToolsActivePort');
}

async function stopChild(child, exited) {
  if (child.pid === undefined) return;
  const running = () => child.exitCode === null && child.signalCode === null;
  const waitExit = (ms) => Promise.race([exited, sleep(ms)]);
  if (running()) await waitExit(EXIT_MS);
  if (running()) {
    child.kill('SIGTERM');
    await waitExit(5_000);
  }
  if (running()) {
    child.kill('SIGKILL');
    await waitExit(5_000);
  }
  if (running()) throw new Error(`Chromium pid ${child.pid} did not exit; its temporary profile was left in place`);
}

function removeProfile(profile, tmpRoot) {
  if (path.dirname(profile) !== tmpRoot || !path.basename(profile).startsWith(PROFILE_PREFIX)) {
    throw new Error('Refusing to remove an unexpected profile path');
  }
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}

async function stableCapture(cdp, sessionId, size) {
  let previous;
  for (let attempt = 0; attempt < MAX_CAPTURES; attempt++) {
    const { data } = await cdp.send(
      'Page.captureScreenshot',
      {
        format: 'png',
        clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
        fromSurface: true,
        captureBeyondViewport: false,
      },
      sessionId,
    );
    if (typeof data !== 'string') throw new Error('Page.captureScreenshot returned no data');
    const png = Buffer.from(data, 'base64');
    checkPng(png, size);
    if (previous && previous.equals(png)) return png;
    previous = png;
  }
  throw new Error(`Capture at ${size}px did not produce two identical consecutive frames`);
}

async function render(bin, svgUrl) {
  const tmpRoot = fs.realpathSync(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(tmpRoot, PROFILE_PREFIX));
  const log = { stderr: '', spawnError: undefined };
  let child;
  let exited;
  let cdp;
  try {
    fs.chmodSync(profile, 0o700);
    if ((fs.statSync(profile).mode & 0o777) !== 0o700) throw new Error('Temporary profile is not mode 0700');
    const args = [...CHROMIUM_FLAGS, `--user-data-dir=${profile}`, 'about:blank'];
    if (args.some((arg) => /sandbox/i.test(arg))) throw new Error('Refusing to alter the Chromium sandbox');
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: profile };
    if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
    child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], env });
    exited = new Promise((resolve) => child.once('exit', resolve));
    child.once('error', (error) => {
      log.spawnError = error;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      log.stderr = (log.stderr + chunk).slice(-4000);
    });

    cdp = await Cdp.connect(await devToolsEndpoint(profile, child, log));
    const version = await cdp.send('Browser.getVersion');
    if (typeof version.product !== 'string' || typeof version.revision !== 'string') {
      throw new Error('Browser.getVersion returned no product/revision');
    }
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);

    const captures = new Map();
    for (const target of TARGETS) {
      await cdp.send(
        'Emulation.setDeviceMetricsOverride',
        { width: target.size, height: target.size, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      const loaded = cdp.waitFor('Page.loadEventFired', sessionId);
      const navigation = await cdp.send('Page.navigate', { url: svgUrl }, sessionId);
      if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
      if (navigation.isDownload) throw new Error('Navigation unexpectedly became a download');
      await loaded;
      captures.set(target.path, await stableCapture(cdp, sessionId, target.size));
    }

    try {
      await cdp.send('Browser.close');
    } catch {
      // Chromium may drop the socket before replying; exit is confirmed below.
    }
    return { version, captures };
  } finally {
    cdp?.close();
    let stopped = true;
    if (child) {
      try {
        await stopChild(child, exited);
      } catch (error) {
        stopped = false;
        process.exitCode = 1;
        console.error(`render-portal-artwork: ${error.message}`);
      }
    }
    if (stopped) removeProfile(profile, tmpRoot);
  }
}

// Checkout-scoped exclusive lock. Never stolen, retried or forced; released only by its owner.
let lockHeld = false;

function acquireLock() {
  let fd;
  try {
    fd = fs.openSync(abs(LOCK), 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(
        `Another render holds the checkout lock ${LOCK}; not starting. If no renderer is running, see docs/artwork-provenance.md for manual recovery.`,
      );
    }
    throw error;
  }
  lockHeld = true;
  try {
    fs.writeSync(fd, `${process.pid}\n`);
  } finally {
    fs.closeSync(fd);
  }
}

function releaseLock() {
  if (!lockHeld) return;
  lockHeld = false;
  try {
    fs.unlinkSync(abs(LOCK));
  } catch (error) {
    process.exitCode = 1;
    console.error(`render-portal-artwork: could not remove ${LOCK}: ${error.message}`);
  }
}

async function main() {
  try {
    acquireLock();
    await renderPackage();
  } finally {
    releaseLock();
  }
}

async function renderPackage() {
  checkRuntime();
  const bin = resolveBrowserBin();
  const svg = deliverySvg();
  writeAtomic(SOURCE, svg);
  const { version, captures } = await render(bin, pathToFileURL(abs(SOURCE)).href);
  if (!fs.readFileSync(abs(SOURCE)).equals(svg)) throw new Error(`${SOURCE} changed during rendering`);
  for (const target of TARGETS) writeAtomic(target.path, captures.get(target.path));
  writeAtomic(FAVICON, svg);

  const assets = {};
  for (const target of TARGETS) {
    const data = fs.readFileSync(abs(target.path));
    const { width, height } = checkPng(data, target.size);
    assets[target.path] = { sha256: sha256(data), width, height, purpose: target.purpose };
  }
  const report = {
    schema_version: 1,
    generator: { script: 'scripts/render-portal-artwork.mjs', script_version: SCRIPT_VERSION, node: process.version },
    renderer: {
      product: version.product,
      revision: version.revision,
      protocol_version: version.protocolVersion,
      js_version: version.jsVersion,
      flags: CHROMIUM_FLAGS,
      device_scale_factor: 1,
      capture: 'Page.captureScreenshot PNG, viewport-origin clip at scale 1, accepted after two identical consecutive frames',
    },
    draft_source: DRAFT,
    draft_source_sha256: DRAFT_SHA256,
    transformation: 'Removed the leading provisional comment and its newline; all following bytes unchanged.',
    source: SOURCE,
    source_sha256: sha256(fs.readFileSync(abs(SOURCE))),
    favicon: FAVICON,
    favicon_sha256: sha256(fs.readFileSync(abs(FAVICON))),
    assets,
    notes: [
      'Local delivery candidate generated from the selected first design; this report is not a deployment record.',
      'The maskable PNG reuses the full-bleed design. Platform masks may crop the background and frame; crop and device behaviour were not inspected by this script.',
    ],
  };
  writeAtomic(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.source_sha256}  ${SOURCE}`);
  console.log(`${report.favicon_sha256}  ${FAVICON}`);
  for (const [rel, asset] of Object.entries(assets)) console.log(`${asset.sha256}  ${rel}  ${asset.width}x${asset.height}`);
  console.log(`Rendered with ${version.product} (${version.revision}); report: ${REPORT}`);
}

main().catch((error) => {
  console.error(`render-portal-artwork: ${error.message}`);
  process.exitCode = 1;
});
