# Home Services Portal

A configurable, self-hosted homepage for links to services on your home network. Each household supplies its own service list; this project ships with generic examples only.

> The portal is a link dashboard, not an authentication or authorization boundary. Hiding a card does not secure the service. Protect service endpoints separately.

## Development

Requirements: Node.js 20+ and npm.

```sh
npm install
npm run dev
npm test
npm run build
```

## Configure services

Edit `public/services.json`. Each service needs a unique `id`, `name`, and absolute `url`. Description and category are optional.

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

Only add services and URLs appropriate for your own network. Do not commit credentials, private addresses, or personal service configuration to a public fork.

## Scope

This initial version is a static, configurable portal. It does not implement accounts, per-user access control, Google sign-in, health checks, reverse proxying, VPN setup, or router configuration. Remote access and authorization integrations are future work and must protect direct service routes—not merely hide dashboard cards.

## Tests

`npm test` runs configuration validation and rendered UI tests. GitHub Actions runs tests and a production build on pushes and pull requests.

## License

MIT — see [LICENSE](LICENSE).
