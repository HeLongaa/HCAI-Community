# HCAI Community Server

Backend skeleton for productization phase 2.

The current implementation starts with Node's built-in HTTP server so the API contracts and module boundaries can be validated before introducing a framework. The next storage step is Prisma + PostgreSQL, with auth, permissions, and persistence layered in after the contract is stable.

## Run

```bash
cd server
npm run dev
```

Default URL: `http://127.0.0.1:8787`

For Prisma commands, set `DATABASE_URL` in your environment or a local `.env` file first.

Useful commands:

```bash
npm run db:generate
npm run db:migrate
```

## Endpoints

- `GET /health`
- `GET /api/me`
- `GET /api/openapi.json`
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `GET /api/posts`
- `GET /api/posts/:id`
- `GET /api/profiles`
- `GET /api/profiles/:handle`
- `GET /api/points/ledger`

Auth contract placeholders:

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`

Browser refresh sessions use the `hcaiRefreshToken` HttpOnly cookie plus a readable `hcaiCsrfToken` double-submit cookie. Cookie-backed refresh/logout calls must include `x-csrf-token`; set `AUTH_TRUSTED_ORIGINS`, `AUTH_COOKIE_SAMESITE=None`, `AUTH_COOKIE_SECURE=true`, and optionally `AUTH_COOKIE_DOMAIN` for split frontend/API domains.

## Module Plan

- `auth`
- `users`
- `tasks`
- `community`
- `points`
- `admin`
- `media`

See root `docs/` for API, data model, auth, and rollout details.
