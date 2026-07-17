# AI-CORE-02 Cross-Module Generation Reuse

AI-CORE-02 closes the personal-account workflow across the unified generation center, governed asset lineage, private library, profile portfolio, and task delivery. It reuses the normalized `CreativeGeneration`, `MediaAsset`, `MediaAssetRelation`, `LibraryItem`, `ProfilePortfolioAsset`, and `TaskSubmissionAsset` facts instead of creating a second generation or file store.

## Unified History

The generation center reads Image, Chat, Video, and Music through one owner-scoped projection. It supports workspace, status, and date filters; created, updated, and status sorting in either direction; stable cursor pagination; safe personal statistics; and bounded JSON or CSV export. Export writes `creative.generation_center.exported` audit evidence and never includes Provider identifiers, raw prompts, private URLs, storage keys, or moderation internals. Chat summaries remain protected.

Each governed output includes application-id-only lineage and server-derived reuse eligibility. Users can move from a generation output to the asset system of record, save it idempotently to the private library, create a portfolio draft, send eligible assets to Image, Video, or Chat, or attach it to an assigned task with a rights note.

## Delivery And Recovery

Task delivery freezes an allowlisted evidence snapshot while the current media record continues through governance. Portfolio publication is an explicit owner transition. Archiving or deleting an asset withdraws public portfolio visibility but retains lineage and task evidence; restore and recovery never republish automatically. Generation cancellation, retries, execution recovery, duplicate requests, concurrent claims, timeouts, and review states remain owned by AI-CORE-01 and the existing Admin generation operations.

The paired Admin surface provides filtered generation and media queries, summaries, exports, bulk preview/execution, execution recovery, audit evidence, and Provider control visibility. User routes stay owner scoped; Admin routes retain their dedicated permissions.

## External Boundary

This task makes no real Provider call and configures no credential, callback target, paid traffic, or production promotion. The repository remains fail-closed until the separate Provider approval, legal evidence, staging environment, call and budget caps, owners, expiry, and callback registration gates are complete.

## Verification

Run `npm run test:ai-core-cross-module`, the focused Playwright generation-center test, fresh PostgreSQL integration/migration verification, and the exact full `CI=1 npm run check:pr` gate before delivery. The Ready PR must pass the remote Quality Gate and be squash-merged before Notion closeout.
