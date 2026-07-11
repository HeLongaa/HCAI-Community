# V1 Content Safety Policy Matrix

This is the human-readable decision record for V1-44. The machine-readable source of truth is
`config/v1-content-safety-policy.json`, and `npm run test:v1-safety-policy` prevents the modality, Provider,
review, appeal, and audit contracts from drifting silently.

Official policy pages were reviewed on **2026-07-11**. This record is an engineering baseline for implementation and
review, not legal advice. Contract, jurisdiction, and product-policy approval remain required before production use.

## Decision Status

The V1 policy is **frozen for implementation**, but enforcement is not complete.

- No real Provider call, credential, SDK, callback, polling client, or production traffic is approved by this record.
- The current prompt rules are a limited fixture baseline, not the complete policy implementation.
- Provider-native filters are defense in depth and never replace application checks.
- Unclassified content, unknown Provider safety results, and unsupported regions fail closed with `block`.
- Generated outputs stay private until post-output safety, media security, rights, and review gates pass.
- Silent mock fallback and weakening Provider safety settings are forbidden.
- Human review and appeals are required for V1, but their complete API and UI are owned by V1-63.

## Four Dispositions

| Disposition | Request behavior | Provider dispatch | Output behavior | Appeal |
| --- | --- | --- | --- | --- |
| `prohibited` | Reject the purpose or content | Never | Quarantine and reject | Available, with the original decision retained until closeout |
| `block` | Block as submitted; the user may edit or supply missing rights/context | Never | Quarantine | Available when a user-facing decision was made |
| `review` | Hold for trained review | Only after explicit pre-review approval | Quarantine until release/reject | Available after a reject or unresolved decision |
| `allow` | Continue after mandatory checks | Yes | Release only after all output checks pass | Not applicable |

`allow` is not a bypass. It means the request remains eligible after automated classification, rights and consent,
region, Provider, output, media security, and provenance checks.

## Risk Matrix

Codes: `P` prohibited, `B` block, `R` review, `A` allow, `-` not applicable to the modality.

| Risk category | Image | Chat | Video | Music |
| --- | :---: | :---: | :---: | :---: |
| Child sexual exploitation | P | P | P | P |
| Non-consensual intimate content | P | P | P | P |
| Hate/extremist praise or recruitment | P | P | P | P |
| Violent wrongdoing instructions | P | P | P | P |
| Credential theft, malware, or cyber abuse | P | P | - | - |
| Self-harm instructions or encouragement | P | P | P | P |
| Adult explicit sexual content | B | B | B | B |
| Graphic violence or gore | B | R | B | R |
| Targeted harassment, threats, or doxxing | B | B | B | B |
| Fraud, impersonation, or deceptive media | B | B | B | B |
| Election or political persuasion | B | B | B | B |
| Real-person likeness, voice, or biometrics | R | R | R | R |
| Public figure in sensitive context | R | R | R | R |
| Personal data or sensitive-attribute inference | R | R | R | R |
| Regulated advice or high-impact decisions | - | R | - | - |
| Weapons, drugs, or regulated goods | R | R | R | R |
| Copyright, trademark, artist style, or lyrics | R | R | R | R |
| Minor in a nonsexual sensitive context | R | R | R | R |
| Medical, legal, newsworthy, or educational sensitive context | R | R | R | R |
| Benign original or authorized creation | A | A | A | A |

Category definitions, stable reason codes, severity, and escalation owners are frozen in the machine-readable matrix.
Implementations must classify the user's purpose and context, not merely match isolated words.

## Modality Rules

### Image

Before dispatch, classify the prompt, negative prompt, input image, ownership, consent, identity, public-figure context,
region, and Provider eligibility. Real-person face or identity transformations require consent-purpose evidence.
Provider success never bypasses application output classification, media scanning, provenance preservation, human review,
or governed private storage.

### Chat

Classify every message and attachment with conversation context, a tool allowlist, safe tool arguments, and a stable
privacy-preserving safety identifier. Streaming output must be classifiable and stoppable without exposing unsafe
partial content. Supportive self-harm prevention and neutral education are distinct from instructions or encouragement.
The model may assist with high-impact topics but never makes the final legal, medical, financial, employment, housing,
education, insurance, or similar decision.

### Video

Classify prompts, storyboards, reference frames, reference audio, identity, consent, and rights before dispatch. Safety
can change at every long-running lifecycle transition. Final video requires representative-frame and audio checks, full
media scanning, provenance preservation, and private quarantine before preview, playback, sharing, or download.

### Music

Classify prompts, lyrics, reference audio, composition plans, voices, samples, artists, and distribution rights. Living
artist, voice-clone, recognizable lyric, and unlicensed sample requests require review or rejection. Provider success
does not prove the application has platform, repository, reseller, media, or end-user distribution rights.

## Responsibility Chain

| Stage | Primary owner | Must complete before | Failure behavior |
| --- | --- | --- | --- |
| `pre_dispatch` | Application | Provider request or Provider cost | Block |
| `provider_native` | Provider and adapter | Accepting a Provider output/state | Block |
| `post_output` | Application | Preview, playback, download, sharing, or task/portfolio use | Quarantine |
| `human_review` | Authorized moderator | Release of reviewed content | Remain quarantined |
| `appeal` | Independent authorized reviewer | Appeal closeout | Original decision remains |

The application owns the final product decision. A Provider refusal is mapped to a safe stable reason and rejected; a
Provider allow result is only one input to the application decision. Complete Provider request/response payloads must
not be copied into ordinary generation, audit, notification, or Admin records.

## Provider Mapping

| Provider | Modality/role | Official policy baseline | Mandatory application controls |
| --- | --- | --- | --- |
| OpenAI GPT Image 2 | Image primary | OpenAI Usage Policies | Prompt/input rights gate, output classifier, media scan, human review |
| Replicate FLUX 1.1 Pro | Image backup | Replicate Terms and model terms | Prompt/input rights gate, model-license allowlist, output classifier, media scan, human review |
| OpenAI GPT-5.6 Terra | Chat primary | OpenAI Usage Policies | Input/output gates, tool allowlist, stable safety identifier, stream stop, human escalation |
| Anthropic Claude Sonnet 5 | Chat backup | Anthropic Usage Policy | Input/output gates, tool allowlist, model-specific safety regression, stream stop, human escalation |
| Google Veo 3.1 Fast | Video primary | Google Generative AI Prohibited Use Policy and Cloud AUP | Rights gate, lifecycle mapping, frame/audio/media checks, C2PA preservation, review |
| Runway Gen-4.5 | Video backup | Runway Safety and Terms | Rights gate, lifecycle mapping, frame/audio/media checks, review |
| ElevenLabs Music v2 Enterprise | Music primary | ElevenLabs Prohibited Use and Music Terms | Lyrics/artist/voice/sample gate, output review, license metadata, report/takedown path |
| Google Lyria 3 Pro Preview | Music backup | Google Generative AI Prohibited Use Policy and Cloud AUP | Rights gate, lyrics/audio review, license metadata, report/takedown path |

All eight mappings retain the legal, data, rights, region, model-stage, and SLA conditions in
`config/v1-provider-matrix.json`. If the application policy and Provider policy differ, the stricter rule wins. No
Provider geography control may be bypassed.

## Review And Appeal

Review queue states are `review_required`, `in_review`, `released`, and `rejected`. Entry can come from a pre-dispatch
context flag, Provider flag, post-output flag, user report, Admin force-review, or reopened appeal.

Release requires:

1. An authorized reviewer.
2. Recorded policy version, categories, and decision.
3. Clean media-security evidence for all linked assets.
4. Sufficient rights and consent evidence.
5. Continuing region and Provider eligibility.

Reject requires a stable reason code, safe user message, immutable audit event, and explicit appeal eligibility. Review
timeouts leave content quarantined and alert operations. Critical review has a four-hour operational target; standard
review has a 48-hour target. These are application targets, not Provider SLAs.

Users must have an appeal entry point for user-facing prohibited, blocked, review, and rejected decisions. Appeals are
accepted for 30 days with a five-business-day target. The appeal reviewer cannot be the sole reviewer who made the
original decision, and no appeal automatically releases an asset. Outcomes are upheld, overturned, partially
overturned, or needs more information.

## Audit Contract

Every safety decision requires an event id, idempotency key, correlation/generation/workspace identifiers, actor,
modality/mode, Provider and role, policy version, stage, category ids, decision, reason codes, prompt hash, safe redacted
preview when necessary, input/output asset ids, rights-attestation version, region, safe Provider safety code, state
transition, reviewer/appeal references, and timestamp.

The following must not enter ordinary audit metadata:

- Raw prompts or conversations.
- Raw Provider requests or responses.
- Provider credentials, authorization headers, tokens, or secrets.
- Private download URLs or file bytes.
- Unredacted personal data.

Critical child-safety evidence follows a separate legal reporting runbook and is never copied into ordinary audit
metadata. V1-45 owns the final retention, deletion, export, and data-classification schedule.

## User Messages

Public responses use stable codes and short non-diagnostic copy:

- `CONTENT_NOT_ALLOWED`
- `REQUEST_NEEDS_REVIEW`
- `OUTPUT_NEEDS_REVIEW`
- `PROVIDER_SAFETY_REFUSAL`
- `RIGHTS_ATTESTATION_REQUIRED`
- `REGION_UNAVAILABLE`
- `APPEAL_RECEIVED`
- `APPEAL_DECIDED`

User messages must not reveal classifier thresholds, evasion hints, hidden Provider details, other users' data, or raw
moderation evidence.

## Current Runtime Baseline

`server/src/creative/policy.js` currently runs six deterministic keyword rules under `creative-policy-v1`: three block
rules and three review rules. It runs before quota reservation and Provider execution. The generation path already has
`review_required`, prompt hash/bounded preview persistence, media scan-gated downloads, and secret-key rejection in the
Provider adapter contract.

This is useful scaffolding, not complete enforcement. Missing pieces include modality classifiers, real Provider-native
safety mapping, semantic output classifiers, streaming interruption, full review/appeal operations, and the V1-45 data
retention schedule.

## Implementation Handoff

| Task | Ownership |
| --- | --- |
| V1-45 | Safety-event data classification, retention, deletion, export, and redaction |
| V1-59 | Image input/output enforcement and review transitions |
| V1-60 | Chat input, streaming output, tool, and stop enforcement |
| V1-61 | Video lifecycle, frame/audio, quarantine, and provenance enforcement |
| V1-62 | Music rights, lyrics/audio, license, quarantine, and takedown enforcement |
| V1-63 | Human review, release/reject, appeal, notification, and audit closure |
| V1-78 | User-facing acceptable-use policy, disclosures, and support entry points |

## Official Policy Sources

- [OpenAI Usage Policies](https://openai.com/policies/usage-policies/)
- [Anthropic Usage Policy](https://www.anthropic.com/legal/aup)
- [Google Generative AI Prohibited Use Policy](https://policies.google.com/terms/generative-ai/use-policy)
- [Google Cloud Acceptable Use Policy](https://cloud.google.com/terms/aup)
- [Runway Safety](https://runwayml.com/safety)
- [Runway Terms of Use](https://runwayml.com/terms-of-use)
- [Replicate Terms](https://replicate.com/terms)
- [ElevenLabs Prohibited Use Policy](https://elevenlabs.io/use-policy)
- [ElevenLabs Music Terms](https://elevenlabs.io/music-terms)

Provider capability, terms, data, region, pricing, and SLA sources remain indexed in
`config/v1-provider-matrix.json`.

## Change Control

Any category, disposition, Provider mapping, user message, review/appeal rule, audit field, or source change must update
the JSON and this document together, pass `npm run test:v1-safety-policy`, and record the policy-version impact in the
matching Notion task. A material loosening requires product, trust-and-safety, legal, and security review before runtime
enablement.
