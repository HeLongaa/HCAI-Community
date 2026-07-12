import fs from 'node:fs'
import path from 'node:path'

function readSourceTree(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) return readSourceTree(fullPath)
      return /\.(ts|tsx)$/.test(entry.name) ? [fs.readFileSync(fullPath, 'utf8')] : []
    })
    .join('\n')
}

const app = readSourceTree('src')
const css = fs.readFileSync('src/index.css', 'utf8')
const readme = fs.readFileSync('README.md', 'utf8')
const navItemsBlock = app.slice(app.indexOf('const navItems:'), app.indexOf('const pageLabels ='))

const checks = []

function addCheck(group, name, pass, detail) {
  checks.push({ group, name, pass, detail })
}

function includesAll(source, values) {
  return values.every((value) => source.includes(value))
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length
}

const expectedPages = [
  'home',
  'tasks',
  'publish',
  'mine',
  'community',
  'inspiration',
  'points',
  'playground',
  'chat',
  'explore',
  'admin',
]

const pageComponents = [
  'HomePage',
  'TasksPage',
  'PublishPage',
  'MyTasksPage',
  'CommunityPage',
  'InspirationPage',
  'PointsPage',
  'PlaygroundPage',
  'ChatPage',
  'ExplorePage',
  'AdminPage',
]

addCheck(
  'navigation',
  'all planned pages are routable from App state',
  expectedPages.every((page) => app.includes(`page === '${page}'`) || page === 'home'),
  expectedPages.join(', '),
)

addCheck(
  'navigation',
  'all planned page components exist',
  pageComponents.every((component) => app.includes(`function ${component}`)),
  pageComponents.join(', '),
)

addCheck(
  'navigation',
  'publish request is not duplicated in the sidebar menu',
  !navItemsBlock.includes("key: 'publish'") && includesAll(app, ["setPage('publish')", '{t.publish}', '{t.postTask}']),
  'publish flow remains inside task plaza only',
)

addCheck(
  'navigation',
  'global back button prefers the real source page and primary navigation clears stale return targets',
  includesAll(app, [
    'const [pageReturnTargets, setPageReturnTargets]',
    'type NavigateOptions',
    'next[destination] = sourcePage',
    'const navigatePrimary',
    'navigateToPage(target, workspace, { resetReturn: true })',
    'const navigateBackToParent',
    'delete next[page]',
    'pageReturnTargets[page] ??',
    'setPage={navigateToPage}',
    'setPage={navigatePrimary}',
  ]),
  'source-aware return targets, primary navigation reset, and back cleanup',
)

addCheck(
  'task plaza',
  'task data models full marketplace lifecycle fields',
  includesAll(app, [
    'points: string',
    'publisher: string',
    'assignee: string',
    'requirements: string[]',
    'attachments: string[]',
    'privateBrief: string',
    'submission: string',
    'resultLinks: string[]',
    'reviewNote: string',
    'rights: string',
  ]),
  'points, publisher, assignee, requirements, attachments, private brief, submission, review, rights',
)

addCheck(
  'task plaza',
  'task statuses cover open, active, review, completed, rejected',
  includesAll(app, ["status: 'Open'", "status: 'In Progress'", "status: 'Pending Review'", "status: 'Completed'", "status: 'Rejected'"]),
  'expected lifecycle statuses',
)

addCheck(
  'task plaza',
  'task detail renders delivery and review sections',
  includesAll(app, ['Submission requirements', 'Attachments', 'Private brief', 'Rights', 'proposal-flow', 'Proposal mode']),
  'task detail sections',
)

addCheck(
  'task plaza',
  'task actions include take and submit work gates',
  includesAll(app, ['{t.takeTask}', 'Submit proposal', 'Submit acceptance work', 'Publish task']),
  'take, submit, review, publish actions',
)

addCheck(
  'task plaza',
  'task actions use typed API workflows and update front-end state',
  includesAll(app, [
    'const submitProposal = async (task: Task)',
    'taskService.createProposal',
    'taskService.submit',
    'proposalStateByTask',
    'submissionStateByTask',
    'setTaskList((current)',
  ]),
  'proposal and submission service workflows',
)

addCheck(
  'task plaza',
  'task plaza includes taker and publisher rankings',
  includesAll(app, [
    'type MarketplaceProfile',
    'marketplaceProfiles',
    'function LeaderboardPanel',
    'leaderboard-grid',
    '接单排行榜',
    '发需求排行榜',
    "rankProfiles('maker')",
    "rankProfiles('publisher')",
  ]) &&
    includesAll(css, ['.leaderboard-grid', '.leaderboard-panel', '.rank-row', '.rank-metric']),
  'shared profile data drives maker and publisher ranking panels',
)

addCheck(
  'task plaza',
  'task publisher names open public profiles from proposal-mode details',
  includesAll(app, ['const openProfile = (profile: MarketplaceProfile)', 'publisherProfile', 'profile-link', 'openProfile(publisherProfile)', 'Proposal mode']),
  'task detail publisher link',
)

addCheck(
  'publish',
  'publish form simulates core fields and acceptance rules',
  includesAll(app, ['Task title', 'Category', 'Reward', 'Deadline', 'Visibility', 'Requirement details', 'Submission and acceptance rules']),
  'publish form fields',
)

addCheck(
  'publish',
  'publish flow creates an API-backed task and selects it',
  includesAll(app, ['const publishTask = async (draft: PublishDraft)', 'taskService.create(draft)', 'setTaskList((current) => [newTask, ...current])', 'setSelectedTask(newTask)', "setPage('tasks')"]),
  'API publish flow',
)

addCheck(
  'publish',
  'publish form recommends makers by content, category, and tags',
  includesAll(app, [
    'function matchProfilesForDraft',
    'profileMatchScore',
    'recommendedProfiles',
    'matchProfilesForDraft(draft)',
    'Recommended makers',
    '推荐接单用户',
    'Category match',
    'Chinese ready',
    'Invited @',
  ]) &&
    includesAll(css, ['.match-panel', '.match-card', '.match-card-top', '.compact-buttons']),
  'front-end matching cards update from draft content and can invite/view profile',
)

addCheck(
  'my tasks',
  'my task desk simulates claimed/submitted/completed delivery tracking',
  includesAll(app, ['Posted', 'Accepted', 'Review acceptance', 'Discussion record', 'Submit acceptance work', 'Publisher review fields']),
  'task desk lifecycle',
)

addCheck(
  'community',
  'community data supports forum metrics and solved state',
  includesAll(app, ['views: string', 'votes: number', 'solved: boolean']),
  'views, votes, solved',
)

addCheck(
  'community',
  'community UI supports sorting, conversion, and library saving',
  includesAll(app, ['Questions', 'Task recap', 'Unanswered', 'Turn into task', 'Add to library', 'Hot right now', '标签']),
  'sorting, task conversion, library saving, sidebar browsing',
)

addCheck(
  'community',
  'community actions convert tasks, save library items, and update discussions',
  includesAll(app, [
    'const convertPostToTask = async (post: Post)',
    'const savePostToLibrary = async (post: Post)',
    'const likePost = async (post: Post)',
    'const replyToPost = async (post: Post, replyText?: string)',
    'communityService.convertPostToTask',
    'communityService.savePostToLibrary',
    'setPostList((current) => current.map((item) => (item.id === post.id ? updated : item)))',
    'setLibraryItems((current) => [nextItem, ...current])',
  ]),
  'like, reply, convert, save flows',
)

addCheck(
  'community',
  'community replies use a real editable input',
  includesAll(app, [
    'const [replyDraft, setReplyDraft]',
    'const submitReply = ()',
    'reply-box',
    'localReplies',
  ]),
  'editable reply composer',
)

addCheck(
  'community',
  'community topic list is table-style like the reference forum',
  includesAll(app, ['forum-main', 'topic-table', 'topic-head', 'topic-row active', 'topic-title-button', 'topic-stat', 'topic-meta-line']) &&
    includesAll(css, ['.topic-table', 'grid-template-columns: minmax(0, 1fr) 70px 76px 82px 92px', '.topic-title-text', '.topic-meta-line', '.topic-stat']),
  'topic table with title, tags, metrics, and status columns',
)

addCheck(
  'community',
  'community topic list supports pagination',
  includesAll(app, ['const [topicPage, setTopicPage]', 'topicsPerPage', 'visibleTopics', 'topic-pagination', 'topic-page-numbers', 'goToTopicPage', '`Page ${safeTopicPage} / ${totalTopicPages}`', 'Prev', 'Next']) &&
    includesAll(css, ['.topic-pagination', '.topic-pagination .ghost-button:disabled', '.topic-page-numbers', '.page-number.active']),
  'topic pagination state and controls',
)

addCheck(
  'community',
  'community detail actions use compact toolbar labels',
  includesAll(app, ['post-action-bar', 'compact-action', "'Turn into task'", "'转成任务'", "'任务'", "'入库'", "'Library'", "setCommunityView('detail')", "setCommunityView('list')", "'返回列表'"]) &&
    includesAll(css, ['.post-action-bar', 'repeat(5, minmax(72px, 1fr))', '.compact-action', 'text-overflow: ellipsis']),
  'compact action toolbar avoids squeezed long button text',
)

addCheck(
  'community',
  'community has enough mock topics/posts for forum simulation',
  countMatches(app, /title: '.*?'/g) >= 12 && includesAll(app, ['Hot right now', 'hotPosts', 'topic-state solved', '标签']),
  'post list, hot topics, solved state, sidebar tags',
)

addCheck(
  'publish',
  'publish form uses field-level AI buttons instead of the removed task engine',
  includesAll(app, ['improveDraftField', 'renderAiButton', 'ai-field-button', "renderAiButton('title')", "renderAiButton('details')", "renderAiButton('rules')"]) &&
    !includesAll(app, ["renderAiButton('reward')", "renderAiButton('deadline')"]) &&
    !includesAll(app, ['EnginePage', "setPage('engine')", 'Requirement splitter']),
  'publish AI controls and removed engine route',
)

addCheck(
  'creation tools',
  'music, chat, image, and video workspaces exist',
  includesAll(app, ['Create AI songs and voice assets', 'Chat workspace', 'Image Studio', 'Video Studio', 'Text to Video', 'Image to Video']),
  'create/chat/image/video modules',
)

addCheck(
  'creation tools',
  'simulated music and video studio controls remain explicit',
  includesAll(app, [
    'Selected tool: ${tool.label}',
    '已加入生成队列',
    'const runStudioGenerate = ()',
    '已重新混合',
    '已选择生成模式',
  ]),
  'tool selection, studio generate, remix feedback',
)

addCheck(
  'creation tools',
  'Chat workspace uses the typed streaming API and recoverable server history',
  includesAll(app, [
    'chatService.listConversations',
    'chatService.listMessages',
    'chatService.listInputAssets',
    'chatService.streamTurn',
    'chatService.stopTurn',
    'chatService.deleteConversation',
    'openModerationAppeal',
  ]) && !app.includes('Drafted. You can send this'),
  'conversation history, SSE, stop, deletion, governed inputs, and safety appeal',
)

addCheck(
  'creation tools',
  'Image Studio uses provider-backed creative generation path',
  includesAll(app, [
    'creativeService.createGeneration',
    'creativeService.listProviders',
    'creativeService.listGenerations',
    'creativeService.generation',
    'mediaService.createDownload',
    "workspace: 'image'",
    "'text_to_image' | 'image_to_image' | 'image_edit' | 'image_variation'",
    'image-generation-history',
    '!providerGeneration && results.map',
  ]),
  'typed generation/history services, lifecycle UI, governed download contract, and no Image demo result fallback',
)

addCheck(
  'points',
  'points ledger and reward redemption are represented',
  includesAll(app, ['Points history', 'Balance', 'Pending', 'Rank', 'Redeem', 'pointsLedger']),
  'ledger and redemption cards',
)

addCheck(
  'inspiration',
  'inspiration library supports detail pages and conversion actions',
  includesAll(app, [
    'Opened inspiration detail',
    'Converted inspiration to task draft',
    'Sent inspiration to workspace',
    "setPage('publish')",
    "setPage('playground')",
    'library-save-count',
    'library-detail',
  ]) &&
    includesAll(css, [
      '.library-save-count',
      'position: absolute',
      '.library-detail',
    ]),
  'detail view, task/workspace conversion, and absolute save count',
)

addCheck(
  'points',
  'point ledger updates during simulated flows',
  includesAll(app, ['const pushLedger = (description: string, delta: string)', 'setLedgerItems((current)', 'Published task:', 'Submitted proposal draft:', 'Submitted deliverable:', 'Accepted task:']),
  'ledger update flow',
)

addCheck(
  'profile',
  'public user profile is visible without real login',
  includesAll(app, [
    'function ProfilePage',
    'profile: MarketplaceProfile',
    'Public profile',
    '公开主页',
    'profile-shell',
    'profile-proof-grid',
    'Related users',
    'People to compare',
    "page === 'profile'",
  ]) &&
    includesAll(css, ['.profile-shell', '.profile-card', '.profile-cover', '.profile-avatar', '.profile-stats', '.profile-layout-grid']),
  'profile page uses marketplace profile data and does not require auth',
)

addCheck(
  'profile',
  'profile entry points are wired from library, search, rankings, and matching',
  includesAll(app, [
    'openProfile(accountProfile)',
    'personalProfileId',
    'MyTasksPage t={t} tasks={tasks}',
    'openProfile={openProfile}',
    'Search result opened',
    'openProfile(profile)',
    'openProfile(item)',
    'openProfile={openProfile}',
  ]),
  'multiple routes to public profile',
)

addCheck(
  'admin',
  'admin review queue has moderation actions',
  includesAll(app, ['Review and moderation', 'Task review', 'Submissions', 'Community', 'AI config', 'Reject', 'Approve']),
  'admin queue and actions',
)

addCheck(
  'admin',
  'admin role permissions can be edited and saved',
  includesAll(app, ['Role permission matrix', 'permissionDraft', 'togglePermissionDraft', 'saveRolePermissions', 'adminService.updateRolePermissions']),
  'role permission matrix editing',
)

addCheck(
  'admin',
  'admin tabs and review actions have service-backed feedback',
  includesAll(app, ['管理中心已切换', 'reviewQueueItem', 'adminService.reviewQueueItem', 'queueStatus', 'auditStatus', 'scanJobArchive', 'writeScanJobArchive', 'MediaScanJobArchiveManifest', 'MediaScanJobArchiveResult']),
  'admin tab feedback and queue review flow',
)

addCheck(
  'admin',
  'admin security events and alerts are queryable from the security panel',
  includesAll(app, ['Security event stream', 'adminService.securityEvents', 'adminService.securityAlerts', 'adminService.securityAlertEvents', 'adminService.exportSecurityAlertJson', 'acknowledgeSecurityAlert', 'silenceSecurityAlert', 'unsilenceSecurityAlert', 'canManageSecurityAlerts', 'security:alerts:manage', 'alert_dispatch', 'recentChannels', 'recentErrors', 'highlightedSecurityAlertId', 'securityAlertStatus', 'securitySourceFilter', 'admin-security-alerts', 'admin-security-events']),
  'security alert summaries, disposition actions, deep links, exports, samples, and event stream filters',
)

addCheck(
  'admin',
  'admin operations metrics render in the security dashboard',
  includesAll(app, ['operationsMetrics(windowMinutes', 'exportOperationsMetricsJson', 'AdminOperationsMetricsDto', '/admin/operations/metrics', '/admin/operations/metrics/export', 'admin-operations-metrics', 'operationsMetricsWindow', 'Operations metrics', 'Archive candidates', 'writeScanArchiveFromMetrics', 'Audit dispatches', 'media.scan.history_pruned', 'toggleOperationSamples', 'operations-sample-panel', 'Recent failures', 'Archive records', 'exportOperationsSnapshot', 'Export snapshot', 'buildOperationsHandoff', 'remediationHints', 'Handoff notes', 'admin.operations.metrics_exported', 'operations_metrics', 'openOperationsMetricsFromAudit', 'operationSampleCountLabel', 'Open metrics window']),
  'admin operations metrics dashboard actions, auditable export, and audit replay entry',
)

addCheck(
  'admin',
  'admin generation history exposes permission-scoped creative operations',
  includesAll(app, ['admin-generation-history', 'Generation history', 'adminService.creativeGenerations', 'adminService.creativeGeneration', 'cancelCreativeGeneration', 'requestCreativeGenerationRetry', 'requestCreativeGenerationManualReplay', 'runGenerationMutation', 'admin:creative:cancel', 'admin:creative:retry', 'admin:creative:replay', 'generationRows', 'generationNextCursor', 'toggleGenerationDetail', 'loadMoreGenerations', 'focusGenerationMediaAsset', 'creative_generation', 'promptHash', 'outputAssetIds', 'retryOfId', 'attemptNumber', 'providerReplayEvidence', 'mutationEvidence']),
  'typed generation history, safe mutation controls, child-attempt evidence, reviewed replay, media links, and audit links',
)

addCheck(
  'cross-module',
  'cross-module flows are wired with setPage transitions',
  includesAll(app, [
    "setPage('publish')",
    "setPage('tasks')",
    "setPage('community')",
    "setPage('inspiration')",
    "setPage('playground')",
  ]),
  'publish/tasks/community/inspiration/playground transitions',
)

addCheck(
  'auth simulation',
  'auth-gated actions open the login modal',
  includesAll(app, ['const requireAuth = () => setLoginOpen(true)', 'LoginModal', "'google'", "'discord'", 'Continue with ${provider.label}']),
  'simulated login gate',
)

addCheck(
  'localization',
  'default locale is English and Chinese toggle exists',
  includesAll(app, ["useState<Locale>('en')", "locale === 'en' ? 'zh' : 'en'", '中文', 'English']),
  'default English, toggle to Chinese',
)

const switchLocaleBlock = app.slice(
  app.indexOf('  const switchLocale = () => {'),
  app.indexOf('  useEffect(() => {\n    window.scrollTo'),
)

addCheck(
  'localization',
  'language toggle preserves the current page context',
  switchLocaleBlock.includes('setLocale(nextLocale)') &&
    !/set(Page|SelectedTask|SelectedPost|Prompt|CommunityView|SelectedSearchFilter)\(/.test(switchLocaleBlock) &&
    !app.includes('key={locale}') &&
    !app.includes('key={`${locale}-'),
  'locale toggle should not navigate, reset selected content, reset prompts, or remount pages',
)

addCheck(
  'localization',
  'core Chinese copy is valid UTF-8 content',
  includesAll(app, ['任务广场', '创作者社区', '发布需求', '我的任务', '灵感库', '积分奖励', '管理中心']) &&
    !/[�]/.test(app) &&
    !/[鎼鐧骞垮満涓绀惧尯]/.test(app),
  'core Chinese labels and no mojibake markers',
)

addCheck(
  'localization',
  'Chinese sample content supports real interaction review',
  includesAll(app, [
    '制作一套中文 AI 课程宣传短视频',
    '生成小红书美妆产品图提示词包',
    '整理企业知识库 AI 问答机器人需求',
    '中文课程广告 AI 配音与字幕交付',
    '国风 Lo-fi 歌单开场音乐制作',
    'AI 任务二次提交说明模板优化',
    '中文任务复盘：AI 课程短视频如何写验收标准？',
    '中文提问：任务被驳回后怎么写二次提交说明？',
    '教程：用 AI 对话把模糊需求拆成可验收任务',
    '中文短视频任务验收模板',
    'AI 任务二次提交说明模板',
    '小红书封面提示词包',
    '已发布任务',
    '已接取任务',
    '已提交成果',
    '已收入灵感库',
  ]),
  'Chinese task, post, library, and ledger content',
)

addCheck(
  'interaction feedback',
  'all buttons declare explicit click handlers',
  !/<button(?![\s\S]*?>[\s\S]*?<\/button>)[\s\S]*?>/.test('') &&
    [...app.matchAll(/<button[\s\S]*?>/g)].every((match) => match[0].includes('onClick')),
  'button tags should include onClick for visible feedback',
)

addCheck(
  'interaction feedback',
  'global button styles prevent broken text wrapping',
  includesAll(css, ['white-space: nowrap', 'line-height: 1', '.button-row', 'flex-wrap: wrap']),
  'buttons keep labels intact and rows can wrap',
)

addCheck(
  'interaction feedback',
  'core chips and filters maintain active local state',
  includesAll(app, [
    'const [activeCategory, setActiveCategory]',
    'const [selectedFeature, setSelectedFeature]',
    'const [activeOption, setActiveOption]',
    'const [activeControls, setActiveControls]',
    'const [activeTab, setActiveTab]',
    'setCommunityFilter(filter)',
  ]),
  'task, community, studio, admin, profile, inspiration active states',
)

addCheck(
  'interaction feedback',
  'search and login controls provide visible API feedback',
  includesAll(app, [
    "const [query, setQuery] = useState('')",
    'Search result opened',
    'Search result played',
    'close()',
    'listOAuthProviders()',
    'oauthErrorCopy',
    'loginWithOAuthProvider(provider.provider)',
    'Signed in with ${provider.label}',
    'Redirecting to ${provider.label}',
    'oauth-mode-badge',
  ]),
  'search tags/results and OAuth providers expose status and react',
)

addCheck(
  'interaction feedback',
  'dynamic island guide routes core workflows',
  includesAll(app, [
    'function DynamicIsland',
    "aria-label={isZh ? 'AI 灵动岛指引' : 'AI dynamic island guide'}",
    "setPage(action.page)",
    '灵动岛已跳转',
    'Dynamic island routed',
    '我要发布任务 / 找任务赚钱 / 看社区 / 生成图片 / 做视频',
    "page: 'tasks'",
    "page: 'publish'",
    "page: 'community'",
    "page: 'playground'",
    "page: 'chat'",
  ]) &&
    includesAll(css, [
      '.ai-island',
      '.ai-island.open',
      '.island-compact',
      '.island-command',
      '@keyframes island-shimmer',
    ]),
  'floating AI guide with shortcuts, command input, and workflow routing',
)

addCheck(
  'responsive ui',
  'responsive styles cover new module layouts',
  includesAll(css, ['.form-layout', '.ai-field-button', '.community-layout', '.detail-section-grid', '.ledger-row', '.admin-row', '.empty-state', '.sidebar.mobile-expanded', '@media (max-width: 860px)']),
  'desktop, empty state, and mobile navigation layout contracts',
)

addCheck(
  'responsive ui',
  'community reading styles improve clarity and Chinese text rendering',
  includesAll(css, [
    '"Microsoft YaHei UI"',
    '.post-body',
    '.reply-box textarea',
    '.comment-heading',
    'overflow-wrap: anywhere',
  ]),
  'Chinese font fallback, post body, reply, and wrapping styles',
)

addCheck(
  'feedback',
  'interactive flows keep local simulation feedback without a fixed toast',
  includesAll(app, ['const pushToast = (message: string)', "console.info('[simulation]', message)", 'simulateAction={simulateAction}']) &&
    !includesAll(app, ['role="status"', 'Ready to test the AI task workflow.']) &&
    !css.includes('.toast'),
  'simulation feedback remains wired without the removed toast UI',
)

addCheck(
  'prototype boundary',
  'README documents feature scope, API auth, and remaining simulated surfaces',
  includesAll(readme, ['front-end prototype', 'Login, registration, OAuth dev callback, logout, and auth-gated actions backed by the API', 'creative outputs']),
  'prototype boundary and API auth language',
)

addCheck(
  'prototype boundary',
  'runtime data sources are visible in the shell and home page',
  includesAll(app, ['accountSource', 'accountReady', 'data-source-panel', 'Demo fallback', 'Mock workspace', 'API session']),
  'visible API/demo data source labels',
)

const grouped = checks.reduce((acc, check) => {
  acc[check.group] ??= []
  acc[check.group].push(check)
  return acc
}, {})

let failed = 0
for (const [group, groupChecks] of Object.entries(grouped)) {
  console.log(`\n${group}`)
  for (const check of groupChecks) {
    const mark = check.pass ? 'PASS' : 'FAIL'
    console.log(`  ${mark} ${check.name}`)
    if (!check.pass) {
      failed += 1
      console.log(`       ${check.detail}`)
    }
  }
}

const passed = checks.length - failed
console.log(`\nSimulation checks: ${passed}/${checks.length} passed`)

if (failed > 0) {
  process.exitCode = 1
}
