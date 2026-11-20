// Fixed client presets: configuration can select a tested client, never an arbitrary URI.
const clients = Object.freeze({
  immich: { service: 'immich', ios: 'immich://', scheme: 'immich', package: 'app.alextran.immich', label: 'Immich' },
  audiobookshelf: { service: 'audiobookshelf', scheme: 'audiobookshelf', package: 'com.audiobookshelf.app', label: 'Audiobookshelf' },
  audiobooth: { service: 'audiobookshelf', ios: 'audiobooth://', label: 'AudioBooth' },
  'jellyfin-mobile': { service: 'jellyfin', ios: 'org.jellyfin.expo://', label: 'Jellyfin Mobile' },
});

export function validateLaunch(value, serviceId, webUrl) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
    throw new Error(`Service ${serviceId} launch must select a supported mobile client.`);
  }
  const web = new URL(webUrl);
  if (web.protocol !== 'https:' || web.username || web.password) {
    throw new Error(`Service ${serviceId} launch requires a credential-free HTTPS web fallback.`);
  }
  const result = {};
  for (const [platform, client] of Object.entries(value)) {
    const preset = typeof client === 'string' && Object.hasOwn(clients, client) ? clients[client] : null;
    if (!['android', 'ios'].includes(platform) || !preset || preset.service !== serviceId ||
        (platform === 'ios' ? !preset.ios : !preset.package)) {
      throw new Error(`Service ${serviceId} has an unsupported launch client or platform.`);
    }
    result[platform] = client;
  }
  return result;
}

export function detectMobilePlatform(device) {
  if (!device) return null;
  if (/Android/i.test(device.userAgent ?? '')) return 'android';
  if (/iPhone|iPad|iPod/i.test(device.userAgent ?? '') ||
      (device.platform === 'MacIntel' && device.maxTouchPoints > 1)) return 'ios';
  return null;
}

// `service` has already passed validateLaunch (via validateConfig / validatePortalConfig).
// The href is built only from the fixed preset table, so a lookup is enough here.
export function getAppLaunch(service, platform) {
  const client = platform && service.launch ? service.launch[platform] : undefined;
  const preset = typeof client === 'string' && Object.hasOwn(clients, client) ? clients[client] : null;
  if (!preset || preset.service !== service.id) return null;
  if (platform === 'ios') return preset.ios ? { href: preset.ios, label: preset.label } : null;
  if (!preset.package) return null;
  return {
    href: `intent://#Intent;scheme=${preset.scheme};package=${preset.package};S.browser_fallback_url=${encodeURIComponent(service.url)};end`,
    label: preset.label,
  };
}
