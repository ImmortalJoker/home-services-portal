import { detectMobilePlatform } from '../deploy/authentik/portal/launch.mjs';

/** Keep Android standalone service navigation in the current history.
 * This selects a navigation policy, not a guarantee of browser-owned close UI.
 * Normal tabs and other platforms retain separate, isolated windows.
 */
export function serviceWebTarget(): '_self' | '_blank' {
  if (typeof navigator === 'undefined' || detectMobilePlatform(navigator) !== 'android' ||
      typeof window === 'undefined' || typeof window.matchMedia !== 'function') return '_blank';
  return window.matchMedia('(display-mode: standalone)').matches ? '_self' : '_blank';
}
