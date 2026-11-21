import { requestJson } from './http.mjs';

// Transmission torrent status codes: 3 = queued to download, 4 = downloading.
const DOWNLOADING = new Set([3, 4]);
const STOPPED = 0;

export function summarizeTorrents(torrents) {
  const fields = ['status', 'sizeWhenDone', 'leftUntilDone', 'rateDownload', 'rateUpload'];
  if (!Array.isArray(torrents) || !torrents.every(t => t && fields.every(k => Number.isFinite(t[k]) && t[k] >= 0))) throw new Error('Invalid Transmission response');
  const total = torrents.reduce((n, t) => n + t.sizeWhenDone, 0);
  const remaining = torrents.reduce((n, t) => n + Math.min(t.leftUntilDone, t.sizeWhenDone), 0);
  return {
    downloading: torrents.filter(t => DOWNLOADING.has(t.status)).length,
    // Active = not stopped: includes downloading, seeding, queued and verifying torrents.
    active: torrents.filter(t => t.status !== STOPPED).length,
    total: torrents.length,
    percent: total ? 100 * (total - remaining) / total : null,
    download_bps: torrents.reduce((n, t) => n + t.rateDownload, 0),
    upload_bps: torrents.reduce((n, t) => n + t.rateUpload, 0),
  };
}

// Docker host gateway + Transmission's standard RPC port and path.
export const DEFAULT_TRANSMISSION_RPC_URL = 'http://host.docker.internal:9091/transmission/rpc';

/**
 * Resolves the optional PORTAL_TRANSMISSION_RPC_URL override. Blank/unset keeps the
 * default; otherwise it must be an absolute HTTP(S) URL without credentials, query or
 * fragment. Errors never echo the configured value.
 */
export function resolveTransmissionRpcUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return new URL(DEFAULT_TRANSMISSION_RPC_URL);
  let parsed;
  try {
    // Check the original text before URL parsing can normalize malformed authority or empty delimiters.
    if (/^https?:\/\/[^/?#@\\\s]+(?:\/[^?#]*)?$/i.test(raw)) parsed = new URL(raw);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    throw new Error('PORTAL_TRANSMISSION_RPC_URL must be an absolute HTTP(S) URL without credentials, query or fragment.');
  }
  return parsed;
}

export async function requestTransmissionSummary({ request = requestJson } = {}) {
  const username = process.env.PORTAL_TRANSMISSION_RPC_USERNAME;
  const password = process.env.PORTAL_TRANSMISSION_RPC_PASSWORD;
  if (!username || !password) throw new Error('Transmission summary unavailable');
  const rawOverride = process.env.PORTAL_TRANSMISSION_RPC_URL;
  const rpcUrl = resolveTransmissionRpcUrl(rawOverride);
  const url = rpcUrl.href;
  // node:http keeps the caller-supplied Host header (fetch would replace it). The
  // default host-gateway endpoint sends localhost:<port> so Transmission's host
  // whitelist accepts it even if RPC password auth is ever disabled; an explicit
  // override sends its own authority so virtual-host proxies route correctly.
  const isOverride = typeof rawOverride === 'string' && rawOverride.trim() !== '';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    Host: isOverride ? rpcUrl.host : `localhost:${rpcUrl.port}`,
  };
  const body = JSON.stringify({ method: 'torrent-get', arguments: { fields: ['status', 'sizeWhenDone', 'leftUntilDone', 'rateDownload', 'rateUpload'] } });
  const send = () => request(url, { method: 'POST', headers, body, maxBytes: 1024 * 1024 });
  let response = await send();
  if (response.statusCode === 409) {
    const session = response.headers['x-transmission-session-id'];
    if (typeof session !== 'string' || !session) throw new Error('Transmission handshake unavailable');
    headers['X-Transmission-Session-Id'] = session;
    response = await send();
  }
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('Transmission unavailable');
  if (response.payload?.result !== 'success') throw new Error('Transmission unavailable');
  return summarizeTorrents(response.payload.arguments?.torrents);
}
