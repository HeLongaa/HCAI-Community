# V1 Video Production UI

V1-28 replaces the local Video Studio simulation with an application-API workflow. The implementation sources are
`src/features/workspace/VideoStudioPage.tsx` and `src/hooks/useVideoGenerationWorkflow.ts`.

## Product Workflow

- Provider and mode availability come from `GET /api/creative/providers`.
- Text, image, and music-video controls render only capability-declared parameters.
- Image-to-video sends one governed image. Music video sends audio first and an optional reference image second.
- Creation, owner history, detail polling, cancellation, and exact retry use `/api/creative/generations` routes.
- Polling pauses while the page is hidden or offline and backs off to ten seconds.
- Exact retry is available only while the original request remains in browser memory; raw prompts are not restored.
- Clean MP4 output is previewed and downloaded through the private application media contract.
- Pending scan, policy review, failed, cancelled, and unavailable states remain explicit and non-playable.

## Runtime Labels

- The deterministic application provider is visibly labeled `Mock`.
- Google Veo is visibly labeled `Fixture only` and cannot be selected for product generation.
- Runway is visibly labeled `Unavailable`.
- Provider catalog failure disables generation instead of falling back silently.

## Security Boundary

The browser calls application APIs and approved storage download URLs only. It does not receive Provider credentials,
call Provider generation/status/mutation endpoints, retain raw Provider payloads, or bypass media scan gates. V1-28 does
not enable any Video Provider HTTP client, lifecycle worker, real traffic, production switch, or automatic failover.

## Verification

- `npx playwright test e2e/video-capability.spec.ts`
- `npm run test:v1-surfaces`
- `npm run lint`
- `npm run build`
- `CI=1 npm run check:pr`

## V1-29 Closeout

V1-29 defines and executes the fixture-only staging acceptance matrix for request mapping, long-job lifecycle, ordered
inputs, accounting, scan/review release, user-visible failure handling, operational evidence, and rollback. The source
of truth is `config/v1-video-staging-gate.json`; run it with `npm run test:v1-video-staging`. Real Veo HTTP, credentials,
paid traffic, and production enablement still require separate explicit approval.
