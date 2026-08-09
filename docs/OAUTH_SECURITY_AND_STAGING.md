# OAuth Security And Staging

## Current Decision

AUTH-01 permits real Google and GitHub OAuth for personal accounts. Google, GitHub, and Discord use authorization-code exchange with S256 PKCE; Apple keeps its nonce-bound, JWKS-verified `id_token` flow. Provider endpoints are hardcoded and cannot be changed through Admin configuration.

## Runtime Boundary

- Admins may set only the client id, exact redirect URI, scopes, `secret://` reference, and enabled state.
- Raw client secrets, Apple private keys, access tokens, authorization codes, and Provider responses are never stored in PostgreSQL or returned by Admin APIs.
- `OAUTH_GOOGLE_CLIENT_SECRET` and `OAUTH_GITHUB_CLIENT_SECRET` are resolved only from the deployment environment. Admin stores an allowlisted `secret://env/...` reference; runtime resolves that reference without copying secret material into PostgreSQL or an API response.
- Missing configuration, missing mounted secrets, unsafe redirects, network errors, timeouts, non-2xx responses, malformed JSON, and unverified email evidence fail closed.
- Local and test environments may use signed dev callbacks unless `OAUTH_DEV_MODE=disabled`. Production never falls back to dev mode.
- `NODE_ENV=production` and `DEPLOYMENT_ENV=production` are both production signals. A deployment with `DEPLOYMENT_ENV=production` and a non-production `NODE_ENV` fails configuration validation instead of enabling Seed repositories, development OAuth, insecure cookies, or default local origins.
- Redirect URIs must use HTTPS in production, contain no query or fragment, exactly target `/api/auth/oauth/{provider}/callback`, and use the canonical `OAUTH_CALLBACK_ORIGIN`.
- `OAUTH_BROWSER_RETURN_ORIGIN` is the canonical frontend origin. It must be an exact HTTPS origin and must appear in `AUTH_TRUSTED_ORIGINS` or `CORS_ALLOWED_ORIGINS`.
- When the API and frontend use different origins, the callback bridge redirects directly to the frontend hash route. It does not write access tokens or OAuth state to API-origin local storage.

## Google Registration

1. In Google Auth Platform, create or select a project. Configure **Branding**, **Audience**, and **Data Access**. Use **External** audience for personal Google accounts; while the app is in testing, add the staging accounts as test users.
2. Create an OAuth client with application type **Web application**.
3. Add the exact backend callback, for example `https://api.example.com/api/auth/oauth/google/callback`, to **Authorized redirect URIs**. Scheme, host, path, case, and trailing slash must match exactly.
4. Add the frontend origin to **Authorized JavaScript origins** only if browser-side Google APIs are used. This server-side authorization-code flow does not require it.
5. Mount the generated secret as `OAUTH_GOOGLE_CLIENT_SECRET` in the API deployment. Do not commit the downloaded credential JSON.
6. In Admin OAuth operations, save the client id, the same redirect URI, scopes `openid email profile`, and `secret://env/OAUTH_GOOGLE_CLIENT_SECRET`.
7. Confirm **Secret mounted** and **Available**, then enable Google.

The implementation uses Google's authorization endpoint, `https://oauth2.googleapis.com/token`, and `https://openidconnect.googleapis.com/v1/userinfo`. It accepts only a profile with `email_verified: true`; Admin cannot remove the required `openid` or `email` scopes. Official references: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) and [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## GitHub Registration

1. In GitHub, open **Settings > Developer settings > OAuth Apps** and create a new OAuth App.
2. Set the application homepage to the public frontend origin.
3. Set **Authorization callback URL** to the exact backend callback, for example `https://api.example.com/api/auth/oauth/github/callback`.
4. Generate a client secret and mount it as `OAUTH_GITHUB_CLIENT_SECRET` in the API deployment.
5. In Admin OAuth operations, save the client id, the same callback URI, scopes `read:user user:email`, and `secret://env/OAUTH_GITHUB_CLIENT_SECRET`.
6. Confirm **Secret mounted** and **Available**, then enable GitHub.

The implementation sends `state` and S256 PKCE, exchanges the code at `https://github.com/login/oauth/access_token`, revalidates identity with `GET https://api.github.com/user`, and reads `GET https://api.github.com/user/emails` for a verified email. Admin cannot remove `read:user` or `user:email`; GitHub requires `user:email` for private email lookup. Official references: [Create a GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), [Authorizing GitHub OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), and [GitHub email endpoints](https://docs.github.com/en/rest/users/emails).

GitHub OAuth Apps support one callback URL. Use separate OAuth Apps and credentials for local, staging, and production rather than changing a production callback during testing. Google Web application clients may register multiple exact redirect URIs, but dedicated environment credentials are still recommended for isolation.

## Deployment Preflight

Run the preflight in the API deployment environment after mounting credentials and saving the matching Admin configuration:

```bash
npm run oauth:preflight -- \
  --api-origin=https://api.example.com \
  --callback-origin=https://api.example.com \
  --browser-origin=https://app.example.com
```

The command never prints secret values. Without `--api-origin`, it checks environment-provided client ids, secrets, and redirect URIs. With `--api-origin`, client ids and redirect URIs may instead come from the Admin control plane; the command still requires each deployment secret, then verifies that public Provider status reports Google and GitHub as `external` and available. Each effective callback must equal the canonical callback origin and each browser return origin must equal the trusted frontend origin. This covers Admin enablement and prevents a valid-looking but wrong-host callback or an API-host browser return from passing deployment preflight.

For local registration, use dedicated development clients and run:

```bash
npm run oauth:preflight -- \
  --allow-local \
  --api-origin=http://127.0.0.1:8787 \
  --callback-origin=http://127.0.0.1:8787 \
  --browser-origin=http://127.0.0.1:5174
```

Register these exact local callbacks:

- Google: `http://127.0.0.1:8787/api/auth/oauth/google/callback`
- GitHub: `http://127.0.0.1:8787/api/auth/oauth/github/callback`

Passing preflight does not prove that the third-party console contains the callback. The final acceptance must complete one real login for each Provider because Google and GitHub disclose callback-registration mistakes only during the live authorization flow.

## Authorization Request Security

- OAuth state is signed, expires after ten minutes, and contains only Provider protocol metadata plus a random nonce. App redirect and optional linking user id remain server-side; only a SHA-256 state hash is persisted.
- Each state hash is consumed atomically once before code exchange. Cancellation, verification failure, configuration changes, and success all prevent replay.
- Every authorization request pins the current Admin control version. Disabling a Provider or changing its configuration/status invalidates in-flight callbacks.
- PKCE verifiers are derived from server key material and the signed nonce; they are never persisted or returned.
- Google requests one-time identity scopes only and does not request offline access.

## Staging Acceptance

The automated engineering gate is:

```bash
npm run test:oauth-staging
```

For each Provider, an authorized operator must run preflight and the interactive rehearsal from the same clean release checkout:

```bash
OAUTH_STAGING_PROVIDER=google \
OAUTH_STAGING_API_ORIGIN=https://api-staging.example.com \
OAUTH_STAGING_BROWSER_ORIGIN=https://app-staging.example.com \
OAUTH_STAGING_ENVIRONMENT=staging \
OAUTH_STAGING_CONFIRMATION=real-staging-oauth-acceptance \
RELEASE_ARTIFACT_SHA256=<64-hex-release-artifact-sha256> \
npm run oauth-staging:preflight

# Run only after preflight passes. Repeat with OAUTH_STAGING_PROVIDER=github.
npm run oauth-staging:rehearse
```

The selected deployment must also expose its matching `OAUTH_GOOGLE_CLIENT_SECRET` or `OAUTH_GITHUB_CLIENT_SECRET`. The rehearsal opens a temporary Chromium profile and permits manual MFA with a dedicated Provider test account; it does not store Provider passwords, recovery codes, cookies, authorization codes, raw state, access tokens, refresh tokens, account identifiers, or Provider payloads. `OAUTH_STAGING_LOGIN_TIMEOUT_SECONDS` may be set from 30 to 900 seconds, `OAUTH_STAGING_HEADLESS` defaults to `false`, and evidence defaults to `.artifacts/oauth-staging` with mode `0600`.

Successful evidence proves only one fresh external login for the selected Provider, credentialed CORS and return to the configured product origin, Secure/HttpOnly/SameSite=None refresh-cookie controls, a Secure browser-readable CSRF cookie, CSRF rotation during cookie refresh, authenticated `/api/me`, observation of the selected linked Provider, and logout with both authentication cookies cleared. The evidence contains only source/artifact hashes, API/browser/Provider-host hashes, timestamps, booleans, and a SHA-256 receipt. Validate it independently:

```bash
node scripts/verify-oauth-staging-evidence.mjs .artifacts/oauth-staging/<run-id>.json
```

This rehearsal does not prove account linking from an existing signed-in session, account conflict handling, unlink behavior, Provider cancellation, invalid-state rejection, changed-configuration rejection, disabled-Provider behavior, or production approval. Those scenarios require separate controlled acceptance. The evidence always records these limitations as false, and a staging result can never set `productionApproved=true`.

Use dedicated Provider test accounts for every live scenario. Evidence may include timestamps, status codes, stable error codes, and hashes, but never secrets, authorization codes, tokens, raw state, URLs, identity fields, or Provider payloads. Rotate or revoke credentials after accidental disclosure and disable the Provider from Admin during containment.

External console registration cannot be completed from source control alone. Before declaring production ready, an owner with access to Google Cloud Console and GitHub Developer settings must create the clients, register the exact callbacks, mount both secrets, and execute this staging acceptance sequence.
