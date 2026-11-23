# Home Services Portal

A configurable, self-hosted homepage for links to services on your home network. Each household supplies its own service list; this project ships with generic examples only.

> The static portal is a link dashboard, not an authorization boundary. Its optional browser editor and hidden cards do not secure services. The Authentik Compose demo protects only its own sample routes; it does not protect your household services.

## Development

Requirements: Node.js 22.x (22.22.2 or newer) and npm.

[CI](.github/workflows/ci.yml) selects Node 22, and the [portal Dockerfile](deploy/authentik/portal/Dockerfile) uses `node:22-alpine` for both build and runtime. The locked `jsdom` dependency in [package-lock.json](package-lock.json) requires at least 22.22.2 within Node 22. These CI/container selectors do not pin an exact patch version; [package.json](package.json) declares no `engines` range, so broader project support is not established.

```sh
npm install
VITE_PORTAL_PUBLIC_DEMO=true npm run dev
npm test
VITE_PORTAL_PUBLIC_DEMO=true npm run build
```

`VITE_PORTAL_PUBLIC_DEMO=true` explicitly selects the editable static demo. Without it, the app expects the authenticated `/api/session` endpoint and fails closed if that endpoint is missing or returns non-JSON content.

## Configure services

Edit `public/services.json` for the public demo. Each service needs a unique `id`, `name`, and an absolute HTTP(S) URL or a same-origin path such as `/sample`. Description, category, and `accessGroups` are optional; group-based filtering is enforced only by the Authentik-backed server, not by the static demo.

```json
{
  "portalName": "My Home Services",
  "services": [
    {
      "id": "media",
      "name": "Media Library",
      "description": "Browse the household media collection.",
      "url": "http://media.local:8096",
      "category": "Entertainment"
    }
  ]
}
```

Only add services and URLs appropriate for your own network. Do not commit credentials, private addresses, or personal service configuration to a public fork. The live demo includes a **Customize services** editor: edits are stored in that browser only. Export the JSON to preserve or transfer configuration; use Reset to return to the sample list.

## Scope

The authenticated Authentik deployment provides server-side group filtering and protected sample routes. Its blueprint also supports optional Books/Calibre, Audiobookshelf, and owner-only metrics proxy applications; these remain disabled unless their external-host settings are configured. A proxy gateway can add an Authentik access check, but it does not automatically sign a person into the upstream app. Service-specific SSO and direct-route protection must be configured and verified separately. The static Pages demo has no authentication or service authorization.

The authenticated portal also supports an optional inline `system-status` widget. Configure the Owner-only service with `widget: "system-status"`; the server independently checks the authenticated Owner group, fetches the configured source with a timeout and response-size limit, validates and filters known numeric fields, and sends no-store status data to the browser. The widget displays key metrics in the dashboard and retains a link to the JSON endpoint. Keep source URLs and private hostnames out of public service lists and environment examples. The static demo cannot authorize access and must not expose a private status source.

## Installed PWA navigation

On Android in standalone display mode, service cards, Open web/OPDS actions and Transmission full-page links request navigation in the current window instead of a new window. This retains the dashboard in the navigation history. Normal browser tabs, desktop and iOS retain separate windows; native app intents and referrer protections are unchanged. Browser-owned close controls remain platform-specific, and this does not expand the PWA's scope to other service origins. Raw-metrics and setup-documentation links are unchanged.

## Optional identity-provider test environment

A local Authentik Compose environment and protected portal demo are in [`deploy/authentik`](deploy/authentik/README.md). Authentik's web port binds to loopback; the demo service is not host-published and its sample routes enforce group access in the upstream server. A Tailscale Serve route is optional and must be configured manually after reviewing tailnet access policy. The integration is isolated to these sample routes; do not put real services behind it until interactive login, authorization, and bypass tests pass.

## Tests

`npm test` covers configuration, UI, and Authentik Compose policy wiring. `npm run test:portal-server` exercises the protected HTTP server, group-based service filtering, and direct-route authorization. GitHub Actions runs both suites, Compose security validation, type checks, and a production build.

## License

MIT — see [LICENSE](LICENSE).
