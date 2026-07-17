# AI-STATS-01 Generation Business Metrics

AI-STATS-01 adds a bounded Admin reporting surface over the existing personal-account generation facts. It does not create a parallel analytics store. Seed and Prisma implementations aggregate `CreativeGeneration`, `CreativeProviderCostLedger`, `MediaAssetRelation`, `LibraryItem`, `ProfilePortfolioAsset`, and `TaskSubmissionAsset` through one shared pure projection.

## Metrics And Window

The default reporting window is 30 days and the maximum accepted window is 366 days. Existing Admin generation filters apply to quality, terminal success/failure, review rates, average/P50/P95/maximum latency, internal Credit and quota units, Provider cost ledgers by currency, and unique output-asset conversion into cross-workspace reuse, the private library, portfolio, or task delivery.

Internal compensation is derived from the existing generation Credit closeout field. It represents release or compensation of application-owned units only. It is not a payment, subscription, invoice, withdrawal, bank, KYC, or real-money refund feature.

## Safety And Availability

The response contains low-cardinality aggregates and workspace rows. It does not expose users, generation IDs, Provider job IDs, raw prompts, errors, private URLs, storage keys, or relation records. When the selected window has no durable Provider cost ledger, `providerCost.availability` is `unavailable` with reason `no_provider_cost_ledgers`; the UI renders that state rather than inventing spend.

Read and export require `admin:audit:read` and `admin:audit:export` respectively. Both operations write bounded audit evidence. CSV export contains workspace aggregates only; JSON export contains the same safe snapshot as the API.

## External Boundary

No real Provider call, credential, callback, paid traffic, or production promotion is enabled. Provider staging remains fail-closed until the separately recorded authorization, credential, budget, owner, expiry, callback, and legal gates are satisfied.

## Verification

Run `npm run test:ai-generation-business-metrics`, fresh PostgreSQL migrations plus `npm run test:ai-generation-business-metrics:integration`, focused Admin Playwright coverage, and the exact `CI=1 npm run check:pr` gate. Delivery requires a Ready PR, remote Quality Gate, squash merge, branch cleanup, and Notion evidence writeback.
