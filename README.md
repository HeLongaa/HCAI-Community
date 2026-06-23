# MuseFlow AI Studio

A MusicGPT-inspired front-end prototype centered on an AI task marketplace and creator community.

This is a front-end only prototype. Data, login, publishing, claiming, submitting, reviewing, point settlement,
community posting, file upload, and admin actions are simulated with static state and mock content.

## Features

- Task Plaza-first landing experience for posting AI requirements and taking paid work
- Forum-style creator community for posts, showcases, prompt discussions, and collaboration
- AI Task Engine for requirement splitting, maker matching, reward estimation, and contribution proof
- Publish Request page with category, reward, deadline, visibility, attachment, and acceptance-rule fields
- My Tasks desk for claimed work, submitted deliverables, review notes, and contribution history
- Task details with public brief, private brief, attachments, result links, review notes, rights, budget, and points
- Inspiration Library for featured posts, task templates, prompt packs, tutorials, cases, and idea radar
- Points & rewards ledger with balance, pending rewards, rank, redemptions, and point history
- Admin Center for task review, resubmissions, community reports, user/tag/AI-config operation queues
- Dark responsive app shell with sidebar navigation
- English by default, Chinese language toggle
- Music creation workbench with prompt, modes, tools, queue, and recent results
- AI chat workspace with quick prompts and cross-module actions
- Image Studio with text-to-image, image-to-image, presets, controls, and result actions
- Video Studio with text-to-video, image-to-video, music video, storyboard, captions, and preview flow
- Explore page with radio cards, trending songs, images, and videos
- Global search panel for songs, playlists, SFX, users, tasks, and posts
- Mini player and expanded now-playing drawer with queue, prompt, lyrics, comments, like, and share
- Task Plaza for browsing, filtering, claiming, submitting, reviewing, accepting, and tracking AI-related tasks
- Community forum with post templates, categories, tags, sorting, votes, solved state, embedded works, task conversion, library saving, likes, saves, and replies
- Profile and playlist detail pages
- Pricing, API, Earn, About, Terms, and Privacy pages
- Login modal and auth-gated actions simulated in the front end

## Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Verification

```bash
npm run lint
npm run build
npm run test:sim
```

`test:sim` runs feature-contract checks for the planned modules: navigation, Task Plaza lifecycle, publish form,
My Tasks delivery desk, community forum flows, AI task engine, creation tools, points ledger, admin review queue,
cross-module actions, localization, responsive layout contracts, and prototype-boundary documentation.
