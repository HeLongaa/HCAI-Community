# V1 Provider Decision Matrix

This is the human-readable decision record for V1-04. The machine-readable source of truth is
`config/v1-provider-matrix.json`, and `npm run test:v1-providers` prevents the provider, budget, legal, and runtime
guardrails from drifting silently.

Official provider pages were reviewed on **2026-07-11**. Prices are public list prices in USD and exclude taxes,
negotiated discounts, storage, egress, residency uplifts, support, and other contract-specific charges unless stated.

## Decision Status

The decision is **conditionally approved for implementation planning only**.

- No provider is production-approved.
- No real provider call, SDK, default HTTP client, callback route, enabled polling worker, or production credential is
  approved by this document.
- Ordinary continuation language is not approval for an external provider call.
- Production must fail closed. Silent fallback to mock/demo output is forbidden.
- Primary and backup providers require independent legal, credential, budget, staging, and real-call approvals.
- Provider spend is separate from product creative credits, points, quota, escrow, and refunds.

## Selected Providers

| Modality | Primary | Backup | Decision |
| --- | --- | --- | --- |
| Image | OpenAI GPT Image 2 (`openai-gpt-image-2`) | Replicate FLUX 1.1 Pro (`replicate-flux-1-1-pro`) | OpenAI has the clearer rights/data path and broader generation/editing surface. Replicate preserves the existing asynchronous staging-shell investment as a separately approved backup. |
| Chat | OpenAI GPT-5.6 Terra (`openai-gpt-5-6-terra`) | Anthropic Claude Sonnet 5 (`anthropic-claude-sonnet-5`) | Terra is the cost/quality baseline for Responses streaming. Sonnet 5 is the independent prompt/tool/schema fallback. |
| Video | Google Veo 3.1 Fast (`google-veo-3-1-fast`) | Runway Gen-4.5 (`runway-gen-4-5`) | Veo is GA, supports C2PA, and has a documented US region. Runway is blocked until enterprise no-training and retention terms exist. |
| Music | ElevenLabs Music v2 Enterprise (`elevenlabs-music-v2-enterprise`) | Google Lyria 3 Pro Preview (`google-lyria-3-pro-preview`) | Eleven Music has the required full-song API, but only an Enterprise Music contract can grant the platform rights V1 needs. Lyria is a Preview-only backup with no SLA or indemnity. |

## Budget Envelope

The envelope is a launch guardrail, not a spending approval. Provider-side auto-reload remains disabled.

| Modality | App concurrency | Unit assumption | Jobs/day | Per-job cap | Daily cap | Monthly cap |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Image | 4 | GPT Image 2, medium 1024x1024, about $0.053/output plus input | 100 | $0.25 | $8 | $200 |
| Chat | 8 | 2K input + 1K output Terra turn, about $0.020 | 1,000 | $0.10 | $25 | $600 |
| Video | 2 | Veo 3.1 Fast, 8 seconds, about $0.80 | 20 | $1.20 | $20 | $500 |
| Music | 2 | Eleven Music, 3 minutes, about $0.45 | 20 | $0.60 | $10 | $250 |
| **Total** |  |  |  |  | **$63** | **$1,550** |

When a per-job, daily, monthly, provider-credit, or account-tier limit is reached, new jobs are rejected and an
operations alert is planned. Budget exhaustion does not silently route traffic to the backup.

## Image Decision

### Primary: OpenAI GPT Image 2

- API: synchronous `/v1/images/generations` and `/v1/images/edits`; the application copies base64 output directly to
  governed storage.
- Capability: text-to-image, image editing, high-fidelity image inputs, flexible size and quality controls.
- Price baseline: medium 1024x1024 output is approximately $0.053 before input tokens. High quality is materially more
  expensive and remains inside the $0.25 job cap.
- Limits: the published Tier 1 limit is 100,000 TPM and 5 images per minute; the app starts at four concurrent jobs.
- Rights: the OpenAI Services Agreement assigns Output rights to the customer as between the parties. API content is
  not used for model training unless the customer opts in.
- Data: default abuse-monitoring retention is up to 30 days; image endpoints hold no application state and GPT Image
  models can be ZDR eligible after approval. `gpt-image-2` was not present in the reviewed model-specific residency row,
  so residency must be confirmed in writing.
- Region: OpenAI access is limited to supported countries and territories. Mainland China was not listed; V1 must not
  attempt to bypass provider geography controls.
- SLA: no pay-as-you-go image-model uptime commitment was established. Contracted support/SLA or explicit acceptance
  of best-effort operation is required.

### Backup: Replicate FLUX 1.1 Pro

- API: asynchronous Predictions lifecycle with polling/webhooks and terminal success, failure, or cancellation states.
- Price baseline: $0.04 per public-model output image.
- Data: API prediction inputs, outputs, files, values, and logs are deleted after one hour by default; web predictions
  are retained indefinitely.
- Rights: Replicate assigns its Output interest to the customer, but every model carries third-party terms. FLUX terms
  and required end-user flow-down must be approved before use.
- Limits: 600 prediction creations/minute and 3,000 requests/minute for other endpoints; model throughput can queue.
- SLA: public terms disclaim uninterrupted service; enterprise pricing advertises optional performance SLAs.
- Existing code: the current Replicate adapter remains fixture-only with `networkCallsEnabled=false`. This decision does
  not convert it into a real client.

## Chat Decision

### Primary: OpenAI GPT-5.6 Terra

- API: Responses API with streaming, `store=false`, no background mode, and app-owned durable conversation state.
- Price baseline: short-context rates are $2.50/M input, $0.25/M cached input, $3.125/M cache writes, and $15/M output.
- Limits: published Tier 1 is 500 RPM and 500,000 TPM; the app starts at eight concurrent streams.
- Data: up to 30-day abuse-monitoring retention by default. Responses supports approved ZDR; regional processing for
  Terra is documented for the US and Europe.
- Safety: stable privacy-preserving safety identifiers, input/output moderation, tool allowlists, and human escalation
  remain application requirements.
- SLA: no default pay-as-you-go model SLA was established. Scale/Priority or enterprise terms must be recorded if an
  uptime commitment is required.

### Backup: Anthropic Claude Sonnet 5

- API: Messages API streaming, with app-owned state and no provider callback/polling lifecycle.
- Price baseline: the durable planning rate is $3/M input and $15/M output. The temporary $2/$10 introductory price
  ending 2026-08-31 is deliberately excluded from the budget.
- Limits: Start tier publishes 1,000 RPM, 2,000,000 input TPM, and 400,000 output TPM.
- Rights: commercial terms give the customer Input rights and Output ownership and prohibit training on commercial
  Customer Content by default.
- Data: standard API content is deleted within 30 days. Flagged content, safety scores, and feedback have longer stated
  exceptions. Data is stored in the US by default even when inference traffic is routed elsewhere.
- SLA: public commercial terms provide the service as-is; a custom/Priority agreement or accepted best-effort posture is
  required.

Chat failover is a product migration, not a blind retry. Prompt behavior, tool schemas, structured output, safety,
conversation history, and error mapping must pass parity tests before backup activation.

## Video Decision

### Primary: Google Veo 3.1 Fast

- Model: `veo-3.1-fast-generate-001`, selected for the $0.10/second 720p price and faster turnaround.
- Lifecycle: provider operation polling must use the existing durable lease, bounded retry, and stop-condition design.
  Current cancellation behavior must be verified during the adapter task.
- Capability: text/image input, generated video with audio, and C2PA Content Credentials. C2PA metadata must be
  preserved through application storage and delivery.
- Region and limits: the reviewed GA model card documents `us-central1` and 50 regional online prediction requests per
  minute. The app starts at two concurrent jobs.
- Rights/data: Generated Output is Customer Data and Google does not assert ownership in new Output IP. Google does not
  train on Customer Data without permission. Abuse logging and 24-hour in-memory caching rules still require explicit
  configuration and review.
- SLA: the reviewed Vertex AI SLA did not clearly identify the publisher generative-video model as a covered service.
  Model-specific coverage, support, and Provisioned Throughput must be decided in writing.

### Backup: Runway Gen-4.5

- API: asynchronous task creation and `GET /v1/tasks/:id` polling. Output URLs expire in 24-48 hours; ephemeral uploads
  expire after 24 hours.
- Price baseline: 12 credits/second and $0.01/credit, or $0.12/second.
- Limits: Tier 1 allows one concurrent task, 50 generations/day, and $100/month. Excess work can enter `THROTTLED`.
- Blocking legal issue: public terms permit Runway to use Inputs and Outputs for training under a broad perpetual
  license. Backup enablement requires enterprise no-training, retention/deletion, DPA, region, SLA, and support terms.
- Attribution: the API terms require applicable customer UI to display Powered by Runway and require protective end-user
  terms. Product/legal must accept both.

OpenAI Sora 2 is not a backup candidate. OpenAI has announced removal of the Videos API and Sora 2 models on
2026-09-24 without a recommended replacement.

## Music Decision

### Primary: ElevenLabs Music v2 Enterprise

- API: `music_v2` compose or streaming response wrapped by an internal asynchronous application job. The app caps
  tracks at three minutes and persists the returned audio immediately.
- Price baseline: $0.15/minute, or about $0.45 for a three-minute track. Enterprise contract pricing may differ.
- Capability: complete music with vocals or instrumentals, multilingual output, composition plans, section control,
  streaming, and copyrighted-material prompt rejection.
- Rights blocker: self-serve Music plans prohibit reseller rights and music libraries/repositories. Broad media rights,
  10+ concurrency, and platform distribution require **Enterprise Music**, not merely a paid API subscription.
- Training/data: public terms allow content use for model improvement until the account opts out. Standard storage is in
  the US. EU, India, and Singapore isolated environments plus optional ZRM are enterprise features, and Music support
  under the selected ZRM region must be confirmed.
- SLA: Music is as-is under public terms. The Enterprise Music order must define SLA, support, deletion, region, price,
  concurrency, streaming, reseller, media, and repository rights.

### Backup: Google Lyria 3 Pro Preview

- Model/API: `lyria-3-pro-preview` through the Agent Platform Interactions API; the reviewed response includes status,
  lyrics/description, and inline generated audio.
- Price baseline: $0.08 per complete song up to three minutes on the reviewed public pricing page.
- Rights: Preview documentation explicitly permits production/commercial use and third-party Output disclosure.
- Blocking risk: Google Pre-GA terms exclude SLA and indemnity, permit change/discontinuation, and may not provide the
  same data-location commitments as GA services. Region, quota, retention, ZDR, cancellation, and nonterminal status
  behavior require written confirmation.

## Failover And Kill Switches

Each modality must have independent primary and backup configuration, credentials, spend counters, circuit state, and
kill switches. The required behavior is:

1. Stop new dispatch when a provider, per-job, daily, monthly, or global budget guard fails.
2. Finish or safely cancel already-dispatched jobs according to the documented lifecycle.
3. Never return demo/mock output as a successful production generation.
4. Open the circuit only on allowlisted retryable errors, repeated terminal failures, or an operator-declared incident.
5. Do not activate the backup until its independent approvals and staging evidence are complete.
6. Preserve reservation, settlement, refund, audit, notification, media scan, and idempotency semantics across failover.
7. Expose the active provider/model, sanitized cost, circuit state, and fallback reason to operations without leaking
   credentials or raw user content.

## Production Blockers

1. Complete provider agreements, DPAs, supported-country and cross-border review.
2. Obtain ElevenLabs Enterprise Music platform/reseller/media rights.
3. Obtain Runway enterprise no-training and retention/deletion terms before backup use.
4. Confirm Google Veo SLA/indemnity coverage and Lyria Preview region/quota/retention behavior.
5. Confirm OpenAI production geography, `gpt-image-2` residency, and selected ZDR/MAM controls.
6. Accept Anthropic US storage or contract a compliant alternative deployment.
7. Recheck price, model availability, quota, legal terms, and regions within 30 days of production launch.
8. Complete the exact provider/environment/call-count/budget/expiry/token-owner/kill-switch approval record before every
   first staging external call.

## Implementation Order

1. Contract/legal and account decisions for the selected providers.
2. Provider-neutral contracts for streaming chat, synchronous image, and asynchronous video/music jobs.
3. Fixture adapters and conformance suites for every primary and backup.
4. Budget, circuit breaker, cancellation, polling, callback authentication, artifact capture, and media governance.
5. Exact staging external-call approval per provider, followed by bounded evidence runs.
6. Prompt/quality/safety/load/failover evaluation and operations rehearsal.
7. Production go/no-go. Production remains disabled until this separate decision is recorded.

## Verification

```bash
npm run test:v1-providers
npm run check:deploy
```

The complete official-source register, exact URLs, access date, machine-readable decisions, and unresolved conditions
live in `config/v1-provider-matrix.json`.
