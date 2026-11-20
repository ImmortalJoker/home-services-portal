// Network-only navigation. Never store sessions, service URLs, API responses or household data.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (event.request.mode !== 'navigate' || url.origin !== scope.origin ||
      ![scope.pathname, `${scope.pathname}index.html`].includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101827"><title>Home Portal offline</title><body style="background:#101827;color:#e8edf6;font:18px/1.6 system-ui;padding:32px;max-width:520px"><h1>Connect to your home</h1><p>Reconnect to your home Wi-Fi or Tailscale, then reopen the portal.</p><p>Your private services are available when connected.</p></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )));
});
