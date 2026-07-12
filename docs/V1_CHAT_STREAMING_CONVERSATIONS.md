# V1 Chat Streaming And Conversations

V1-21 implements the application-owned Chat data plane without enabling a real Provider. The frozen capability source
remains `server/src/creative/chatCapabilityContract.js`.

## Runtime Scope

- `POST /api/chat/conversations` creates an owner-scoped conversation.
- `GET /api/chat/conversations` lists only the current user's conversation summaries.
- `GET /api/chat/conversations/:id/messages` decrypts only an owned conversation.
- `POST /api/chat/conversations/:id/turns/stream` emits SSE events for an idempotent turn.
- `POST /api/chat/turns/:id/stop` requests an idempotent stop.
- `DELETE /api/chat/conversations/:id` hard-deletes the conversation and records bounded restore-replay evidence.

The SSE sequence is `turn.accepted`, zero or more `content.delta` events, `usage`, and one terminal event. Terminal
states are `completed`, `stopped`, `interrupted`, `failed`, or `blocked`. Reusing `clientTurnId` returns the existing
snapshot and never dispatches a second turn.

## Encryption And Ownership

Message bodies use AES-256-GCM. The authenticated identity includes conversation id, message id, role, and sequence,
so ciphertext cannot be moved between records without failing integrity verification. PostgreSQL stores ciphertext,
IV, authentication tag, key id, content hash, and character count, but no readable message body.

Set either `CHAT_MESSAGE_ENCRYPTION_KEY` for one base64-encoded 32-byte key or
`CHAT_MESSAGE_ENCRYPTION_KEYS` with comma-separated `keyId:base64Key` entries. Select the write key with
`CHAT_MESSAGE_ENCRYPTION_ACTIVE_KEY_ID`. Missing keys fail closed with `CHAT_ENCRYPTION_UNAVAILABLE`.

## Lifecycle And Accounting

Each turn owns two ordered messages and may link one `CreativeGeneration`. Quota and creative credits reserve before
stream release. Completion commits/settles; stop and disconnect release/refund and cancel; failure or safety block
release/refund and fail the generation. Chat prompts never enter `CreativeGeneration.promptPreview`.

The worker job `chat-retention-sweep` deletes inactive conversations at the 365-day maximum and reapplies active
deletion tombstones after restore. Tombstones contain ids, reason, timestamps, and a 35-day replay deadline, never
message content.

## Deliberate Limits

- Only the Mock stream adapter is registered.
- No Provider credential, SDK, HTTP client, conversation id, automatic failover, or paid traffic is enabled.
- Attachments and selected product context remain disabled until V1-22.
- The current local Chat page remains a simulation until V1-23 consumes the typed `chatService` client.
- Real Provider staging acceptance remains V1-24 and requires separate explicit approval.
