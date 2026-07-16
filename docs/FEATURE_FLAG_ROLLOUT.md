# Feature Flag Rollout

SET-02 extends the governed Feature Flag definitions delivered by CONFIG-02. It does not add tenant scope or make real Provider calls.

## Definition

A published flag contains a default `enabled` value, a default `payload`, up to 100 targeting rules, an optional integer percentage from 0 through 100, and a rollout seed. Each rule has a unique id, one type, 1 through 100 values, an enabled result, and an optional payload override.

Rule evaluation has one fixed order:

1. emergency off
2. first matching user rule
3. first matching role rule
4. first matching environment rule
5. deterministic percentage rollout
6. default value

The percentage bucket is derived from SHA-256 over the rollout seed, flag key, and authenticated user id. Identical inputs therefore keep the same result. Zero and 100 percent are exact boundaries.

## Trust Boundary

`GET /api/feature-flags/:key/evaluate` requires authentication. The service supplies the deployment environment and derives user id and role from the authenticated actor; runtime callers cannot submit targeting attributes. The response contains only the effective result, reason category, matched rule id, payload, and published version.

Administrative preview accepts an explicit synthetic context and requires the read permission. Draft edits and publication retain their existing manage and publish permissions. Immediate shutdown and restore require the separate protected `admin:feature-flags:emergency` permission and use optimistic concurrency.

## Emergency Override

Emergency off is operational state on the published projection, not mutable revision content. Publishing or rolling back a definition does not clear it. Both disable and restore increment the shared resource version, reject stale operations, and write mutation-attempt plus domain audit evidence.

## Verification

```bash
npm run test:feature-flag-rollout
npm run test:config-resource-domains:integration
```

The PostgreSQL integration suite covers projection persistence, emergency override concurrency, publish preservation, and restoration. The normal PR gate covers the admin workflow and authenticated runtime evaluation.
