import { validateLaunch, type ServiceLaunch } from '../deploy/authentik/portal/launch.mjs';
import { validateGuides, type ServiceGuides } from '../deploy/authentik/portal/guides.mjs';
import { normalizeServiceUrl, validateOpdsUrl } from '../deploy/authentik/portal/urls.mjs';

export interface ServiceItem {
  id: string;
  name: string;
  description?: string;
  url: string;
  category?: string;
  accessGroups?: string[];
  widget?: 'system-status';
  launch?: ServiceLaunch;
  opdsUrl?: string;
  guides?: ServiceGuides;
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
    const { id, name, description, url, category, accessGroups, widget } = item;
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
    if (widget !== undefined && widget !== 'system-status') {
      throw new Error(`Service ${id} has an unsupported widget.`);
    }
    const normalizedUrl = normalizeServiceUrl(url, id);
    let normalizedGroups: string[] | undefined;
    if (accessGroups !== undefined) {
      if (!Array.isArray(accessGroups) || accessGroups.length === 0 || accessGroups.some((group) => !nonEmptyString(group))) {
        throw new Error(`Service ${id} accessGroups must be a non-empty array of group names.`);
      }
      normalizedGroups = [...new Set(accessGroups.map((group) => group.trim()))];
    }
    if (widget === 'system-status' && (normalizedGroups?.length !== 1 || normalizedGroups[0] !== 'Portal - Owner')) {
      throw new Error(`Service ${id} system-status widget must be restricted to Portal - Owner.`);
    }
    const launch = validateLaunch(item.launch, id, normalizedUrl);
    const guides = validateGuides(item.guides);
    const opdsUrl = validateOpdsUrl(item.opdsUrl, id);
    return {
      id,
      name,
      description,
      url: normalizedUrl,
      category,
      ...(normalizedGroups ? { accessGroups: normalizedGroups } : {}),
      ...(widget ? { widget } : {}),
      ...(launch ? { launch } : {}),
      ...(guides ? { guides } : {}),
      ...(opdsUrl ? { opdsUrl } : {}),
    };
  });

  return { portalName: value.portalName, services };
}
