import type { Dispatch, SetStateAction } from 'react'
import type {
  CommunityView,
  InspirationItem,
  LedgerEntry,
  Locale,
  MarketplaceProfile,
  Page,
  PlaygroundMode,
  Post,
  PublishDraft,
  Role,
  SimulateAction,
  Task,
  ThemeMode,
  Track,
} from '../../domain/types'

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

export type AccountViewModel = {
  accountProfile: MarketplaceProfile
  accountName: string
  currentPoints: string
  userRole: Role
  setUserRole: Dispatch<SetStateAction<Role>>
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

export type PageFeedbackViewModel = {
  simulateAction: SimulateAction
  requireAuth: () => void
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
  publishTask: (draft: PublishDraft) => void
  claimTask: (task: Task) => void
  submitTask: (task: Task) => void
  approveTask: (task: Task) => void
  rejectTask: (task: Task) => void
}

export type CommunityWorkflowViewModel = {
  postList: Post[]
  selectedPost: Post
  setSelectedPost: Dispatch<SetStateAction<Post>>
  communityFilter: string
  setCommunityFilter: Dispatch<SetStateAction<string>>
  communityView: CommunityView
  setCommunityView: Dispatch<SetStateAction<CommunityView>>
  convertPostToTask: (post: Post) => void
  savePostToLibrary: (post: Post) => void
  likePost: (post: Post) => void
  replyToPost: (post: Post, replyText?: string) => void
  libraryItems: InspirationItem[]
}

export type RewardsViewModel = {
  ledgerItems: LedgerEntry[]
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
