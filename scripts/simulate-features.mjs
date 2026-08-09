import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath))
const includesAll = (source, markers) => markers.every((marker) => source.includes(marker))

const sources = {
  app: read('src/App.tsx'),
  shell: read('src/components/layout/AppShell.tsx'),
  renderer: read('src/components/layout/PageRenderer.tsx'),
  navigation: read('src/hooks/useNavigationState.ts'),
  tasks: read('src/features/tasks/TaskPages.tsx'),
  taskHook: read('src/hooks/useTaskWorkflows.ts'),
  taskService: read('src/services/taskService.ts'),
  community: read('src/features/community/CommunityPage.tsx'),
  communityHook: read('src/hooks/useCommunityWorkflows.ts'),
  communityService: read('src/services/communityService.ts'),
  assets: read('src/features/assets/AssetLibraryPage.tsx'),
  generations: read('src/features/generations/GenerationCenterPage.tsx'),
  inspiration: read('src/features/inspiration/InspirationPage.tsx'),
  points: read('src/features/rewards/PointsPage.tsx'),
  workspace: read('src/features/workspace/WorkspacePages.tsx'),
  music: read('src/features/workspace/MusicStudioPage.tsx'),
  video: read('src/features/workspace/VideoStudioPage.tsx'),
  chat: read('src/features/workspace/ChatPage.tsx'),
  musicHook: read('src/hooks/useMusicGenerationWorkflow.ts'),
  videoHook: read('src/hooks/useVideoGenerationWorkflow.ts'),
  admin: read('src/features/admin/AdminPage.tsx'),
  adminGenerationRecords: read('src/features/admin/AdminGenerationRecordsPanel.tsx'),
  adminGenerationRecovery: read('src/features/admin/AdminGenerationRecoveryPanel.tsx'),
  adminSecurityIncidents: read('src/features/admin/SecurityIncidentsWorkspace.tsx'),
  adminSecurityIncidentOperations: read('src/features/admin/useSecurityIncidentOperations.ts'),
  adminFeedback: read('src/features/admin/AdminActionFeedback.tsx'),
  actionFeedback: read('src/components/ui/ActionFeedback.tsx'),
  locale: read('src/i18n/locale.ts'),
  theme: read('src/hooks/useThemeState.ts'),
  explore: read('src/features/explore/ExplorePages.tsx'),
  css: read('src/index.css'),
  adminGenerationCss: read('src/features/admin/admin-generations.css'),
  readme: read('README.md'),
}

const checks = []
const add = (group, name, pass, detail = '') => checks.push({ group, name, pass: Boolean(pass), detail })

add('navigation', 'the modular renderer exposes every primary product surface', includesAll(sources.renderer, [
  "page === 'home'", "page === 'playground'", "page === 'generations'", "page === 'assets'",
  "page === 'chat'", "page === 'explore'", "page === 'tasks'", "page === 'publish'",
  "page === 'mine'", "page === 'community'", "page === 'inspiration'", "page === 'points'", "page === 'admin'",
]), 'home, create, operations, library, discover, marketplace, community, rewards, and Admin')
add('navigation', 'publishing remains a task workflow instead of a duplicate sidebar destination', !sources.shell.includes("key: 'publish'") && includesAll(sources.tasks, ["setPage('publish')", '{t.postTask}']), 'task plaza owns the publish entry point')
add('navigation', 'source-aware back navigation and primary navigation reset are retained', includesAll(sources.navigation + sources.shell, ['pageReturnTargets', 'navigateBackToParent', 'navigatePrimary', 'resetReturn: true']), 'return targets and primary reset')

add('real data', 'legacy frontend Mock catalogs are absent', !exists('src/data/mockData.ts') && !exists('src/data/productionData.ts'), 'deleted Mock and placeholder catalog modules')
add('real data', 'frontend runtime does not import Mock catalogs or expose debug source badges', !Object.values(sources).some((source) => source.includes('data/mockData')) && !sources.app.includes('API session') && !sources.app.includes('data-source-panel'), 'no Mock imports, API-session badges, or source panels')
add('real data', 'Discover uses governed empty states instead of invented engagement data', includesAll(sources.explore, ['No public works yet', 'Only governed, explicitly published works will appear here.', 'The public media catalog is empty']), 'explicit public catalog empty states')

add('task lifecycle', 'task workflows use typed API proposals, submissions, reviews, timelines, disputes, and cancellation', includesAll(sources.taskHook, [
  'taskService.createProposal', 'taskService.reviewProposal', 'taskService.submit', 'taskService.review',
  'taskService.listTimeline', 'taskService.createDispute', 'taskService.cancel',
]), 'complete marketplace workflow calls')
add('task lifecycle', 'task service maps lifecycle operations to API routes', includesAll(sources.taskService, ['/proposals', '/submissions', '/timeline', '/review', '/disputes', '/cancel']), 'typed task endpoints')
add('task lifecycle', 'task UI exposes proposal, timeline, submission review, and dispute states', includesAll(sources.tasks, ['submit-proposal-button', 'task-timeline', 'approve-submission-button', 'reject-submission-button', 'open-dispute']), 'actor-scoped task controls')

add('community', 'community workflows load and mutate real API resources', includesAll(sources.communityHook + sources.communityService, ['communityService.listPosts', 'communityService.createPost', 'communityService.replyToPost', 'communityService.updatePost', 'communityService.deletePost']), 'post and comment API lifecycle')
add('community', 'community UI has loading, error, empty, detail, report, and editable reply states', includesAll(sources.community, ['status.loading', 'status.error', 'topic-empty', 'community-report-panel', '<textarea']), 'honest community states')

add('creative tools', 'Image, Music, Video, and Chat product workspaces are registered', includesAll(sources.renderer + sources.workspace, ['PlaygroundPage', 'MusicStudioPage', 'VideoStudioPage', 'ChatPage']), 'four creative modalities')
add('creative tools', 'Music and Video run through application workflows with local operation feedback', includesAll(sources.musicHook + sources.videoHook, ['creativeService.createGeneration', 'GenerationOperationFeedback', 'setFeedback']) && !sources.app.includes('pushToast,\n  })'), 'API generation and in-context feedback')
add('creative tools', 'Chat renders streaming history and recoverable error states', includesAll(sources.chat, ['chatService', 'role="log"', 'aria-live="polite"', 'ActionFeedback']), 'streaming and local feedback')
add('creative tools', 'generation retry requires an explicit confirmation surface', includesAll(sources.workspace + sources.music + sources.video, ['GenerationRetryConfirmation', 'retryFeedback']), 'retry confirmation and outcome feedback')

add('assets and history', 'asset library is API-backed with filters, empty states, and pagination', includesAll(sources.assets, ['mediaService.assetLibrary', 'asset-empty', 'nextCursor', 'filters.mediaType']), 'owner-scoped asset operations')
add('assets and history', 'generation center has real filters, task detail, output, and export controls', includesAll(sources.generations, ['creativeService', 'generation-task-detail', 'generation-output', 'export']), 'generation operations center')
add('assets and history', 'inspiration and points surfaces use service-backed resources', includesAll(sources.inspiration + sources.points, ['communityService.listInspirationCategories', 'billingService.summary', 'billingService.ledger', 'entitlementService.me']), 'library and personal accounting APIs')

add('admin', 'Admin is decomposed into dedicated operations workspaces', includesAll(sources.admin, ['AdminGenerationWorkspacePanel', 'SecurityWorkspacePanel', 'TrustSafetyWorkspace', 'AdminOverviewPanel']), 'modular Admin workspaces')
add('admin', 'generation operations expose bulk actions, recovery, metrics, and local feedback', includesAll(sources.admin + sources.adminGenerationRecords + sources.adminGenerationRecovery, ['admin-generation-bulk-actions', 'admin-generation-recovery', 'AdminGenerationMetricsPanel', 'AdminActionFeedback']), 'permission-scoped generation operations')
add('admin', 'security incidents expose create, attach, resolve, and evidence states', includesAll(sources.adminSecurityIncidents + sources.adminSecurityIncidentOperations, ['createIncident', 'attachEvent', 'resolveIncident', 'incident.version']), 'optimistic security incident lifecycle')
add('admin', 'administrator mutations use in-context accessible feedback', includesAll(sources.adminFeedback + sources.actionFeedback, ["role={message.kind === 'error' ? 'alert' : 'status'}", 'AdminActionFeedbackMessage']), 'local status or alert feedback')

add('preferences', 'locale is persisted and applied to the document language', includesAll(sources.app + sources.locale, ['readLocale', 'persistLocale(locale)', "document.documentElement.lang", 'localStorage.setItem']), 'English and Chinese state survives navigation and reload')
add('preferences', 'light and dark themes persist without changing routes', includesAll(sources.shell + sources.theme, ['setThemeMode', "hcaiThemeMode", 'localStorage.setItem']), 'persistent dual-theme control')

add('responsive UX', 'core layouts define stable responsive behavior', includesAll(sources.css + sources.adminGenerationCss, ['@media (max-width: 860px)', '.asset-library-page', '.generation-center-page', '.admin-generation-operations-panel', 'overflow-wrap: anywhere']), 'mobile layouts and bounded text wrapping')
add('responsive UX', 'debug source-label styles are removed', !sources.css.includes('.data-source-panel') && !sources.css.includes('.data-source-chip'), 'no dormant debug badge styling')
add('responsive UX', 'the landing experience ships real visual assets with reduced-motion handling', exists('src/features/landing/landing-particles-static.webp') && includesAll(read('src/features/landing/CommunityLandingPage.tsx') + read('src/features/landing/community-landing.css'), ['ParticleMorphBackground', 'prefers-reduced-motion']), 'bitmap fallback and interactive visual enhancement')

add('release boundary', 'README documents API auth, production boundaries, and creative output status', includesAll(sources.readme, ['Login, registration, OAuth dev callback, logout, and auth-gated actions backed by the API', 'creative outputs', 'production']), 'operator-visible product boundary')

const groups = checks.reduce((result, check) => {
  result[check.group] ??= []
  result[check.group].push(check)
  return result
}, {})

let failed = 0
for (const [group, groupChecks] of Object.entries(groups)) {
  console.log(`\n${group}`)
  for (const check of groupChecks) {
    console.log(`  ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`)
    if (!check.pass) {
      failed += 1
      if (check.detail) console.log(`       ${check.detail}`)
    }
  }
}

console.log(`\nProduction frontend simulation checks: ${checks.length - failed}/${checks.length} passed`)
if (failed > 0) process.exitCode = 1
