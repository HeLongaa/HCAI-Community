import fs from 'node:fs/promises'
import ts from 'typescript'
import { getPermissionsForRole } from '../auth/permissions.js'

const mockDataPath = new URL('../../../src/data/mockData.ts', import.meta.url)

const loadMockData = async () => {
  const source = await fs.readFile(mockDataPath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  })
  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`
  return import(dataUrl)
}

const mockData = await loadMockData()
const { inspirationItems, marketplaceProfiles, pointsLedger, posts, tasks } = mockData

const rawProfileByHandle = new Map(marketplaceProfiles.map((profile) => [profile.handle, profile]))

const parsePoints = (value) => {
  const cleaned = String(value).replace(/[^\d-]/g, '')
  const parsed = Number.parseInt(cleaned, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

const taskStatusMap = {
  Open: 'open',
  'In Progress': 'in_progress',
  'Pending Review': 'pending_review',
  Disputed: 'disputed',
  Completed: 'completed',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
}

const mapTask = (task) => {
  const publisherProfile = rawProfileByHandle.get(task.publisher)
  const assigneeProfile = task.assignee && task.assignee !== 'Unassigned' ? rawProfileByHandle.get(task.assignee) : null
  return {
    id: String(task.id),
    title: task.title,
    category: task.category,
    status: taskStatusMap[task.status] ?? 'open',
    budget: {
      money: task.budget,
      points: parsePoints(task.points),
    },
    deadline: task.deadline,
    proposals: task.proposals,
    description: task.description,
    publisher: publisherProfile
      ? {
          handle: publisherProfile.handle,
          name: publisherProfile.name,
          role: publisherProfile.role,
          lane: publisherProfile.lane,
          initials: publisherProfile.initials,
        }
      : { handle: task.publisher },
    assignee: assigneeProfile
      ? {
          handle: assigneeProfile.handle,
          name: assigneeProfile.name,
          role: assigneeProfile.role,
          lane: assigneeProfile.lane,
          initials: assigneeProfile.initials,
        }
      : null,
    requirements: task.requirements,
    attachments: task.attachments,
    privateBrief: task.privateBrief,
    submission: task.submission,
    resultLinks: task.resultLinks,
    reviewNote: task.reviewNote,
    rights: task.rights,
  }
}

const mapPost = (post) => {
  const authorProfile = rawProfileByHandle.get(post.author)
  return {
    id: String(post.id),
    title: post.title,
    category: post.category,
    author: authorProfile
      ? {
          handle: authorProfile.handle,
          name: authorProfile.name,
          role: authorProfile.role,
          lane: authorProfile.lane,
        }
      : { handle: post.author },
    replies: post.replies,
    likes: parsePoints(post.likes),
    views: parsePoints(post.views),
    votes: post.votes,
    tag: post.tag,
    solved: post.solved,
    excerpt: post.excerpt,
    body: post.body ?? null,
  }
}

const mapProfile = (profile) => ({
  handle: profile.handle,
  lane: profile.lane,
  initials: profile.initials,
  name: profile.name,
  role: profile.role,
  bio: profile.bio,
  tags: profile.tags,
  zhTags: profile.zhTags,
  categories: profile.categories,
  languages: profile.languages,
  stats: profile.stats,
  badges: profile.badges,
  portfolio: profile.portfolio,
  reviews: profile.reviews,
})

const ledgerUserHandles = ['taskops', 'promptlin', 'launchteam', 'legalpixel', 'opsplus']

const mapLedgerEntry = (entry, index) => ({
  id: `ledger-${String(index + 1).padStart(3, '0')}`,
  occurredAtLabel: entry[0],
  description: entry[1],
  delta: entry[2],
  balanceAfter: entry[3],
  status: 'settled',
  userHandle: ledgerUserHandles[index % ledgerUserHandles.length],
})

const profiles = marketplaceProfiles.map(mapProfile)
const tasksDto = tasks.map(mapTask)
const postsDto = posts.map(mapPost)
const pointsLedgerDto = pointsLedger.map(mapLedgerEntry)

const profileByHandle = new Map(profiles.map((profile) => [profile.handle, profile]))
const taskById = new Map(tasksDto.map((task) => [Number(task.id), task]))
const postById = new Map(postsDto.map((post) => [Number(post.id), post]))

const buildDemoAccount = ({ id, handle, email, displayName, role, permissions = getPermissionsForRole(role), profileHandle = handle }) => {
  const profile = rawProfileByHandle.get(profileHandle)
  return {
    id,
    handle,
    email,
    displayName,
    role,
    permissions,
    profile: profile
      ? {
          handle: profile.handle,
          lane: profile.lane,
        }
      : null,
    tokens: {
      accessToken: `demo-access.${handle}`,
      refreshToken: `demo-refresh.${handle}`,
    },
  }
}

const demoAccounts = [
  buildDemoAccount({
    id: 'demo-user-taskops',
    handle: 'taskops',
    email: 'creator@example.com',
    displayName: 'HCAI Creator',
    role: 'member',
  }),
  buildDemoAccount({
    id: 'demo-user-publisher',
    handle: 'launchteam',
    email: 'launchteam@example.com',
    displayName: 'Launch Team',
    role: 'publisher',
  }),
  buildDemoAccount({
    id: 'demo-user-creator',
    handle: 'promptlin',
    email: 'promptlin@example.com',
    displayName: 'Prompt Lin',
    role: 'creator',
  }),
  buildDemoAccount({
    id: 'demo-user-moderator',
    handle: 'legalpixel',
    email: 'legalpixel@example.com',
    displayName: 'Legal Pixel',
    role: 'moderator',
  }),
  buildDemoAccount({
    id: 'demo-user-admin',
    handle: 'opsplus',
    email: 'admin@example.com',
    displayName: 'OpsPlus Admin',
    role: 'admin',
  }),
  buildDemoAccount({
    id: 'demo-user-finops',
    handle: 'finops',
    email: 'finops@example.com',
    displayName: 'Finance Ops',
    role: 'admin',
    profileHandle: 'opsplus',
  }),
]

const demoAccountByHandle = new Map(demoAccounts.map((account) => [account.handle, account]))
const demoAccountByAccessToken = new Map(demoAccounts.map((account) => [account.tokens.accessToken, account]))
const demoAccountByRefreshToken = new Map(demoAccounts.map((account) => [account.tokens.refreshToken, account]))

const adminReviewQueue = [
  {
    id: 'review-1',
    status: 'Pending review',
    title: 'Music prompt pack',
    owner: 'soundforge',
    note: 'Release 1,200 pts after acceptance',
    queue: 'tasks',
  },
  {
    id: 'review-2',
    status: 'Resubmission',
    title: 'E-commerce image ad workflow',
    owner: 'shopstudio',
    note: 'Rejected once, needs category samples',
    queue: 'submissions',
  },
  {
    id: 'review-3',
    status: 'Community report',
    title: 'Pricing AI task delivery thread',
    owner: 'n8than',
    note: 'Potentially feature to library',
    queue: 'community',
  },
  {
    id: 'review-4',
    status: 'Publish audit',
    title: 'Product launch video brief',
    owner: 'launchteam',
    note: 'Check private attachment permissions',
    queue: 'tasks',
  },
]

export const seedStore = {
  me: demoAccounts[0],
  profiles,
  tasks: tasksDto,
  posts: postsDto,
  pointsLedger: pointsLedgerDto,
  inspirationItems,
  adminReviewQueue,
  demoAccounts,
  demoAccountByHandle,
  demoAccountByAccessToken,
  demoAccountByRefreshToken,
  taskById,
  postById,
  profileByHandle,
}
