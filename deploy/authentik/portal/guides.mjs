const keys = new Set(['title', 'downloadUrl', 'connectionUrl', 'connectionLabel', 'steps']);
function text(value, limit) { return typeof value === 'string' && value.trim().length > 0 && value.length <= limit; }
function https(value) {
  if (typeof value !== 'string') throw new Error('Guide addresses must use HTTPS.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Guide addresses must use credential-free HTTPS.');
  return url.href;
}
export function validateGuides(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw new Error('Guides must specify a platform.');
  const result = {};
  for (const [platform, guide] of Object.entries(value)) {
    if (!['ios', 'android'].includes(platform) || !guide || typeof guide !== 'object' || Array.isArray(guide) ||
        Object.keys(guide).some(k => !keys.has(k)) || !text(guide.title, 100) ||
        !Array.isArray(guide.steps) || !guide.steps.length || guide.steps.length > 8 || !guide.steps.every(step => text(step, 600)) ||
        guide.connectionLabel !== undefined && !text(guide.connectionLabel, 80)) throw new Error('Invalid service guide.');
    result[platform] = { title: guide.title.trim(), steps: guide.steps.map(step => step.trim()),
      ...(guide.downloadUrl !== undefined ? { downloadUrl: https(guide.downloadUrl) } : {}),
      ...(guide.connectionUrl !== undefined ? { connectionUrl: https(guide.connectionUrl) } : {}),
      ...(guide.connectionLabel !== undefined ? { connectionLabel: guide.connectionLabel.trim() } : {}),
    };
  }
  return result;
}
