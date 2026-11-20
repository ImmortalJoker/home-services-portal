export type MobilePlatform = 'android' | 'ios';
export type LaunchClient = 'immich' | 'audiobookshelf' | 'audiobooth' | 'jellyfin-mobile';
export type ServiceLaunch = Partial<Record<MobilePlatform, LaunchClient>>;
export function validateLaunch(value: unknown, serviceId: string, webUrl: string): ServiceLaunch | undefined;
export function detectMobilePlatform(device?: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>): MobilePlatform | null;
export function getAppLaunch(service: { id: string; url: string; launch?: ServiceLaunch }, platform: MobilePlatform | null): { href: string; label: string } | null;
