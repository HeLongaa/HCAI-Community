import type {
  BillingViewModel,
  CommunityWorkflowViewModel,
  PageFeedbackViewModel,
  PageNavigationViewModel,
  PlayerViewModel,
  ProfileViewModel,
  RewardsViewModel,
  TaskWorkflowViewModel,
  WorkspaceViewModel,
} from './viewModels'
import { HomePage } from '../prototype/PrototypeComponents'
import { AdminPage } from '../../features/admin'
import { CommunityPage } from '../../features/community'
import { ExplorePage } from '../../features/explore'
import { InspirationPage } from '../../features/inspiration'
import { PlaylistPage, ProfilePage } from '../../features/profile'
import { PointsPage } from '../../features/rewards'
import { AboutPage, ApiPage, EarnPage, LegalPage, PricingPage } from '../../features/static-pages'
import { MyTasksPage, PublishPage, TasksPage } from '../../features/tasks'
import { ChatPage, PlaygroundPage } from '../../features/workspace'

type PageRendererProps = {
  t: Record<string, string>
  navigation: PageNavigationViewModel
  workspace: WorkspaceViewModel
  player: Pick<PlayerViewModel, 'playTrack'>
  feedback: PageFeedbackViewModel
  tasks: TaskWorkflowViewModel
  community: CommunityWorkflowViewModel
  rewards: RewardsViewModel
  billing: BillingViewModel
  profile: ProfileViewModel
}

export function PageRenderer({
  t,
  navigation,
  workspace,
  player,
  feedback,
  tasks,
  community,
  rewards,
  billing: billingState,
  profile,
}: PageRendererProps) {
  const { page, navigateToPage } = navigation
  const { prompt, setPrompt, generationState, runGenerate, playgroundWorkspace, setPlaygroundWorkspace } = workspace
  const { playTrack } = player
  const { requireAuth, simulateAction } = feedback
  const {
    taskList,
    selectedTask,
    setSelectedTask,
    publishTask,
    claimTask,
    submitTask,
    approveTask,
    rejectTask,
  } = tasks
  const {
    postList,
    selectedPost,
    setSelectedPost,
    communityFilter,
    setCommunityFilter,
    communityView,
    setCommunityView,
    convertPostToTask,
    savePostToLibrary,
    likePost,
    replyToPost,
    libraryItems,
  } = community
  const { ledgerItems } = rewards
  const { billing, setBilling } = billingState
  const { selectedProfile, accountProfile, openProfile } = profile

  return (
    <>
      {page === 'home' && <HomePage t={t} setPage={navigateToPage} playTrack={playTrack} />}
      {page === 'playground' && (
        <PlaygroundPage
          t={t}
          prompt={prompt}
          setPrompt={setPrompt}
          generationState={generationState}
          runGenerate={runGenerate}
          playTrack={playTrack}
          requireAuth={requireAuth}
          simulateAction={simulateAction}
          workspace={playgroundWorkspace}
          setWorkspace={setPlaygroundWorkspace}
          setPage={navigateToPage}
        />
      )}
      {page === 'chat' && <ChatPage t={t} setPage={navigateToPage} simulateAction={simulateAction} />}
      {page === 'explore' && (
        <ExplorePage t={t} playTrack={playTrack} setPage={navigateToPage} requireAuth={requireAuth} />
      )}
      {page === 'tasks' && (
        <TasksPage
          t={t}
          tasks={taskList}
          setPage={navigateToPage}
          openProfile={openProfile}
          claimTask={claimTask}
          selectedTask={selectedTask}
          setSelectedTask={setSelectedTask}
          simulateAction={simulateAction}
        />
      )}
      {page === 'publish' && (
        <PublishPage
          t={t}
          setPage={navigateToPage}
          requireAuth={requireAuth}
          publishTask={publishTask}
          openProfile={openProfile}
          simulateAction={simulateAction}
        />
      )}
      {page === 'mine' && <MyTasksPage t={t} tasks={taskList} setPage={navigateToPage} submitTask={submitTask} simulateAction={simulateAction} />}
      {page === 'community' && (
        <CommunityPage
          t={t}
          posts={postList}
          convertPostToTask={convertPostToTask}
          savePostToLibrary={savePostToLibrary}
          likePost={likePost}
          replyToPost={replyToPost}
          openProfile={openProfile}
          selectedPost={selectedPost}
          setSelectedPost={setSelectedPost}
          communityFilter={communityFilter}
          setCommunityFilter={setCommunityFilter}
          communityView={communityView}
          setCommunityView={setCommunityView}
          simulateAction={simulateAction}
        />
      )}
      {page === 'inspiration' && <InspirationPage t={t} items={libraryItems} setPage={navigateToPage} simulateAction={simulateAction} />}
      {page === 'points' && <PointsPage t={t} ledger={ledgerItems} simulateAction={simulateAction} />}
      {page === 'admin' && <AdminPage t={t} selectedTask={selectedTask} setPage={navigateToPage} approveTask={approveTask} rejectTask={rejectTask} simulateAction={simulateAction} />}
      {page === 'pricing' && <PricingPage t={t} billing={billing} setBilling={setBilling} requireAuth={requireAuth} />}
      {page === 'api' && <ApiPage t={t} requireAuth={requireAuth} simulateAction={simulateAction} />}
      {page === 'earn' && <EarnPage t={t} requireAuth={requireAuth} />}
      {page === 'about' && <AboutPage t={t} />}
      {page === 'playlist' && <PlaylistPage t={t} playTrack={playTrack} simulateAction={simulateAction} />}
      {page === 'profile' && (
        <ProfilePage
          key={selectedProfile.id}
          t={t}
          profile={selectedProfile}
          personalProfileId={accountProfile.id}
          tasks={taskList}
          setPage={navigateToPage}
          openProfile={openProfile}
          submitTask={submitTask}
          simulateAction={simulateAction}
        />
      )}
      {page === 'terms' && <LegalPage title={t.terms} t={t} />}
      {page === 'privacy' && <LegalPage title={t.privacy} t={t} />}
    </>
  )
}
