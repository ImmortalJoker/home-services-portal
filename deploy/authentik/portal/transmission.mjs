export function summarizeTorrents(torrents) {
  const fields = ['status', 'sizeWhenDone', 'leftUntilDone', 'rateDownload', 'rateUpload'];
  if (!Array.isArray(torrents) || !torrents.every(t => t && fields.every(k => Number.isFinite(t[k]) && t[k] >= 0))) throw new Error('Invalid Transmission response');
  const total = torrents.reduce((n, t) => n + t.sizeWhenDone, 0);
  const remaining = torrents.reduce((n, t) => n + Math.min(t.leftUntilDone, t.sizeWhenDone), 0);
  return { active: torrents.filter(t => t.status !== 0).length, total: torrents.length,
    percent: total ? 100 * (total - remaining) / total : null,
    download_bps: torrents.reduce((n, t) => n + t.rateDownload, 0), upload_bps: torrents.reduce((n, t) => n + t.rateUpload, 0) };
}

export async function requestTransmissionSummary() {
  const username = process.env.PORTAL_TRANSMISSION_RPC_USERNAME;
  const password = process.env.PORTAL_TRANSMISSION_RPC_PASSWORD;
  if (!username || !password) throw new Error('Transmission summary unavailable');
  const url = 'http://host.docker.internal:9091/transmission/rpc';
  const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`, Host: 'localhost:9091' };
  const body = JSON.stringify({ method: 'torrent-get', arguments: { fields: ['status', 'sizeWhenDone', 'leftUntilDone', 'rateDownload', 'rateUpload'] } });
  const send = () => fetch(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(5000) });
  let response = await send();
  if (response.status === 409) {
    const session = response.headers.get('X-Transmission-Session-Id');
    await response.body?.cancel();
    if (!session) throw new Error('Transmission handshake unavailable');
    headers['X-Transmission-Session-Id'] = session;
    response = await send();
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error('Transmission unavailable'); }
  const payload = await response.json();
  if (payload.result !== 'success') throw new Error('Transmission unavailable');
  return summarizeTorrents(payload.arguments?.torrents);
}
