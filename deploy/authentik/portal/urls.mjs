// Shared by the browser config validator (src/config.ts) and the portal backend (server.mjs),
// so both sides accept and normalize exactly the same service URLs.

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Same-origin path (e.g. "/sample") or absolute HTTP(S) URL, normalized. */
export function normalizeServiceUrl(value, id) {
  if (!nonEmptyString(value)) throw new Error(`Service ${id} needs a URL.`);
  const url = value.trim();
  if (url.startsWith('/') && !url.startsWith('//') && !url.includes('\\')) {
    const parsed = new URL(url, 'https://portal.invalid');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Service ${id} URL must be absolute or a same-origin path.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Service ${id} URL must use HTTP or HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Service ${id} URL must not contain credentials.`);
  }
  return parsed.href;
}

/** Optional OPDS catalog link: credential-free HTTPS only. */
export function validateOpdsUrl(value, id) {
  if (value === undefined) return undefined;
  let parsed;
  try {
    parsed = typeof value === 'string' ? new URL(value) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`Service ${id} OPDS URL must use credential-free HTTPS.`);
  }
  return parsed.href;
}
