import { lazy, Suspense, useState } from 'react'
import { useChatRuntimeReadiness } from '../../hooks/useChatRuntimeReadiness'
import type {
  BillingViewModel,
  AdminPageViewModel,
  CommunityWorkflowViewModel,
  PageAccountViewModel,
  PageFeedbackViewModel,
  PageNavigationViewModel,
  PlayerViewModel,
  ProfileViewModel,
  RewardsViewModel,
  TaskWorkflowViewModel,
  WorkspaceViewModel,
} from './viewModels'

const HomePage = lazy(() => import('../prototype/PrototypeComponents').then((module) => ({ default: module.HomePage })))
const AdminPage = lazy(() => import('../../features/admin').then((module) => ({ default: module.AdminPage })))
const CommunityPage = lazy(() => import('../../features/community').then((module) => ({ default: module.CommunityPage })))
const ExplorePage = lazy(() => import('../../features/explore').then((module) => ({ default: module.ExplorePage })))
const InspirationPage = lazy(() => import('../../features/inspiration').then((module) => ({ default: module.InspirationPage })))
const PlaylistPage = lazy(() => import('../../features/profile').then((module) => ({ default: module.PlaylistPage })))
const ProfilePage = lazy(() => import('../../features/profile').then((module) => ({ default: module.ProfilePage })))
const PointsPage = lazy(() => import('../../features/rewards').then((module) => ({ default: module.PointsPage })))
const AboutPage = lazy(() => import('../../features/static-pages').then((module) => ({ default: module.AboutPage })))
const EarnPage = lazy(() => import('../../features/static-pages').then((module) => ({ default: module.EarnPage })))
const LegalPage = lazy(() => import('../../features/static-pages').then((module) => ({ default: module.LegalPage })))
const PricingPage = lazy(() => import('../../features/static-pages').then((module) => ({ default: module.PricingPage })))
const SupportPage = lazy(() => import('../../features/static-pages').then((module) => ({ default: module.SupportPage })))
const DeveloperAccessPage = lazy(() => import('../../features/developer').then((module) => ({ default: module.DeveloperAccessPage })))
const MyTasksPage = lazy(() => import('../../features/tasks').then((module) => ({ default: module.MyTasksPage })))
const PublishPage = lazy(() => import('../../features/tasks').then((module) => ({ default: module.PublishPage })))
const TasksPage = lazy(() => import('../../features/tasks').then((module) => ({ default: module.TasksPage })))
const ChatPage = lazy(() => import('../../features/workspace').then((module) => ({ default: module.ChatPage })))
const PlaygroundPage = lazy(() => import('../../features/workspace').then((module) => ({ default: module.PlaygroundPage })))
const GenerationCenterPage = lazy(() => import('../../features/generations').then((module) => ({ default: module.GenerationCenterPage })))
const AssetLibraryPage = lazy(() => import('../../features/assets').then((module) => ({ default: module.AssetLibraryPage })))

type PageRendererProps = {
  t: Record<string, string>
  navigation: PageNavigationViewModel
  workspace: WorkspaceViewModel
  player: Pick<PlayerViewModel, 'playTrack'>
  feedback: PageFeedbackViewModel
  tasks: TaskWorkflowViewModel
  community: CommunityWorkflowViewModel
  rewards: RewardsViewModel
  account: PageAccountViewModel
  billing: BillingViewModel
  profile: ProfileViewModel
  admin: AdminPageViewModel
}

function RouteLoading({ label }: { label: string }) {
  return (
    <div className="route-loading product-route-loading" role="status" aria-live="polite">
      <header>
        <span />
        <strong>{label}</strong>
        <i />
      </header>
      <div className="route-loading-grid" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  )
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
  account,
  billing: billingState,
  profile,
  admin,
}: PageRendererProps) {
  const [supportAppeal, setSupportAppeal] = useState<{ moderationDecisionId: string } | null>(null)
  const { page, navigateToPage } = navigation
  const {
    imageGeneration,
    imageGenerationHistory,
    imageGenerationAction,
    imageGenerationFeedback,
    refreshImageGenerationHistory,
    selectImageGeneration,
    cancelImageGeneration,
    retryImageGeneration,
    downloadImageGenerationAsset,
    prepareImageAssetForReuse,
    hasImageGenerationRetryRequest,
    imageProviderCatalog,
    imageProviderCatalogState,
    refreshProviderCatalog,
    imageInputAssets,
    uploadImageInput,
    runImageGeneration,
    musicWorkflow,
    videoWorkflow,
    playgroundWorkspace,
    setPlaygroundWorkspace,
  } = workspace
  const chatRuntimeReadiness = useChatRuntimeReadiness(
    account.accountHandle && (page === 'chat' || (page === 'playground' && playgroundWorkspace === 'chat'))
      ? account.accountHandle
      : null,
  )
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
    workflowStateByTask,
    publishTask,
    submitProposal,
    refreshProposals,
    acceptProposal,
    rejectProposal,
    refreshSubmissions,
    refreshTimeline,
    refreshWorkflow,
    submitTask,
    approveTask,
    rejectTask,
    requestRevisionTask,
    openDisputeTask,
    cancelTask,
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
    myPosts,
    postMutationBusy,
    refreshMyPosts,
    createPost,
    updatePost,
    publishPost,
    deletePost,
  } = community
  const { pointsSummary } = rewards
  const { billing, setBilling } = billingState
  const { selectedProfile, accountProfile, profiles, openProfile, onProfileUpdated } = profile
  const openModerationAppeal = (moderationDecisionId: string) => {
    setSupportAppeal({ moderationDecisionId })
    navigateToPage('support')
  }

  return (
    <Suspense fallback={<RouteLoading label={t.loading ?? 'Loading'} />}>
      {page === 'home' && (
        <HomePage
          t={t}
          setPage={navigateToPage}
          openWorkspace={(mode) => {
            setPlaygroundWorkspace(mode)
            navigateToPage('playground')
          }}
          tasks={taskList}
          posts={postList}
          accountHandle={account.accountHandle}
          accountName={account.accountName}
          generationCount={imageGenerationHistory.items.length}
          reusableAssetCount={imageInputAssets.length}
          latestGeneration={imageGenerationHistory.items[0] ?? null}
          latestImageUrl={imageGeneration.result?.outputs.find((output) => output.type === 'image')?.url ?? null}
        />
      )}
      {page === 'playground' && (
        <PlaygroundPage
          t={t}
          imageGeneration={imageGeneration}
          imageGenerationHistory={imageGenerationHistory}
          imageGenerationAction={imageGenerationAction}
          imageGenerationFeedback={imageGenerationFeedback}
          refreshImageGenerationHistory={refreshImageGenerationHistory}
          selectImageGeneration={selectImageGeneration}
          cancelImageGeneration={cancelImageGeneration}
          retryImageGeneration={retryImageGeneration}
          downloadImageGenerationAsset={downloadImageGenerationAsset}
          prepareImageAssetForReuse={prepareImageAssetForReuse}
          hasImageGenerationRetryRequest={hasImageGenerationRetryRequest}
          imageProviderCatalog={imageProviderCatalog}
          imageProviderCatalogState={imageProviderCatalogState}
          refreshProviderCatalog={refreshProviderCatalog}
          imageInputAssets={imageInputAssets}
          uploadImageInput={uploadImageInput}
          runImageGeneration={runImageGeneration}
          musicWorkflow={musicWorkflow}
          videoWorkflow={videoWorkflow}
          signedIn={Boolean(account.accountHandle)}
          chatRuntimeReadiness={chatRuntimeReadiness}
          tasks={taskList}
          libraryItems={libraryItems}
          openModerationAppeal={openModerationAppeal}
          requireAuth={requireAuth}
          workspace={playgroundWorkspace}
          setWorkspace={setPlaygroundWorkspace}
          setPage={navigateToPage}
        />
      )}
      {page === 'generations' && (
        <GenerationCenterPage
          t={t}
          signedIn={Boolean(account.accountHandle)}
          requireAuth={requireAuth}
          navigateToPage={navigateToPage}
        />
      )}
      {page === 'assets' && (
        <AssetLibraryPage
          t={t}
          signedIn={Boolean(account.accountHandle)}
          requireAuth={requireAuth}
          navigateToPage={navigateToPage}
        />
      )}
      {page === 'chat' && (
        <ChatPage
          t={t}
          setPage={navigateToPage}
          signedIn={Boolean(account.accountHandle)}
          runtimeReadiness={chatRuntimeReadiness}
          requireAuth={requireAuth}
          tasks={taskList}
          libraryItems={libraryItems}
          openModerationAppeal={openModerationAppeal}
        />
      )}
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
          workflowStateByTask={workflowStateByTask}
          refreshProposals={refreshProposals}
          acceptProposal={acceptProposal}
          rejectProposal={rejectProposal}
          refreshSubmissions={refreshSubmissions}
          refreshTimeline={refreshTimeline}
          refreshWorkflow={refreshWorkflow}
          submitTask={submitTask}
          approveTask={approveTask}
          rejectTask={rejectTask}
          requestRevisionTask={requestRevisionTask}
          openDisputeTask={openDisputeTask}
          cancelTask={cancelTask}
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
          selectedPost={selectedPost}
          setSelectedPost={setSelectedPost}
          communityFilter={communityFilter}
          setCommunityFilter={setCommunityFilter}
          communityView={communityView}
          setCommunityView={setCommunityView}
          status={communityStatus}
          simulateAction={simulateAction}
          accountHandle={account.accountHandle}
          myPosts={myPosts}
          postMutationBusy={postMutationBusy}
          refreshMyPosts={refreshMyPosts}
          createPost={createPost}
          updatePost={updatePost}
          publishPost={publishPost}
          deletePost={deletePost}
        />
      )}
      {page === 'inspiration' && (
        <InspirationPage
          t={t}
          items={libraryItems}
          setPage={navigateToPage}
          status={communityStatus}
          signedIn={Boolean(account.accountHandle)}
          requireAuth={requireAuth}
        />
      )}
      {page === 'points' && <PointsPage t={t} summary={pointsSummary} />}
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
      {page === 'api' && <DeveloperAccessPage t={t} signedIn={Boolean(account.accountHandle)} requireAuth={requireAuth} />}
      {page === 'earn' && <EarnPage t={t} requireAuth={requireAuth} />}
      {page === 'about' && <AboutPage t={t} />}
      {page === 'playlist' && <PlaylistPage t={t} playTrack={playTrack} />}
      {page === 'profile' && (
        <ProfilePage
          key={selectedProfile.id}
          t={t}
          profile={selectedProfile}
          profiles={profiles}
          personalProfileId={accountProfile.id}
          tasks={taskList}
          setPage={navigateToPage}
          openProfile={openProfile}
          submitTask={submitTask}
          simulateAction={simulateAction}
          onProfileUpdated={onProfileUpdated}
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
          initialAppeal={supportAppeal}
          onInitialAppealConsumed={() => setSupportAppeal(null)}
        />
      )}
    </Suspense>
  )
}
