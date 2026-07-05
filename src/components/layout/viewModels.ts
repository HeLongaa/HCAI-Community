import type { Dispatch, SetStateAction } from 'react'
import type {
  AsyncResourceState,
  CommunityView,
  InspirationItem,
  LedgerEntry,
  Locale,
  MarketplaceProfile,
  Page,
  Permission,
  NotificationDeepLink,
  PlaygroundMode,
  Post,
  PublishDraft,
  Role,
  SimulateAction,
  Task,
  ThemeMode,
  Track,
} from '../../domain/types'
import type { TaskChildCollection } from '../../hooks/useTaskWorkflows'
import type { OAuthLoginResult } from '../../hooks/useAccountState'
import type { ApiNotification, ApiPointsSummary, ApiTaskProposal, ApiTaskSubmission, NotificationListQuery, OAuthProvider } from '../../services/contracts'

export type AppCopyViewModel = {
  t: Record<string, string>
  locale: Locale
  switchLocale: () => void
}

export type ShellNavigationViewModel = {
  page: Page
  parentPage: Page | null
  navigatePrimary: (page: Page, workspace?: PlaygroundMode) => void
  navigateToPage: (page: Page, workspace?: PlaygroundMode) => void
  navigateBackToParent: () => void
}

export type PageNavigationViewModel = Pick<ShellNavigationViewModel, 'page' | 'navigateToPage'>

export type PageAccountViewModel = Pick<AccountViewModel, 'accountHandle' | 'hasPermission' | 'permissions' | 'userRole'>

export type DataSourceState = {
  label: string
  state: 'api' | 'loading' | 'fallback' | 'stored' | 'mock'
  detail: string
}

export type AccountViewModel = {
  accountProfile: MarketplaceProfile
  accountName: string
  accountHandle: string
  accountSource: 'api' | 'stored' | 'fallback'
  accountReady: boolean
  currentPoints: string
  userRole: Role
  permissions: Permission[]
  hasPermission: (permission: Permission) => boolean
  setUserRole: Dispatch<SetStateAction<Role>>
  loginAs: (handle: string) => Promise<void>
  loginWithPassword: (email: string, password: string) => Promise<void>
  loginWithOAuthProvider: (provider: OAuthProvider) => Promise<OAuthLoginResult>
  registerWithEmail: (payload: { email: string; password: string; displayName?: string; handle?: string }) => Promise<void>
  logout: () => Promise<void>
  openProfile: (profile: MarketplaceProfile) => void
}

export type ThemeViewModel = {
  themeMode: ThemeMode
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>
}

export type ChromeViewModel = {
  sidebarCollapsed: boolean
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>
  searchOpen: boolean
  setSearchOpen: Dispatch<SetStateAction<boolean>>
  loginOpen: boolean
  setLoginOpen: Dispatch<SetStateAction<boolean>>
}

export type PlayerViewModel = {
  activeTrack: Track
  playing: boolean
  setPlaying: Dispatch<SetStateAction<boolean>>
  playTrack: (track: Track) => void
}

export type FeedbackViewModel = {
  pushToast: (message: string) => void
  simulateAction: SimulateAction
}

export type NotificationCenterViewModel = {
  items: ApiNotification[]
  loading: boolean
  error: string | null
  readState: NonNullable<NotificationListQuery['readState']>
  setReadState: Dispatch<SetStateAction<NonNullable<NotificationListQuery['readState']>>>
  refresh: () => Promise<void>
  markRead: (notification: ApiNotification) => Promise<void>
  markAllRead: () => Promise<void>
  openResource: (notification: ApiNotification) => void
}

export type AdminPageViewModel = {
  deepLink: NotificationDeepLink['admin'] | null
  clearDeepLink: () => void
  openNotificationResource: (notification: ApiNotification) => void
}

export type PageFeedbackViewModel = {
  simulateAction: SimulateAction
  requireAuth: () => void
}

export type HomeDataSourceViewModel = {
  sources: DataSourceState[]
}

export type WorkspaceViewModel = {
  prompt: string
  setPrompt: Dispatch<SetStateAction<string>>
  generationState: 'idle' | 'loading' | 'done'
  runGenerate: () => void
  playgroundWorkspace: PlaygroundMode
  setPlaygroundWorkspace: Dispatch<SetStateAction<PlaygroundMode>>
}

export type TaskWorkflowViewModel = {
  taskList: Task[]
  selectedTask: Task
  setSelectedTask: Dispatch<SetStateAction<Task>>
  taskStatus: AsyncResourceState
  proposalStateByTask: Record<string, TaskChildCollection<ApiTaskProposal>>
  submissionStateByTask: Record<string, TaskChildCollection<ApiTaskSubmission>>
  publishTask: (draft: PublishDraft) => Promise<void>
  claimTask: (task: Task) => Promise<void>
  submitProposal: (task: Task) => Promise<void>
  refreshProposals: (task: Task) => Promise<void>
  acceptProposal: (task: Task, proposalId: string) => Promise<void>
  rejectProposal: (task: Task, proposalId: string) => Promise<void>
  refreshSubmissions: (task: Task) => Promise<void>
  submitTask: (task: Task, options?: { assetIds?: string[]; rightsNote?: string }) => Promise<void>
  approveTask: (task: Task) => Promise<void>
  rejectTask: (task: Task) => Promise<void>
}

export type CommunityWorkflowViewModel = {
  postList: Post[]
  selectedPost: Post
  setSelectedPost: Dispatch<SetStateAction<Post>>
  communityFilter: string
  setCommunityFilter: Dispatch<SetStateAction<string>>
  communityView: CommunityView
  setCommunityView: Dispatch<SetStateAction<CommunityView>>
  communityStatus: AsyncResourceState
  convertPostToTask: (post: Post) => Promise<void>
  savePostToLibrary: (post: Post) => Promise<void>
  likePost: (post: Post) => Promise<void>
  replyToPost: (post: Post, replyText?: string) => Promise<void>
  libraryItems: InspirationItem[]
}

export type RewardsViewModel = {
  ledgerItems: LedgerEntry[]
  pointsSummary: ApiPointsSummary | null
  pointsStatus: AsyncResourceState
}

export type BillingViewModel = {
  billing: 'year' | 'month'
  setBilling: Dispatch<SetStateAction<'year' | 'month'>>
}

export type ProfileViewModel = {
  selectedProfile: MarketplaceProfile
  accountProfile: MarketplaceProfile
  openProfile: (profile: MarketplaceProfile) => void
}
