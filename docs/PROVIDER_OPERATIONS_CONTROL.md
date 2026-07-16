# Provider Operations Control

MODEL-03 unifies the model catalog, MODEL-05 SecretRef metadata, Provider budget/cost controls, Kill Switches, circuit state, health evidence, and request capacity into one fail-closed readiness result. It remains personal-account-only and does not invoke a Provider.

## Readiness

A route candidate is ready only when the exact policy is active, the configured SecretRef purpose has a current unexpired rotation leaf, global and Provider controls are enabled, current cap evidence covers the estimate, the circuit is closed, append-only health evidence is current, and request/concurrency capacity remains. Missing state is unavailable state; no route silently falls back to a mock Provider.

## Evidence And Limits

Health evidence is append-only in PostgreSQL. Source references are hashed, while nested evidence rejects credentials, raw requests or responses, prompts, and URLs. Dispatch claims use an idempotent source key, a fixed UTC minute window, a PostgreSQL advisory lock, and a serializable transaction. Completion releases concurrency; request count remains consumed for its minute.

## Operations

Admin model control exposes list, detail, update, status, health evidence, summary, and bounded JSON export. Active policies must be disabled before editing. Activation recomputes every gate; disabling is immediate. Existing Provider control recovery remains the dual-reviewed path for re-enabling a Kill Switch or closing a circuit.

Production still requires MODEL-05 promotion plus AI evaluation, legal baseline, and explicit Provider approval. MODEL-03 readiness is necessary but never sufficient for production traffic.

```bash
npm run test:provider-operations
npm run check:pr
```
