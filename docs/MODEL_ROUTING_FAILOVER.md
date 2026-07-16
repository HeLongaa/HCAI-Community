# Model Routing, Rollout, and Failover

`MODEL-02` adds routing above the normalized model registry. Routing policy APIs remain credential-free; `MODEL-05` separately records decisions, external SecretRefs, and approved production promotion.

## Selection

Active policies match modality, operation, environment, optional region, optional account role, and a deterministic percentage bucket. The bucket hashes the policy key, rollout seed, and request subject key. The raw subject key is used only in memory and is never returned, audited, exported, or persisted. `MODEL-05` persists only a domain-separated stable hash for correlation.

Candidates must satisfy the complete catalog chain: Provider, model, version, capability, and deployment are active; the operation is supported; environment and region match; and the deployment is traffic eligible. Provider-level kill switches and circuit state reuse the existing Provider control plane. Unknown control or circuit state fails closed.

## Failover

New policies default to `fail_closed`, which evaluates primary targets only. `ordered` evaluates enabled primary targets first and then enabled backup targets in explicit priority order. A backup is never a mock fallback and cannot bypass catalog lifecycle, traffic approval, Provider controls, circuit state, budget enforcement, safety, or regional policy.

New deployments start with `trafficEligible=false`. Only an approved and applied `MODEL-05` production promotion can enable the flag; rollback disables it. Provider controls and the later `MODEL-03`, `LEGAL-BASE-01`, `AI-EVAL-01`, and `PROVIDER-APPROVAL` evidence remain independent fail-closed gates.

## Lifecycle And Rollback

Policies use the model-control state machine and optimistic versions. Active policies and targets are immutable. Operators must disable a policy before editing targets or restoring a revision. Every create, edit, target replacement, transition, and rollback appends an immutable `ModelRoutePolicyRevision`. Rollback restores configuration while leaving the policy non-active; reactivation is a separate audited action.

## Operations

The Admin AI configuration workbench provides filtered policy lists, target editing, status transitions, deterministic preview, revision rollback, summary, and bounded export. Preview performs no Provider request, budget reservation, or generation mutation.

Run:

```bash
npm run test:model-routing
FOUNDATION_DATABASE_URL=postgresql://... node --test server/src/repositories/prismaModelControl.integration.test.js
```
