import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseConvertLibraryItemToTaskRequest,
  parseConvertToTaskRequest,
  parseCompleteMediaUploadRequest,
  parseAdminAuditListQuery,
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
  parseCreateTaskRequest,
  parseRegisterRequest,
  parseReviewTaskProposalRequest,
  parseReviewTaskRequest,
  parseSubmitTaskRequest,
  parseTaskChildListQuery,
  parseUpdateRolePermissionsRequest,
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
  })
  assert.deepEqual(parseReviewTaskRequest({ decision: 'request_changes', reviewNote: 'Tighten the rights note.' }), {
    decision: 'request_changes',
    reviewNote: 'Tighten the rights note.',
  })
  assertValidationError(
    () => parseReviewTaskRequest({ decision: 'hold', reviewNote: 'Wait.' }),
    'decision must be one of: approve, reject, request_changes',
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
  assertValidationError(
    () => parseAdminReviewListQuery({ limit: '0' }),
    'limit must be an integer between 1 and 100',
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
