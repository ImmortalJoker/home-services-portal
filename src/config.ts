export interface ServiceItem {
  id: string;
  name: string;
  description?: string;
  url: string;
  category?: string;
}

export interface PortalConfig {
  portalName: string;
  services: ServiceItem[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateConfig(value: unknown): PortalConfig {
  if (!isRecord(value)) throw new Error('Configuration must be an object.');
  if (!nonEmptyString(value.portalName)) throw new Error('portalName must be a non-empty string.');
  if (!Array.isArray(value.services)) throw new Error('services must be an array.');

  const ids = new Set<string>();
  const services = value.services.map((item, index): ServiceItem => {
    if (!isRecord(item)) throw new Error(`Service at index ${index} must be an object.`);
    const { id, name, description, url, category } = item;
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
    if (!nonEmptyString(url)) throw new Error(`Service ${id} needs a URL.`);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Service ${id} URL must be absolute.`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Service ${id} URL must use HTTP or HTTPS.`);
    }
    return { id, name, description, url: parsed.href, category };
  });

  return { portalName: value.portalName, services };
}
