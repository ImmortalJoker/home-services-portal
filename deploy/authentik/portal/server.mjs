import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_GROUP = 'Portal - Public';
const FAMILY_GROUP = 'Portal - Family';
const OWNER_GROUP = 'Portal - Owner';
const PENDING_GROUP = 'Portal - Pending';
const knownGroups = new Set([PUBLIC_GROUP, FAMILY_GROUP, OWNER_GROUP]);
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
]);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeServiceUrl(value, id) {
  if (!nonEmptyString(value)) throw new Error(`Service ${id} needs a URL.`);
  const url = value.trim();
  if (url.startsWith('/') && !url.startsWith('//') && !url.includes('\\')) {
    const parsed = new URL(url, 'http://portal.invalid');
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
  return parsed.href;
}

export function validatePortalConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Portal configuration must be an object.');
  }
  if (!nonEmptyString(value.portalName)) throw new Error('portalName must be a non-empty string.');
  if (!Array.isArray(value.services)) throw new Error('services must be an array.');
  const ids = new Set();
  const services = value.services.map((service, index) => {
    if (!service || typeof service !== 'object' || Array.isArray(service)) {
      throw new Error(`Service at index ${index} must be an object.`);
    }
    const { id, name, description, category, widget } = service;
    if (!nonEmptyString(id)) throw new Error(`Service at index ${index} needs a non-empty id.`);
    if (ids.has(id)) throw new Error(`Duplicate service id: ${id}.`);
    ids.add(id);
    if (!nonEmptyString(name)) throw new Error(`Service ${id} needs a non-empty name.`);
    if (description !== undefined && typeof description !== 'string') {
      throw new Error(`Service ${id} description must be a string.`);
    }
    if (category !== undefined && typeof category !== 'string') {
      throw new Error(`Service ${id} category must be a string.`);
    }
    const accessGroups = service.accessGroups === undefined ? [PUBLIC_GROUP] : service.accessGroups;
    if (!Array.isArray(accessGroups) || accessGroups.length === 0 ||
        accessGroups.some((group) => !nonEmptyString(group) || !knownGroups.has(group.trim()))) {
      throw new Error(`Service ${id} accessGroups must contain one or more configured portal groups.`);
    }
    if (widget !== undefined && widget !== 'system-status') {
      throw new Error(`Service ${id} has an unsupported widget.`);
    }
    const normalizedGroups = [...new Set(accessGroups.map((group) => group.trim()))];
    if (widget === 'system-status' && !normalizedGroups.includes(OWNER_GROUP)) {
      throw new Error(`Service ${id} system-status widget must be restricted to Portal - Owner.`);
    }
    return {
      id,
      name: name.trim(),
      description,
      category,
      url: normalizeServiceUrl(service.url, id),
      accessGroups: normalizedGroups,
      ...(widget ? { widget } : {}),
    };
  });
  return { portalName: value.portalName.trim(), services };
}

export function parseAuthentikGroups(value) {
  if (typeof value !== 'string') return [];
  return value.split('|').map((group) => group.trim()).filter(Boolean);
}

export function effectivePortalGroups(groups) {
  const membership = new Set(groups);
  if (membership.has(OWNER_GROUP)) return [PUBLIC_GROUP, FAMILY_GROUP, OWNER_GROUP];
  if (membership.has(FAMILY_GROUP)) return [PUBLIC_GROUP, FAMILY_GROUP];
  if (membership.has(PUBLIC_GROUP)) return [PUBLIC_GROUP];
  if (membership.has(PENDING_GROUP)) return [PENDING_GROUP];
  return [];
}

export function filterServices(services, groups) {
  const effective = new Set(effectivePortalGroups(groups));
  return services.filter((service) => {
    const accessGroups = service.accessGroups ?? [PUBLIC_GROUP];
    return accessGroups.some((group) => effective.has(group));
  });
}

function decodeUtf8HeaderFromLatin1(value) {
  // Authentik sends UTF-8 header bytes; Node exposes HTTP header strings as Latin-1.
  if ([...value].some((character) => character.codePointAt(0) > 0xff)) return value;
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  return decoded.includes(String.fromCodePoint(0xfffd)) ? value : decoded;
}

function getIdentity(request) {
  const username = request.headers['x-authentik-username'];
  if (typeof username !== 'string' || !username.trim()) return { status: 401 };
  const groups = parseAuthentikGroups(request.headers['x-authentik-groups']);
  const effectiveGroups = effectivePortalGroups(groups);
  if (effectiveGroups.length === 0) return { status: 403 };
  const role = groups.includes(OWNER_GROUP) ? 'Owner'
    : groups.includes(FAMILY_GROUP) ? 'Family'
      : groups.includes(PUBLIC_GROUP) ? 'Public' : 'Pending';
  return {
    status: 200,
    identity: {
      username: username.trim().slice(0, 256),
      name: typeof request.headers['x-authentik-name'] === 'string'
        ? decodeUtf8HeaderFromLatin1(request.headers['x-authentik-name']).trim().slice(0, 256)
        : username.trim().slice(0, 256),
      email: typeof request.headers['x-authentik-email'] === 'string'
        ? request.headers['x-authentik-email'].trim().slice(0, 320)
        : '',
      role,
      groups: effectiveGroups,
    },
  };
}

function validSystemStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const numericFields = [
    'cpu_percent', 'load_1m', 'logical_cores', 'memory_percent',
    'memory_used_bytes', 'memory_total_bytes', 'disk_percent',
    'disk_free_bytes', 'disk_total_bytes', 'uptime_seconds', 'updated_at',
  ];
  if (!numericFields.every((field) => Number.isFinite(value[field]))) return false;
  return value.cpu_percent >= 0 && value.cpu_percent <= 100 &&
    value.memory_percent >= 0 && value.memory_percent <= 100 &&
    value.disk_percent >= 0 && value.disk_percent <= 100 &&
    Number.isInteger(value.logical_cores) && value.logical_cores > 0 &&
    Number.isInteger(value.memory_used_bytes) && value.memory_used_bytes >= 0 &&
    Number.isInteger(value.memory_total_bytes) && value.memory_total_bytes > 0 &&
    Number.isInteger(value.disk_free_bytes) && value.disk_free_bytes >= 0 &&
    Number.isInteger(value.disk_total_bytes) && value.disk_total_bytes > 0 &&
    value.disk_free_bytes <= value.disk_total_bytes &&
    Number.isInteger(value.uptime_seconds) && value.uptime_seconds >= 0 &&
    Number.isInteger(value.updated_at) && value.updated_at > 0;
}

function requestSystemStatus(url, host) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const requester = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = requester(target, {
      method: 'GET',
      headers: { Accept: 'application/json', Host: host },
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          req.destroy(new Error('System status response exceeded the size limit.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const contentType = res.headers['content-type'] ?? '';
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          payload = null;
        }
        resolve({ statusCode: res.statusCode ?? 502, contentType, payload });
      });
    });
    req.on('timeout', () => req.destroy(new Error('System status request timed out.')));
    req.on('error', reject);
    req.end();
  });
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}

function sendJson(response, status, payload, method = 'GET') {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(method === 'HEAD' ? undefined : body);
}

function sendText(response, status, text, method = 'GET') {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  response.end(method === 'HEAD' ? undefined : text);
}

async function serveStatic(request, response, pathname, distDir) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendText(response, 400, 'Bad request', request.method);
    return;
  }
  const root = resolve(distDir);
  const candidate = resolve(root, `.${decodedPath}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    sendText(response, 404, 'Not found', request.method);
    return;
  }

  let file = candidate;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = resolve(file, 'index.html');
  } catch {
    if (!extname(decodedPath)) file = resolve(root, 'index.html');
  }

  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    sendText(response, 404, 'Not found', request.method);
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=300',
      'Content-Length': info.size,
      'Content-Type': contentTypes.get(extname(file)) ?? 'application/octet-stream',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  } catch {
    sendText(response, 404, 'Not found', request.method);
  }
}

export function createPortalServer({
  config,
  distDir,
  statusUpstreamUrl = process.env.PORTAL_STATUS_UPSTREAM_URL ?? '',
  statusExternalUrl = process.env.PORTAL_STATUS_EXTERNAL_URL ?? '',
  statusRequester = requestSystemStatus,
} = {}) {
  const validatedConfig = validatePortalConfig(config);
  const hasSystemStatusWidget = validatedConfig.services.some((service) => service.widget === 'system-status');
  let statusSource = null;
  if (statusUpstreamUrl || statusExternalUrl) {
    if (!statusUpstreamUrl || !statusExternalUrl) {
      throw new Error('System status upstream and external URLs must both be configured.');
    }
    let upstream;
    let external;
    try {
      upstream = new URL(statusUpstreamUrl);
      external = new URL(statusExternalUrl);
    } catch {
      throw new Error('System status URLs must be valid absolute URLs.');
    }
    if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.hash) {
      throw new Error('System status upstream must be an HTTP(S) URL without credentials or a fragment.');
    }
    if (external.protocol !== 'https:' || external.username || external.password ||
        external.pathname !== '/' || external.search || external.hash) {
      throw new Error('System status external URL must be a bare HTTPS origin.');
    }
    if (typeof statusRequester !== 'function') throw new Error('System status request handler is unavailable.');
    statusSource = { url: upstream.href, host: external.host };
  }
  if (hasSystemStatusWidget && !statusSource) {
    throw new Error('System status widget requires configured upstream and external URLs.');
  }
  const staticDir = resolve(distDir ?? process.env.PORTAL_DIST_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../dist'));
  return createServer(async (request, response) => {
    setSecurityHeaders(response);
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(response, 405, 'Method not allowed', method);
      return;
    }

    let pathname;
    try {
      pathname = new URL(request.url ?? '/', 'http://portal.internal').pathname;
    } catch {
      sendText(response, 400, 'Bad request', method);
      return;
    }

    let routePath;
    try {
      routePath = decodeURIComponent(pathname);
    } catch {
      sendText(response, 400, 'Bad request', method);
      return;
    }
    if (routePath.length > 1) routePath = routePath.replace(/\/+$/, '');

    if (routePath === '/api/session') {
      const auth = getIdentity(request);
      if (auth.status !== 200) {
        sendJson(response, auth.status, { error: auth.status === 401 ? 'Authentication required.' : 'Portal access denied.' }, method);
        return;
      }
      sendJson(response, 200, {
        portalName: validatedConfig.portalName,
        identity: auth.identity,
        services: filterServices(validatedConfig.services, auth.identity.groups),
      }, method);
      return;
    }

    if (routePath === '/api/system-status') {
      const auth = getIdentity(request);
      if (auth.status !== 200) {
        sendJson(response, auth.status, { error: auth.status === 401 ? 'Authentication required.' : 'Portal access denied.' }, method);
        return;
      }
      if (auth.identity.role !== 'Owner' || !hasSystemStatusWidget) {
        sendJson(response, 403, { error: 'System status access denied.' }, method);
        return;
      }
      try {
        const upstreamResponse = await statusRequester(statusSource.url, statusSource.host);
        if (upstreamResponse.statusCode < 200 || upstreamResponse.statusCode >= 300 ||
            !upstreamResponse.contentType.toLowerCase().includes('application/json')) {
          sendJson(response, 502, { error: 'System status is temporarily unavailable.' }, method);
          return;
        }
        const payload = upstreamResponse.payload;
        if (!validSystemStatus(payload)) {
          sendJson(response, 502, { error: 'System status returned invalid data.' }, method);
          return;
        }
        const safePayload = Object.fromEntries([
          'cpu_percent', 'load_1m', 'logical_cores', 'memory_percent',
          'memory_used_bytes', 'memory_total_bytes', 'disk_percent',
          'disk_free_bytes', 'disk_total_bytes', 'uptime_seconds', 'updated_at',
        ].map((field) => [field, payload[field]]));
        sendJson(response, 200, safePayload, method);
      } catch {
        sendJson(response, 502, { error: 'System status is temporarily unavailable.' }, method);
      }
      return;
    }

    if (routePath === '/owner-check' || routePath === '/family-check' || routePath === '/sample') {
      const auth = getIdentity(request);
      if (auth.status !== 200) {
        sendText(response, auth.status, auth.status === 401 ? 'Authentication required.' : 'Portal access denied.', method);
        return;
      }
      if (auth.identity.role === 'Pending') {
        sendText(response, 403, 'This test endpoint is not available until the owner approves your access.', method);
        return;
      }
      const requiredRole = routePath === '/owner-check' ? 'Owner' : routePath === '/family-check' ? 'Family' : 'Public';
      const rank = { Public: 1, Family: 2, Owner: 3 };
      if (rank[auth.identity.role] < rank[requiredRole]) {
        sendText(response, 403, 'This test endpoint is not available to your portal group.', method);
        return;
      }
      const label = routePath === '/owner-check' ? 'Owner-only test endpoint' : routePath === '/family-check' ? 'Family test endpoint' : 'Shared test endpoint';
      sendText(response, 200, `${label} reached by ${auth.identity.username}.`, method);
      return;
    }

    if (routePath.startsWith('/api/')) {
      sendJson(response, 404, { error: 'Not found.' }, method);
      return;
    }
    await serveStatic(request, response, pathname, staticDir);
  });
}

async function loadConfig(path) {
  const content = await readFile(path, 'utf8');
  return validatePortalConfig(JSON.parse(content));
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const configPath = process.env.PORTAL_CONFIG_PATH ?? '/app/config/portal-services.json';
  const config = await loadConfig(configPath);
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  const server = createPortalServer({ config });
  server.listen(port, '0.0.0.0', () => console.log(`Portal listening on internal port ${port}.`));
}
