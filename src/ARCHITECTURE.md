# Front-end Structure

This prototype is now split into a light application shell plus reusable domain, data, and UI modules.

- `App.tsx` composes app-level hooks, groups their outputs by concern, and mounts the application shell with the active page renderer.
- `components/layout/` contains the persistent app shell, sidebar, top bar, parent navigation, page renderer, grouped prop contracts, and global overlay wiring.
- `components/prototype/` contains the remaining home-page prototype components migrated from the original single-file prototype.
- `components/overlays/` contains global overlays and persistent surfaces such as search, login, and the dynamic island music/guide control.
- `features/tasks/` contains the task marketplace, publish request, my tasks desk, and shared task UI.
- `features/community/` contains the community forum page and shared comment display.
- `features/inspiration/` contains the inspiration library and its task/workspace conversion flows.
- `features/workspace/` contains the AI workspace, chat assistant, and image/video studio surfaces.
- `features/explore/` contains discovery pages and reusable media cards/track rows.
- `features/profile/` contains public profile and playlist pages.
- `features/admin/` contains the admin review queue and moderation surface.
- `features/rewards/` contains the points ledger and reward redemption surface.
- `features/static-pages/` contains pricing, API, earn, about, terms, and privacy pages.
- `components/ui/` contains reusable cross-feature UI primitives, including the shared notification list used by the topbar inbox and Admin Center.
- `domain/` contains shared types, theme helpers, and pure utility functions.
- `data/` contains static mock data used by the prototype.
- `i18n/` contains localized UI copy.
- `hooks/` contains reusable app-level state orchestration such as navigation, workflow actions, feedback, account/theme persistence, and player state.

Next productization steps should split the large layout contracts into exported typed view models or scoped providers, then begin backend integration using the product plan and API/schema documents under `docs/`.
