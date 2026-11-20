import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * Minimal JSON request over node:http(s).
 * Unlike fetch, node:http sends a caller-supplied Host header unchanged, which
 * loopback-only upstreams (host whitelists, virtual hosts) depend on.
 * The response body is capped and parsed leniently: payload is null when it is not JSON.
 */
export function requestJson(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 5000,
  maxBytes = 64 * 1024,
} = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const requester = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const requestHeaders = { Accept: 'application/json', ...headers };
    if (body !== undefined) requestHeaders['Content-Length'] = Buffer.byteLength(body);
    // Settle exactly once: after destroy() the response may still emit 'end' with partial data.
    let settled = false;
    const fail = (error) => {
      if (!settled) { settled = true; reject(error); }
      req.destroy();
    };
    const req = requester(target, { method, headers: requestHeaders, timeout: timeoutMs }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > maxBytes) {
          fail(new Error('Upstream response exceeded the size limit.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', fail);
      res.on('end', () => {
        if (settled) return;
        settled = true;
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          payload = null;
        }
        resolve({ statusCode: res.statusCode ?? 502, headers: res.headers, payload });
      });
    });
    req.on('timeout', () => fail(new Error('Upstream request timed out.')));
    req.on('error', fail);
    req.end(body);
  });
}
