import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function normalizePeerAddress(address) {
  if (typeof address !== 'string') return null;
  const value = address.startsWith('::ffff:') ? address.slice(7) : address;
  return isIP(value) && !['0.0.0.0', '::'].includes(value) ? value : null;
}

export function isTrustedProxy(remoteAddress, trustedAddresses) {
  const peer = normalizePeerAddress(remoteAddress);
  return !!peer && trustedAddresses.some(address => normalizePeerAddress(address) === peer);
}

export async function resolveProxyAddresses(host, resolver = lookup) {
  if (typeof host !== 'string' || !host.trim()) return [];
  try {
    const results = await resolver(host, { all: true });
    return results.map(result => normalizePeerAddress(result.address)).filter(Boolean);
  } catch {
    return []; // DNS failure must never fall back to trusting caller-supplied headers.
  }
}
