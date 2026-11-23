// Network-only navigation. Never store sessions, service URLs, API responses or household data.
const offlinePage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Home Portal offline</title>
  <style>
    :root { color-scheme: light; background: #f4efe2; color: #0b0b0b; }
    @media (prefers-color-scheme: dark) {
      :root { color-scheme: dark; background: #151514; color: #faf3df; }
    }
    body { max-width: 520px; margin: auto; padding: 32px; font: 1rem/1.6 system-ui, sans-serif; }
    h1 { line-height: 1.2; }
  </style>
</head>
<body>
  <h1>Connect to your home</h1>
  <p>Reconnect to your home Wi-Fi or Tailscale, then reopen the portal.</p>
  <p>Your private services are available when connected.</p>
</body>
</html>`;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (event.request.mode !== 'navigate' || url.origin !== scope.origin ||
      ![scope.pathname, `${scope.pathname}index.html`].includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    offlinePage,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )));
});
