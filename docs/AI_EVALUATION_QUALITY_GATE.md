# AI Evaluation Quality Gate

AI-EVAL-01 adds versioned evaluation suites, independently reviewed threshold policies, immutable scored runs, case-level result hashes, and regression reports for Image, Chat, Video, and Music model versions.

## Evidence boundary

Suites store only SHA-256 references for inputs and expected outputs. Runs store bounded scores, safety outcomes, latency, output hashes, reason codes, and a deterministic report hash. Raw prompts, completions, Provider payloads, URLs, tokens, API keys, authorization values, and secrets are not accepted or persisted.

Every suite, case, policy, run, and case result is immutable in PostgreSQL. Corrections require a new suite or policy version and a new source-keyed run. Policy authors and reviewers must be different references.

## Deterministic gate

A run is `unverifiable` when it does not cover the complete selected suite. Complete runs fail when quality or safety thresholds fail, or when candidate quality regresses beyond the reviewed limit. A baseline run establishes absolute performance; only a passing candidate run linked to a baseline can authorize promotion.

Production promotion requires the immutable run to:

1. have status `passed`;
2. include a baseline comparison;
3. remain within its reviewed evidence TTL;
4. match the promoted ModelVersion and ModelDeployment;
5. use a production threshold policy.

The checks run when promotion is requested and again when Release Control applies it. Missing, stale, expired, failed, or mismatched evidence fails closed. Existing historical promotions remain readable, but all new promotion requests require `evaluationRunId`.

## Operations

Admin APIs and the Model Control **Evaluations** tab support bounded suite, policy, and run lists; immutable creation; summaries; JSON export; report inspection; and promotion evidence selection. Dedicated read, manage, and execute permissions separate inspection, policy authoring, and run recording.

This task adds no Provider credential, endpoint, network adapter, or external call. Real Provider traffic still requires MODEL-03, LEGAL-BASE-01, explicit PROVIDER-APPROVAL, and the applicable staging task.
