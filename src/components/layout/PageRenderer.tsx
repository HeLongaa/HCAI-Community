import type {
  BillingViewModel,
  AdminPageViewModel,
  CommunityWorkflowViewModel,
  HomeDataSourceViewModel,
  PageAccountViewModel,
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
import { AboutPage, ApiPage, EarnPage, LegalPage, PricingPage, SupportPage } from '../../features/static-pages'
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
  homeDataSources: HomeDataSourceViewModel
  account: PageAccountViewModel
  billing: BillingViewModel
  profile: ProfileViewModel
  admin: AdminPageViewModel
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
  homeDataSources,
  account,
  billing: billingState,
  profile,
  admin,
}: PageRendererProps) {
  const { page, navigateToPage } = navigation
  const { prompt, setPrompt, generationState, runGenerate, imageGeneration, runImageGeneration, playgroundWorkspace, setPlaygroundWorkspace } = workspace
  const { playTrack } = player
  const { requireAuth, simulateAction } = feedback
  const {
    taskList,
    selectedTask,
    setSelectedTask,
    taskStatus,
    proposalStateByTask,
    submissionStateByTask,
    timelineStateByTask,
    publishTask,
    submitProposal,
    refreshProposals,
    acceptProposal,
    rejectProposal,
    refreshSubmissions,
    refreshTimeline,
    submitTask,
    approveTask,
    rejectTask,
    requestRevisionTask,
    openDisputeTask,
  } = tasks
  const {
    postList,
    selectedPost,
    setSelectedPost,
    communityFilter,
    setCommunityFilter,
    communityView,
    setCommunityView,
    communityStatus,
    convertPostToTask,
    savePostToLibrary,
    likePost,
    replyToPost,
    libraryItems,
  } = community
  const { ledgerItems, pointsSummary, pointsStatus } = rewards
  const { billing, setBilling } = billingState
  const { selectedProfile, accountProfile, openProfile } = profile

  return (
    <>
      {page === 'home' && <HomePage t={t} setPage={navigateToPage} playTrack={playTrack} dataSources={homeDataSources.sources} />}
      {page === 'playground' && (
        <PlaygroundPage
          t={t}
          prompt={prompt}
          setPrompt={setPrompt}
          generationState={generationState}
          runGenerate={runGenerate}
          imageGeneration={imageGeneration}
          runImageGeneration={runImageGeneration}
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
          submitProposal={submitProposal}
          selectedTask={selectedTask}
          setSelectedTask={setSelectedTask}
          status={taskStatus}
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
      {page === 'mine' && (
        <MyTasksPage
          t={t}
          tasks={taskList}
          setPage={navigateToPage}
          accountHandle={account.accountHandle}
          proposalStateByTask={proposalStateByTask}
          submissionStateByTask={submissionStateByTask}
          timelineStateByTask={timelineStateByTask}
          refreshProposals={refreshProposals}
          acceptProposal={acceptProposal}
          rejectProposal={rejectProposal}
          refreshSubmissions={refreshSubmissions}
          refreshTimeline={refreshTimeline}
          submitTask={submitTask}
          approveTask={approveTask}
          rejectTask={rejectTask}
          requestRevisionTask={requestRevisionTask}
          openDisputeTask={openDisputeTask}
          simulateAction={simulateAction}
        />
      )}
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
          status={communityStatus}
          simulateAction={simulateAction}
        />
      )}
      {page === 'inspiration' && <InspirationPage t={t} items={libraryItems} setPage={navigateToPage} simulateAction={simulateAction} />}
      {page === 'points' && <PointsPage t={t} ledger={ledgerItems} summary={pointsSummary} status={pointsStatus} simulateAction={simulateAction} />}
      {page === 'admin' && (
        <AdminPage
          t={t}
          setPage={navigateToPage}
          simulateAction={simulateAction}
          account={account}
          deepLink={admin.deepLink}
          onDeepLinkHandled={admin.clearDeepLink}
          onOpenNotificationResource={admin.openNotificationResource}
        />
      )}
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
      {page === 'terms' && <LegalPage policyId="terms" t={t} setPage={navigateToPage} />}
      {page === 'privacy' && <LegalPage policyId="privacy" t={t} setPage={navigateToPage} />}
      {page === 'aup' && <LegalPage policyId="acceptable-use" t={t} setPage={navigateToPage} />}
      {page === 'disclosures' && <LegalPage policyId="provider-disclosure" t={t} setPage={navigateToPage} />}
      {page === 'support' && (
        <SupportPage
          key={account.accountHandle || 'guest'}
          t={t}
          signedIn={Boolean(account.accountHandle)}
          requireAuth={requireAuth}
          simulateAction={simulateAction}
        />
      )}
    </>
  )
}
