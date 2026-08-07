# Production Static Delivery

The production frontend is a Vite artifact served by the repository-owned static delivery runtime. The runtime serves only `dist`; it does not expose source files, proxy arbitrary targets, or replace the API service. A production ingress must route `/api/*`, `/health`, and other API-owned paths to the backend while routing frontend paths to the static service.

## Build And Run

```bash
npm run build:release
STATIC_HOST=0.0.0.0 STATIC_PORT=4173 npm run serve:production
```

`build:release` performs four fail-closed stages:

1. TypeScript and Vite production build.
2. Brotli and Gzip sidecar generation for compressible files when savings are at least 5%.
3. JavaScript, CSS, point-cloud, and static-image resource budgets.
4. An HTTP delivery rehearsal against a random local port.

The machine-readable policy is `config/production-static-delivery-contract.json`. Run `npm run check:production-delivery` to repeat only the HTTP contract after a release build.

## Cache Policy

- `index.html` and SPA fallbacks use `Cache-Control: no-cache`, so clients revalidate the application shell on every navigation.
- Vite content-hashed files under `/assets/` use `Cache-Control: public, max-age=31536000, immutable`.
- Health and error responses are not long-lived cached artifacts.
- Point clouds and the static particle image are part of Vite's asset graph, so content changes produce new URLs before immutable caching is allowed.

Do not move production media back to fixed names under `public/` while retaining immutable caching. Fixed URLs can serve stale model bytes across deployments.

## Encoding And Range

The build writes `.br` and `.gz` sidecars without modifying source artifacts. The server negotiates Brotli first, then Gzip, and sends `Vary: Accept-Encoding`. MIME is derived from the original file, not the sidecar extension.

Range requests always read the identity artifact and return `206`, `Content-Range`, and the exact requested byte count. They never return a slice of a compressed sidecar. Invalid or multi-range requests fail with `416`.

## Security Boundary

Every response includes `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin`. Encoded path traversal is rejected before filesystem resolution. Missing `/assets/*` files return `404` and never fall through to `index.html`; extensionless frontend routes use the SPA fallback. `/api`, `/health`, and `/metrics` are explicitly excluded from SPA fallback and return an uncached JSON `404` when they accidentally reach the static process, so a missing ingress route cannot masquerade as a successful frontend response.

Content Security Policy is intentionally owned by the production ingress until OAuth origins, API origin, font delivery, media sources, and Provider callback topology are frozen. Adding an incomplete CSP in the static process could silently break authentication or governed media preview.

## Deployment Acceptance

The local delivery rehearsal proves artifact behavior, not the external CDN or ingress. Protected staging must additionally verify:

- HTTPS and HSTS at the edge.
- `/api/*` routes reach the expected release artifact of the API service.
- CDN preserves `Cache-Control`, `Content-Type`, `Content-Encoding`, `Vary`, ETag, and byte ranges.
- A candidate deployment and rollback both pass frontend deep-link and API smoke checks.
- Cross-region cache hit rate and origin egress are observed without logging credentials or private media URLs.
