import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseConvertLibraryItemToTaskRequest,
  parseConvertToTaskRequest,
  parseCompleteMediaUploadRequest,
  parseCreateCreativeGenerationRequest,
  parseCreateChatConversationRequest,
  parseCreateChatTurnRequest,
  parseCreativeGenerationHistoryQuery,
  parseGenerationCenterQuery,
  parseAdminAuditListQuery,
  parseAdminCreativeGenerationListQuery,
  parseAdminReviewListQuery,
  parseEmailLoginRequest,
  parseCreateMediaUploadRequest,
  parseMediaReviewQueueQuery,
  parseMediaScanJobArchiveQuery,
  parseMediaScanJobHistoryQuery,
  parseMediaScanJobQuery,
  parseMediaScanCallbackRequest,
  parseMediaScanRequest,
  parseCreateTaskProposalRequest,
  parseCreateCommentRequest,
  parseCreateLibraryItemRequest,
  parseCreatePostRequest,
  parseCreatePortfolioAssetRequest,
  parseCreateTaskRequest,
  parseRegisterRequest,
  parseReviewTaskProposalRequest,
  parseReviewTaskRequest,
  parseSubmitTaskRequest,
  parseTaskChildListQuery,
  parseUpdateRolePermissionsRequest,
  parseUpdatePortfolioAssetRequest,
} from './requestParsers.js'

const assertValidationError = (fn, message) => {
  assert.throws(fn, (error) => {
    assert.equal(error.name, 'HttpError')
    assert.equal(error.statusCode, 400)
    assert.equal(error.code, 'VALIDATION_FAILED')
    if (message) assert.equal(error.message, message)
    return true
  })
}

test('parseCreateTaskRequest trims required text and applies defaults', () => {
  assert.deepEqual(
    parseCreateTaskRequest({
      title: '  Product launch video  ',
      category: ' Video ',
      description: 'Generate a launch cut.',
      acceptanceRules: 'Submit preview and final files.',
      pointsReward: '800',
      attachmentIds: ['brief-1'],
    }),
    {
      title: 'Product launch video',
      category: 'Video',
      description: 'Generate a launch cut.',
      acceptanceRules: 'Submit preview and final files.',
      rewardAmount: null,
      rewardCurrency: null,
      pointsReward: 800,
      deadlineAt: null,
      visibility: 'public',
      attachmentIds: ['brief-1'],
    },
  )
})

test('parseRegisterRequest normalizes account credentials', () => {
  assert.deepEqual(
    parseRegisterRequest({
      email: ' New.User@Example.COM ',
      password: 'correct-horse-42',
      displayName: ' New User ',
      handle: 'new_user',
    }),
    {
      email: 'new.user@example.com',
      password: 'correct-horse-42',
      displayName: 'New User',
      handle: 'new_user',
    },
  )
  assert.deepEqual(parseRegisterRequest({ email: 'u@example.com', password: 'correct-horse-42' }), {
    email: 'u@example.com',
    password: 'correct-horse-42',
    displayName: 'u',
    handle: 'user_u',
  })
})

test('parseRegisterRequest validates auth boundaries', () => {
  assertValidationError(
    () => parseRegisterRequest({ email: 'not-email', password: 'correct-horse-42' }),
    'email must be a valid email address',
  )
  assertValidationError(
    () => parseRegisterRequest({ email: 'user@example.com', password: 'short' }),
    'password must be between 8 and 128 characters',
  )
  assertValidationError(
    () => parseRegisterRequest({ email: 'user@example.com', password: 'correct-horse-42', handle: 'no spaces' }),
    'handle must be 3-32 characters using letters, numbers, underscores, or hyphens',
  )
})

test('parseEmailLoginRequest normalizes email and requires password', () => {
  assert.deepEqual(parseEmailLoginRequest({ email: ' Login@Example.COM ', password: 'pw' }), {
    email: 'login@example.com',
    password: 'pw',
  })
  assertValidationError(
    () => parseEmailLoginRequest({ email: 'login@example.com' }),
    'password is required',
  )
})

test('parseCreateTaskRequest rejects invalid attachment arrays', () => {
  assertValidationError(
    () =>
      parseCreateTaskRequest({
        title: 'Task',
        category: 'Prompt',
        description: 'Details',
        acceptanceRules: 'Rules',
        pointsReward: 100,
        attachmentIds: ['ok', 42],
      }),
    'attachmentIds must be an array of strings',
  )
})

test('parseSubmitTaskRequest validates content and keeps optional fields predictable', () => {
  assert.deepEqual(parseSubmitTaskRequest({ content: ' Done ', rightsNote: ' Owned ', assetIds: ['asset-1'] }), {
    content: 'Done',
    assetIds: ['asset-1'],
    rightsNote: 'Owned',
  })
  assert.deepEqual(parseSubmitTaskRequest({ content: 'Done' }), {
    content: 'Done',
    assetIds: [],
    rightsNote: '',
  })
})

test('portfolio parsers freeze draft fields and explicit lifecycle actions', () => {
  assert.deepEqual(parseCreatePortfolioAssetRequest({ title: ' Final ', caption: ' Proof ', sourceSubmissionId: null }), {
    title: 'Final', caption: 'Proof', sourceSubmissionId: null,
  })
  assert.deepEqual(parseUpdatePortfolioAssetRequest({ action: 'publish', sortOrder: 2 }), {
    title: undefined, caption: undefined, sortOrder: 2, action: 'publish',
  })
  assertValidationError(() => parseUpdatePortfolioAssetRequest({ action: 'delete' }), 'action must be one of: publish, withdraw, archive, restore')
})

test('parseCreateTaskProposalRequest validates proposal payloads', () => {
  assert.deepEqual(parseCreateTaskProposalRequest({ coverLetter: ' I can deliver this. ', estimate: ' 2 days ' }), {
    coverLetter: 'I can deliver this.',
    estimate: '2 days',
  })
  assert.deepEqual(parseCreateTaskProposalRequest({ coverLetter: 'Ready to help.' }), {
    coverLetter: 'Ready to help.',
    estimate: '',
  })
  assertValidationError(
    () => parseCreateTaskProposalRequest({ coverLetter: '' }),
    'coverLetter is required',
  )
})

test('parseReviewTaskProposalRequest accepts proposal decisions and normalizes notes', () => {
  assert.deepEqual(parseReviewTaskProposalRequest({ decision: 'accept', note: ' Strong fit. ' }), {
    decision: 'accept',
    note: 'Strong fit.',
  })
  assert.deepEqual(parseReviewTaskProposalRequest({ decision: 'reject' }), {
    decision: 'reject',
    note: '',
  })
  assertValidationError(
    () => parseReviewTaskProposalRequest({ decision: 'hold' }),
    'decision must be one of: accept, reject',
  )
})

test('parseReviewTaskRequest accepts known decisions and rejects unknown values', () => {
  assert.deepEqual(parseReviewTaskRequest({ decision: 'approve', reviewNote: 'Looks good.' }), {
    decision: 'approve',
    reviewNote: 'Looks good.',
    acceptanceChecklist: [],
  })
  assert.deepEqual(parseReviewTaskRequest({
    decision: 'request_changes',
    reviewNote: 'Tighten the rights note.',
    acceptanceChecklist: [{ label: ' Rights note ', checked: false }],
  }), {
    decision: 'request_changes',
    reviewNote: 'Tighten the rights note.',
    acceptanceChecklist: [{ label: 'Rights note', checked: false }],
  })
  assertValidationError(
    () => parseReviewTaskRequest({ decision: 'hold', reviewNote: 'Wait.' }),
    'decision must be one of: approve, reject, request_changes',
  )
  assertValidationError(
    () => parseReviewTaskRequest({
      decision: 'approve',
      reviewNote: 'Almost.',
      acceptanceChecklist: [{ label: 'Rights note', checked: false }],
    }),
    'acceptanceChecklist must be fully checked before approval',
  )
  assertValidationError(
    () => parseReviewTaskRequest({
      decision: 'request_changes',
      reviewNote: 'Almost.',
      acceptanceChecklist: [{ label: 'Rights note', checked: 'no' }],
    }),
    'acceptanceChecklist[0].checked must be a boolean',
  )
})

test('parseCreatePostRequest and parseCreateCommentRequest normalize forum payloads', () => {
  assert.deepEqual(
    parseCreatePostRequest({
      title: ' Help needed ',
      body: 'Need advice.',
      category: 'Questions',
      tag: ' Hot ',
      excerpt: ' Short ',
    }),
    {
      title: 'Help needed',
      body: 'Need advice.',
      category: 'Questions',
      tag: 'Hot',
      excerpt: 'Short',
    },
  )
  assert.deepEqual(parseCreateCommentRequest({ body: ' Reply ', parentId: '' }), {
    body: 'Reply',
    parentId: null,
  })
})

test('parseConvertToTaskRequest validates reward and acceptance rules', () => {
  assert.deepEqual(
    parseConvertToTaskRequest({
      acceptanceRules: 'Submit a scoped plan.',
      pointsReward: '500',
      rewardAmount: '120',
      deadlineAt: '2026-07-01',
    }),
    {
      acceptanceRules: 'Submit a scoped plan.',
      pointsReward: 500,
      rewardAmount: 120,
      deadlineAt: '2026-07-01',
    },
  )
  assertValidationError(
    () => parseConvertToTaskRequest({ acceptanceRules: 'Rules', pointsReward: 'NaN' }),
    'pointsReward must be a number',
  )
})

test('parseCreateLibraryItemRequest applies library defaults and preserves metadata', () => {
  const metadata = { postId: 'post-1' }
  assert.deepEqual(
    parseCreateLibraryItemRequest({
      title: 'Idea',
      text: 'Reusable text',
      sourceId: 'post-1',
      metadata,
    }),
    {
      title: 'Idea',
      text: 'Reusable text',
      type: 'post',
      source: 'Community',
      sourceId: 'post-1',
      metadata,
    },
  )
})

test('parseCreateCreativeGenerationRequest normalizes provider generation payloads', () => {
  assert.deepEqual(
    parseCreateCreativeGenerationRequest({
      workspace: ' image ',
      mode: ' text_to_image ',
      prompt: ' Generate a bright poster. ',
      inputAssetIds: [],
      parameters: { aspectRatio: '16:9', seed: 42, stylePreset: 'poster', quality: 'high' },
      providerId: ' mock ',
    }),
    {
      workspace: 'image',
      mode: 'text_to_image',
      prompt: 'Generate a bright poster.',
      inputAssetIds: [],
      parameters: { aspectRatio: '16:9', seed: 42, stylePreset: 'poster', quality: 'high' },
      providerId: 'mock',
    },
  )
})

test('parseCreateCreativeGenerationRequest validates creative payload boundaries', () => {
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({ workspace: 'document', mode: 'text_to_image', prompt: 'Poster' }),
    'workspace must be one of: image, video, music, chat',
  )
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({ workspace: 'image', mode: 'text_to_image', prompt: 'x'.repeat(2001) }),
    'prompt must be 2000 characters or fewer',
  )
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({ workspace: 'image', mode: 'text_to_image', prompt: 'Poster', inputAssetIds: [42] }),
    'inputAssetIds must be an array of strings',
  )
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({ workspace: 'image', mode: 'text_to_image', prompt: 'Poster', parameters: { nested: { no: true } } }),
    'parameters.nested must be a string, number, boolean, array, or null',
  )
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({ workspace: 'image', mode: 'text_to_image', prompt: 'Poster', parameters: { controls: ['HD'] } }),
    'parameters.controls is not supported for text_to_image',
  )
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({ workspace: 'image', mode: 'image_to_image', prompt: 'Restyle this image' }),
    'inputAssetIds must include 1 image asset(s) for image_to_image',
  )
  assert.equal(parseCreateCreativeGenerationRequest({
    workspace: 'image',
    mode: 'image_edit',
    prompt: 'Remove the background',
    inputAssetIds: ['source', 'mask'],
    parameters: { strength: 0.5 },
  }).mode, 'image_edit')
})

test('parseCreateCreativeGenerationRequest applies the frozen Chat request boundary', () => {
  assert.deepEqual(parseCreateCreativeGenerationRequest({
    workspace: 'chat',
    mode: 'assistant',
    prompt: 'Draft a concise task brief.',
    parameters: { maxOutputTokens: 1024, responseFormat: 'text' },
  }), {
    workspace: 'chat',
    mode: 'assistant',
    prompt: 'Draft a concise task brief.',
    inputAssetIds: [],
    parameters: { maxOutputTokens: 1024, responseFormat: 'text' },
    providerId: null,
  })
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({
      workspace: 'chat',
      mode: 'assistant',
      prompt: 'Use this attachment.',
      inputAssetIds: ['asset-1'],
    }),
    'Chat attachments require the streaming turn API',
  )
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({
      workspace: 'chat',
      mode: 'assistant',
      prompt: 'Persist this at the Provider.',
      parameters: { store: true },
    }),
    'parameters.store is not supported for assistant',
  )
})

test('parseCreateCreativeGenerationRequest applies the frozen Video request boundary', () => {
  assert.deepEqual(parseCreateCreativeGenerationRequest({
    workspace: 'video',
    mode: 'text_to_video',
    prompt: 'Create a launch film.',
    parameters: { aspectRatio: '16:9', durationSeconds: 8, motionPreset: 'subtle', outputFormat: 'mp4' },
  }), {
    workspace: 'video',
    mode: 'text_to_video',
    prompt: 'Create a launch film.',
    inputAssetIds: [],
    parameters: { aspectRatio: '16:9', durationSeconds: 8, motionPreset: 'subtle', outputFormat: 'mp4' },
    providerId: null,
  })
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({
      workspace: 'video',
      mode: 'image_to_video',
      prompt: 'Animate this image.',
    }),
    'inputAssetIds must include 1 governed asset(s) for image_to_video',
  )
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({
      workspace: 'video',
      mode: 'text_to_video',
      prompt: 'Render too long.',
      parameters: { durationSeconds: 10 },
    }),
    'parameters.durationSeconds must be one of: 4, 6, 8',
  )
})

test('parseCreateCreativeGenerationRequest applies the frozen Music request boundary', () => {
  assert.deepEqual(parseCreateCreativeGenerationRequest({
    workspace: 'music',
    mode: 'lyrics_to_song',
    prompt: 'Create an uplifting bilingual chorus.',
    parameters: {
      durationSeconds: 120,
      genre: 'pop',
      mood: 'uplifting',
      tempoBpm: 118,
      lyrics: 'Build the light together',
      language: 'en',
      outputFormat: 'mp3',
    },
  }), {
    workspace: 'music',
    mode: 'lyrics_to_song',
    prompt: 'Create an uplifting bilingual chorus.',
    inputAssetIds: [],
    parameters: {
      durationSeconds: 120,
      genre: 'pop',
      mood: 'uplifting',
      tempoBpm: 118,
      lyrics: 'Build the light together',
      language: 'en',
      outputFormat: 'mp3',
    },
    providerId: null,
  })
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({
      workspace: 'music',
      mode: 'lyrics_to_song',
      prompt: 'Missing lyrics.',
      parameters: { language: 'en' },
    }),
    'parameters.lyrics is required for lyrics_to_song',
  )
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({
      workspace: 'music',
      mode: 'instrumental',
      prompt: 'Remix this reference.',
      inputAssetIds: ['reference-audio'],
    }),
    'inputAssetIds must include 0 governed assets for instrumental',
  )
  assertValidationError(
    () => parseCreateCreativeGenerationRequest({
      workspace: 'music',
      mode: 'text_to_speech',
      prompt: 'Read this script.',
    }),
    'mode must be one of: instrumental, lyrics_to_song',
  )
})

test('Chat conversation and streaming turn parsers enforce closed modes and idempotency', () => {
  assert.deepEqual(parseCreateChatConversationRequest({ mode: 'storyboard' }), { mode: 'storyboard' })
  assert.deepEqual(parseCreateChatTurnRequest({
    clientTurnId: 'client-turn-parser-1',
    message: 'Build a three-shot storyboard.',
    mode: 'storyboard',
    parameters: { maxOutputTokens: 256, responseFormat: 'text' },
    inputAssetIds: ['asset-1'],
    productContext: [{ type: 'task', id: 'task-1' }],
  }), {
    clientTurnId: 'client-turn-parser-1',
    message: 'Build a three-shot storyboard.',
    mode: 'storyboard',
    parameters: { maxOutputTokens: 256, responseFormat: 'text' },
    inputAssetIds: ['asset-1'],
    productContext: [{ type: 'task', id: 'task-1' }],
  })
  assertValidationError(
    () => parseCreateChatTurnRequest({ clientTurnId: 'short', message: 'Hello', mode: 'assistant' }),
    'clientTurnId must be 8-128 safe characters',
  )
  assertValidationError(
    () => parseCreateChatTurnRequest({ clientTurnId: 'client-turn-parser-2', message: 'Hello', mode: 'unknown' }),
    'mode must be one of: assistant, prompt_assist, storyboard',
  )
  assertValidationError(
    () => parseCreateChatTurnRequest({
      clientTurnId: 'client-turn-parser-3',
      message: 'Hello',
      mode: 'assistant',
      inputAssetIds: ['asset-1', 'asset-1'],
    }),
    'inputAssetIds must not contain duplicate assets',
  )
  assertValidationError(
    () => parseCreateChatTurnRequest({
      clientTurnId: 'client-turn-parser-4',
      message: 'Hello',
      mode: 'assistant',
      productContext: [{ type: 'task', id: 'task-1', content: 'untrusted' }],
    }),
    'productContext[0] contains unsupported fields',
  )
})

test('parseCreativeGenerationHistoryQuery defaults to image and validates lifecycle filters', () => {
  assert.deepEqual(parseCreativeGenerationHistoryQuery({}), {
    cursor: null,
    limit: 20,
    workspace: 'image',
    status: null,
  })
  assert.deepEqual(parseCreativeGenerationHistoryQuery({
    cursor: 'generation-1',
    limit: '12',
    workspace: 'image',
    status: 'running',
  }), {
    cursor: 'generation-1',
    limit: 12,
    workspace: 'image',
    status: 'running',
  })
  assertValidationError(
    () => parseCreativeGenerationHistoryQuery({ status: 'unknown' }),
    'status must be one of: queued, running, completed, failed, cancelled, review_required',
  )
  assertValidationError(
    () => parseCreativeGenerationHistoryQuery({ limit: '51' }),
    'limit must be an integer between 1 and 50',
  )
})

test('parseGenerationCenterQuery supports cross-workspace date filtering', () => {
  assert.deepEqual(parseGenerationCenterQuery({}), {
    cursor: null,
    limit: 20,
    workspace: null,
    status: null,
    dateFrom: null,
    dateTo: null,
  })
  assert.deepEqual(parseGenerationCenterQuery({
    workspace: 'chat',
    status: 'completed',
    dateFrom: '2032-07-12T00:00:00Z',
    dateTo: '2032-07-12T23:59:59Z',
    limit: '12',
  }), {
    cursor: null,
    limit: 12,
    workspace: 'chat',
    status: 'completed',
    dateFrom: '2032-07-12T00:00:00.000Z',
    dateTo: '2032-07-12T23:59:59.000Z',
  })
  assertValidationError(
    () => parseGenerationCenterQuery({ dateFrom: 'not-a-date' }),
    'dateFrom must be an ISO timestamp',
  )
  assertValidationError(
    () => parseGenerationCenterQuery({ dateFrom: '2032-07-13', dateTo: '2032-07-12' }),
    'dateFrom must be before or equal to dateTo',
  )
})

test('parseCreateMediaUploadRequest validates upload signing payloads', () => {
  const metadata = { taskId: 'task-1' }
  assert.deepEqual(
    parseCreateMediaUploadRequest({
      fileName: ' brief.pdf ',
      contentType: ' application/pdf ',
      sizeBytes: '2048',
      purpose: 'task_attachment',
      metadata,
    }),
    {
      fileName: 'brief.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      purpose: 'task_attachment',
      metadata,
    },
  )
  assert.equal(parseCreateMediaUploadRequest({
    fileName: 'brief.md',
    contentType: 'text/markdown',
    sizeBytes: 1024,
    purpose: 'task_attachment',
  }).contentType, 'text/markdown')
  assertValidationError(
    () => parseCreateMediaUploadRequest({ fileName: 'x', contentType: 'text/plain', sizeBytes: 0, purpose: 'task_attachment' }),
    'sizeBytes must be an integer between 1 and 52428800',
  )
  assertValidationError(
    () => parseCreateMediaUploadRequest({ fileName: 'x', contentType: 'video/mp4', sizeBytes: 1024, purpose: 'task_attachment' }),
    'contentType is not allowed for task_attachment',
  )
  assertValidationError(
    () => parseCreateMediaUploadRequest({ fileName: 'x', contentType: 'text/plain', sizeBytes: 1, purpose: 'unknown' }),
    'purpose must be one of: task_attachment, submission_asset, profile_portfolio, library_asset',
  )
})

test('parseCompleteMediaUploadRequest keeps checksum optional', () => {
  assert.deepEqual(parseCompleteMediaUploadRequest({ checksum: ' abc123 ', detectedContentType: ' text/plain ' }), {
    checksum: 'abc123',
    detectedContentType: 'text/plain',
  })
  assert.deepEqual(parseCompleteMediaUploadRequest({}), { checksum: '', detectedContentType: '' })
})

test('parseMediaScanRequest validates scan decisions', () => {
  assert.deepEqual(parseMediaScanRequest({ decision: 'clean', note: ' checked ', detectedContentType: ' application/pdf ' }), {
    decision: 'clean',
    note: 'checked',
    detectedContentType: 'application/pdf',
  })
  assertValidationError(
    () => parseMediaScanRequest({ decision: 'maybe' }),
    'decision must be one of: clean, reject',
  )
})

test('parseMediaScanCallbackRequest validates provider callback states', () => {
  assert.deepEqual(parseMediaScanCallbackRequest({
    status: 'review',
    note: ' Needs review ',
    reason: ' policy ',
    detectedContentType: ' application/pdf ',
    externalScanId: ' scan-1 ',
  }), {
    status: 'review',
    note: 'Needs review',
    reason: 'policy',
    detectedContentType: 'application/pdf',
    externalScanId: 'scan-1',
  })
  assertValidationError(
    () => parseMediaScanCallbackRequest({ status: 'scanning' }),
    'status must be one of: clean, review, rejected',
  )
})

test('parseMediaReviewQueueQuery accepts scanning filter', () => {
  assert.deepEqual(parseMediaReviewQueueQuery({ status: 'scanning', limit: '5' }), {
    cursor: null,
    limit: 5,
    status: 'scanning',
    purpose: null,
    search: null,
  })
  assertValidationError(
    () => parseMediaReviewQueueQuery({ status: 'queued' }),
    'status must be one of: pending, scanning, review, clean, rejected, all',
  )
})

test('parseMediaScanJobQuery validates job health filters', () => {
  assert.deepEqual(parseMediaScanJobQuery({ status: 'retrying', search: ' scan-1 ', limit: '10' }), {
    cursor: null,
    limit: 10,
    status: 'retrying',
    purpose: null,
    search: 'scan-1',
  })
  assert.deepEqual(parseMediaScanJobQuery({ status: 'all' }).status, null)
  assertValidationError(
    () => parseMediaScanJobQuery({ status: 'lost' }),
    'status must be one of: active, queued, retrying, timed_out, completed, failed, all',
  )
})

test('parseMediaScanJobHistoryQuery normalizes pagination', () => {
  assert.deepEqual(parseMediaScanJobHistoryQuery({ limit: '5', cursor: 'job-1' }), {
    cursor: 'job-1',
    limit: 5,
  })
  assert.deepEqual(parseMediaScanJobHistoryQuery({}), {
    cursor: null,
    limit: 10,
  })
  assertValidationError(
    () => parseMediaScanJobHistoryQuery({ limit: '51' }),
    'limit must be an integer between 1 and 50',
  )
})

test('parseMediaScanJobArchiveQuery normalizes larger archive pagination', () => {
  assert.deepEqual(parseMediaScanJobArchiveQuery({ limit: '250', cursor: 'job-1' }), {
    cursor: 'job-1',
    limit: 250,
  })
  assert.deepEqual(parseMediaScanJobArchiveQuery({}), {
    cursor: null,
    limit: 100,
  })
  assertValidationError(
    () => parseMediaScanJobArchiveQuery({ limit: '501' }),
    'limit must be an integer between 1 and 500',
  )
})

test('parseConvertLibraryItemToTaskRequest extends shared conversion payload with category', () => {
  assert.deepEqual(
    parseConvertLibraryItemToTaskRequest({
      acceptanceRules: 'Ship a draft.',
      pointsReward: 300,
      category: ' Prompt ',
    }),
    {
      acceptanceRules: 'Ship a draft.',
      pointsReward: 300,
      rewardAmount: null,
      deadlineAt: null,
      category: 'Prompt',
    },
  )
})

test('parseUpdateRolePermissionsRequest validates known permission arrays', () => {
  assert.deepEqual(
    parseUpdateRolePermissionsRequest({
      permissions: [' task:create ', 'post:create', 'security:alerts:manage', 'task:create'],
    }),
    {
      permissions: ['task:create', 'post:create', 'security:alerts:manage'],
    },
  )
  assertValidationError(
    () => parseUpdateRolePermissionsRequest({ permissions: ['task:create', 'unknown:permission'] }),
    'permissions contains unsupported values: unknown:permission',
  )
  assertValidationError(
    () => parseUpdateRolePermissionsRequest({ permissions: 'task:create' }),
    'permissions must be an array of strings',
  )
})

test('admin list query parsers normalize pagination and filters', () => {
  assert.deepEqual(parseAdminReviewListQuery({ limit: '2', cursor: 'review-1', queue: ' tasks ', status: ' Pending review ' }), {
    cursor: 'review-1',
    limit: 2,
    queue: 'tasks',
    status: 'Pending review',
  })
  assert.deepEqual(parseAdminAuditListQuery({}), {
    cursor: null,
    limit: 20,
    action: null,
    resourceType: null,
    actorId: null,
  })
  assert.deepEqual(parseAdminCreativeGenerationListQuery({
    limit: '5',
    cursor: 'gen-1',
    userHandle: ' promptlin ',
    workspace: ' image ',
    mode: ' text_to_image ',
    providerId: ' mock ',
    status: ' review_required ',
    reviewRequired: 'true',
    mediaAssetId: ' media-1 ',
    dateFrom: '2026-07-06T00:00:00.000Z',
    dateTo: '2026-07-06T23:59:59.999Z',
  }), {
    cursor: 'gen-1',
    limit: 5,
    actorHandle: 'promptlin',
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    status: 'review_required',
    reviewRequired: true,
    mediaAssetId: 'media-1',
    dateFrom: '2026-07-06T00:00:00.000Z',
    dateTo: '2026-07-06T23:59:59.999Z',
  })
  assertValidationError(
    () => parseAdminReviewListQuery({ limit: '0' }),
    'limit must be an integer between 1 and 100',
  )
  assertValidationError(
    () => parseAdminCreativeGenerationListQuery({ status: 'unknown' }),
    'status must be one of: queued, running, completed, failed, cancelled, review_required',
  )
  assertValidationError(
    () => parseAdminCreativeGenerationListQuery({ reviewRequired: 'maybe' }),
    'reviewRequired must be a boolean',
  )
})

test('parseTaskChildListQuery reuses shared cursor pagination validation', () => {
  assert.deepEqual(parseTaskChildListQuery({ limit: '3', cursor: 'proposal-1' }), {
    cursor: 'proposal-1',
    limit: 3,
  })
  assertValidationError(
    () => parseTaskChildListQuery({ limit: '101' }),
    'limit must be an integer between 1 and 100',
  )
})
