# AI-MUSIC-02 Production UX Acceptance

AI-MUSIC-02 closes the engineering acceptance surface for Music rights disclosure, fixed output quality, private
playback, clean download, limits, mobile accessibility, and rollback. It does not approve a real Provider for production.

## Automated evidence

- `config/music-production-ux-acceptance.json` keeps the machine-readable production decision at `no_go`.
- `server/src/creative/musicProductionAcceptance.test.js` proves the fixed `mp3_48000_192` quality profile, one-output
  and three-minute limits, rights/license requirements, generated-minute spend limits, daily blocking before dispatch,
  and ElevenLabs staging-client rollback without network dispatch or automatic Lyria/Mock fallback.
- The fixture application acceptance is bounded to five seconds. Provider tests prove strict MP3 validation, bounded
  ingestion, safe failure projection, license evidence, training opt-out, and generated-minute accounting.
- Playwright proves explicit rights and artist-imitation disclosure, application-owned clean MP3 private playback and
  download, keyboard generation, internal history scrolling, and no page overflow at 390x844. Quality, player,
  download, prompt, and status controls have explicit accessible names or live semantics.

Run the focused gate with:

```sh
npm run test:music-production-ux-acceptance
```

The server-only portion is included in `precheck:quick`; the complete Playwright suite remains part of `check:pr`.

## Production decision

Production remains fail-closed. A go decision requires AI-MUSIC-01 credentialed ElevenLabs acceptance, a paid or
Enterprise account with Music API access, platform/resale/media rights, training opt-out and data-processing evidence,
current license/terms references, scoped and unexpired approval, and an operator-owned rollback rehearsal. Engineering
acceptance is necessary evidence, not production authorization.
