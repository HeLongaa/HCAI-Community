export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'HCAI Community API',
    version: '0.1.0',
    description: 'Productization phase 2 API skeleton for task marketplace, community, points, and admin workflows.',
  },
  servers: [{ url: 'http://127.0.0.1:8787/api' }],
  paths: {
    '/auth/login': {
      post: {
        summary: 'Login with email/password or a seeded demo handle',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  handle: { type: 'string', example: 'taskops' },
                  email: { type: 'string', format: 'email', example: 'maker@example.com' },
                  password: { type: 'string', format: 'password' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Session tokens and user' },
        },
      },
    },
    '/auth/register': {
      post: {
        summary: 'Register an email/password account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'policyConsent'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', format: 'password', minLength: 8, maxLength: 128 },
                  displayName: { type: 'string' },
                  handle: { type: 'string', minLength: 3, maxLength: 32 },
                  policyConsent: {
                    type: 'object',
                    required: ['accepted', 'locale', 'policyVersions'],
                    properties: {
                      accepted: { type: 'boolean', const: true },
                      locale: { type: 'string', enum: ['en', 'zh'] },
                      policyVersions: {
                        type: 'object',
                        additionalProperties: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Session tokens and registered user' },
          '409': { description: 'Email or handle already exists' },
        },
      },
    },
    '/compliance/policies': {
      get: {
        summary: 'Read the versioned V1 legal, privacy, acceptable-use, Provider disclosure, and support policies',
        responses: {
          '200': { description: 'Public policy manifest, release gate, Provider disclosures, and support categories' },
        },
      },
    },
    '/compliance/consent': {
      get: {
        summary: 'Read the current user policy-consent status',
        responses: {
          '200': { description: 'Required and accepted policy versions for the current user' },
          '401': { description: 'Authentication required' },
        },
      },
      post: {
        summary: 'Record affirmative consent to the exact current required policy versions',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['accepted', 'locale', 'policyVersions'],
                properties: {
                  accepted: { type: 'boolean', const: true },
                  locale: { type: 'string', enum: ['en', 'zh'] },
                  policyVersions: { type: 'object', additionalProperties: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Immutable current-version consent record created' },
          '400': { description: 'Affirmative consent or versions missing' },
          '401': { description: 'Authentication required' },
          '409': { description: 'Submitted policy versions are no longer current' },
        },
      },
    },
    '/support/requests': {
      get: {
        summary: 'List support requests owned by the current user',
        parameters: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
        ],
        responses: {
          '200': { description: 'Owner-scoped support request page' },
          '401': { description: 'Authentication required' },
        },
      },
      post: {
        summary: 'Create an auditable support, report, appeal, privacy, export, or deletion request',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['category', 'subject', 'details', 'relatedResourceType', 'locale'],
                properties: {
                  category: {
                    type: 'string',
                    enum: ['general_support', 'content_report', 'moderation_appeal', 'privacy_request', 'data_export', 'account_deletion'],
                  },
                  subject: { type: 'string', minLength: 5, maxLength: 120 },
                  details: { type: 'string', minLength: 10, maxLength: 4000 },
                  relatedResourceType: {
                    type: 'string',
                    enum: ['none', 'account', 'task', 'post', 'comment', 'media_asset', 'creative_generation', 'moderation_decision'],
                  },
                  relatedResourceId: { type: 'string', maxLength: 128 },
                  locale: { type: 'string', enum: ['en', 'zh'] },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Support request accepted with a stable tracking id' },
          '400': { description: 'Invalid request or sensitive credential-like content detected' },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/support/requests/{id}': {
      get: {
        summary: 'Read one support request owned by the current user',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Owner-scoped support request' },
          '401': { description: 'Authentication required' },
          '404': { description: 'Support request not found for this user' },
        },
      },
    },
    '/auth/oauth/providers': {
      get: {
        summary: 'List public OAuth provider configuration status',
        responses: {
          '200': {
            description: 'Provider labels, mode, callback method, and scopes',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          provider: { type: 'string', enum: ['google', 'apple', 'discord'] },
                          label: { type: 'string' },
                          configured: { type: 'boolean' },
                          mode: { type: 'string', enum: ['dev', 'external'] },
                          authorizationUrl: { type: 'string', format: 'uri' },
                          callbackMethod: { type: 'string', enum: ['GET', 'POST'] },
                          scopes: { type: 'array', items: { type: 'string' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/auth/oauth/accounts': {
      get: {
        summary: 'List OAuth accounts linked to the current user',
        responses: {
          '200': {
            description: 'Linked OAuth provider accounts',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          provider: { type: 'string', enum: ['google', 'apple', 'discord'] },
                          linked: { type: 'boolean' },
                          providerUserIdHint: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/auth/oauth/accounts/{provider}': {
      delete: {
        summary: 'Unlink an OAuth provider account from the current user',
        parameters: [
          { name: 'provider', in: 'path', required: true, schema: { type: 'string', enum: ['google', 'apple', 'discord'] } },
        ],
        responses: {
          '200': { description: 'Provider account unlinked' },
          '401': { description: 'Authentication required' },
          '404': { description: 'OAuth account not found' },
          '409': { description: 'Cannot unlink the last sign-in method' },
        },
      },
    },
    '/auth/oauth/{provider}/start': {
      post: {
        summary: 'Start an OAuth login or account-link flow',
        parameters: [
          { name: 'provider', in: 'path', required: true, schema: { type: 'string', enum: ['google', 'apple', 'discord', 'dev'] } },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  redirectTo: { type: 'string', example: '/tasks' },
                  linkAccount: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Signed OAuth state and authorization URL' },
          '404': { description: 'Provider not found' },
        },
      },
    },
    '/auth/oauth/{provider}/callback': {
      get: {
        summary: 'Complete OAuth login from provider callback',
        parameters: [
          { name: 'provider', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'state', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'code', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Browser OAuth bridge HTML for top-level redirects' },
          '201': { description: 'Session tokens and user' },
          '400': { description: 'Invalid or expired OAuth state' },
          '409': { description: 'OAuth account conflict' },
        },
      },
      post: {
        summary: 'Complete OAuth login from form-post provider callback',
        parameters: [
          { name: 'provider', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['state', 'code'],
                properties: {
                  state: { type: 'string' },
                  code: { type: 'string' },
                  user: { type: 'string', description: 'Apple first-login user payload' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Browser OAuth bridge HTML for form-post redirects' },
          '201': { description: 'Session tokens and user' },
          '400': { description: 'Invalid or expired OAuth state' },
          '409': { description: 'OAuth account conflict' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        summary: 'Rotate a refresh token from JSON body, bearer token, or HttpOnly cookie',
        parameters: [
          {
            name: 'x-csrf-token',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Required when rotating from the hcaiRefreshToken cookie',
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string', description: 'Optional when hcaiRefreshToken cookie is present' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Rotated tokens and user; also sets hcaiRefreshToken HttpOnly cookie' },
          '403': { description: 'Invalid origin or CSRF token for cookie-backed refresh' },
        },
      },
    },
    '/auth/logout': {
      post: {
        summary: 'Revoke the current session',
        parameters: [
          {
            name: 'x-csrf-token',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Required when revoking from the hcaiRefreshToken cookie',
          },
        ],
        responses: {
          '200': { description: 'Revocation result' },
          '403': { description: 'Invalid origin or CSRF token for cookie-backed logout' },
        },
      },
    },
    '/auth/sessions': {
      get: {
        summary: 'List current user refresh-token sessions',
        responses: {
          '200': { description: 'Session list' },
          '401': { description: 'Authentication required' },
        },
      },
      delete: {
        summary: 'Revoke all current user refresh-token sessions',
        responses: {
          '200': { description: 'Revoked session count' },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/auth/sessions/{id}': {
      delete: {
        summary: 'Revoke one current user refresh-token session',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Revocation result' },
          '401': { description: 'Authentication required' },
          '404': { description: 'Session not found' },
        },
      },
    },
    '/me': {
      get: {
        summary: 'Return the current user contract',
        responses: {
          '200': { description: 'Current user' },
        },
      },
    },
    '/users/me': {
      get: {
        summary: 'Return the current authenticated user',
        responses: {
          '200': { description: 'Current user' },
        },
      },
    },
    '/users/me/profile': {
      patch: {
        summary: 'Update the current user profile',
        responses: {
          '200': { description: 'Updated profile' },
        },
      },
    },
    '/profiles/rankings': {
      get: {
        summary: 'List public profile rankings',
        responses: {
          '200': { description: 'Profile rankings' },
        },
      },
    },
    '/tasks': {
      get: {
        summary: 'List seed-backed tasks',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Task list' },
        },
      },
      post: {
        summary: 'Create a task',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'category', 'description', 'acceptanceRules', 'pointsReward'],
                properties: {
                  title: { type: 'string' },
                  category: { type: 'string' },
                  description: { type: 'string' },
                  acceptanceRules: { type: 'string' },
                  rewardAmount: { type: ['number', 'null'] },
                  rewardCurrency: { type: ['string', 'null'] },
                  pointsReward: { type: 'number' },
                  deadlineAt: { type: ['string', 'null'] },
                  visibility: { type: 'string' },
                  attachmentIds: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created task' },
        },
      },
    },
    '/tasks/{id}': {
      get: {
        summary: 'Get task detail',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Task detail' },
        },
      },
    },
    '/tasks/{id}/claim': {
      post: {
        summary: 'Claim an open task',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Claimed task' },
          '403': { description: 'Requires task claim permission' },
          '404': { description: 'Task not found' },
        },
      },
    },
    '/tasks/{id}/proposals': {
      get: {
        summary: 'List task proposals visible to the current user',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Task proposal list' },
        },
      },
      post: {
        summary: 'Create a task proposal',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['coverLetter'],
                properties: {
                  coverLetter: { type: 'string' },
                  estimate: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created task proposal' },
        },
      },
    },
    '/tasks/{id}/proposals/{proposalId}/actions': {
      post: {
        summary: 'Accept or reject a task proposal',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'proposalId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['decision'],
                properties: {
                  decision: { type: 'string', enum: ['accept', 'reject'] },
                  note: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Reviewed task proposal' },
        },
      },
    },
    '/tasks/{id}/submissions': {
      get: {
        summary: 'List task submissions visible to the current user',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Task submission list' },
        },
      },
      post: {
        summary: 'Submit task work',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: {
                  content: { type: 'string' },
                  assetIds: { type: 'array', items: { type: 'string' } },
                  rightsNote: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Updated task and created normalized submission' },
        },
      },
    },
    '/tasks/{id}/timeline': {
      get: {
        summary: 'List participant-visible task timeline events',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Task timeline event list' },
          '404': { description: 'Task not found or not visible to the current user' },
        },
      },
    },
    '/tasks/{id}/disputes': {
      post: {
        summary: 'Open a dispute for a rejected or stale task submission',
        description: 'The submitter can dispute the latest rejected or stale submission. This marks the task disputed, marks the submission disputed, opens a task_disputes admin review, notifies reviewers, and writes a task timeline event.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Disputed task' },
          '403': { description: 'Requires task submission permission and submission ownership' },
          '404': { description: 'Task not found or no disputable submission exists' },
        },
      },
    },
    '/tasks/stale-submissions/sweep': {
      post: {
        summary: 'Mark overdue task submissions as stale',
        description: 'Moderators can mark pending-review submissions older than the review SLA as stale. The sweep can be scoped to one task with taskId.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  olderThanHours: { type: 'integer', minimum: 0, default: 72 },
                  limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
                  taskId: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Stale submission sweep summary' },
          '403': { description: 'Requires task moderation permission' },
        },
      },
    },
    '/tasks/{id}/review': {
      post: {
        summary: 'Approve, reject, or request changes for a task submission',
        description: 'Approval requires all supplied acceptance checklist items to be checked, settles the creator reward, and increments creator/publisher reputation once for the completion.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['decision', 'reviewNote'],
                properties: {
                  decision: { type: 'string', enum: ['approve', 'reject', 'request_changes'] },
                  reviewNote: { type: 'string' },
                  acceptanceChecklist: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['label', 'checked'],
                      properties: {
                        label: { type: 'string' },
                        checked: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Reviewed task' },
          '403': { description: 'Requires task review permission and publisher ownership' },
          '404': { description: 'Task not found' },
        },
      },
    },
    '/media/uploads': {
      post: {
        summary: 'Create a signed media upload contract',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fileName', 'contentType', 'sizeBytes', 'purpose'],
                properties: {
                  fileName: { type: 'string' },
                  contentType: { type: 'string' },
                  sizeBytes: { type: 'integer', minimum: 1, maximum: 104857600, description: 'Purpose-specific limits apply before signing.' },
                  purpose: { type: 'string', enum: ['task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset'] },
                  metadata: { type: ['object', 'null'] },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Media asset and upload contract',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        asset: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            fileName: { type: 'string' },
                            storageKey: { type: 'string' },
                            contentType: { type: 'string' },
                            sizeBytes: { type: 'integer' },
                            purpose: { type: 'string' },
                            status: { type: 'string', enum: ['pending', 'uploaded', 'rejected'] },
                            metadata: { type: ['object', 'null'] },
                          },
                        },
                        upload: {
                          type: 'object',
                          properties: {
                            provider: { type: 'string', enum: ['mock', 's3'] },
                            method: { type: 'string', enum: ['PUT'] },
                            url: { type: 'string' },
                            headers: { type: 'object', additionalProperties: { type: 'string' } },
                            expiresAt: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid size, purpose, or content type' },
        },
      },
    },
    '/media/review-queue': {
      get: {
        summary: 'List media assets requiring governance review',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'scanning', 'review', 'clean', 'rejected', 'all'], default: 'review' } },
          { name: 'purpose', in: 'query', schema: { type: 'string', enum: ['task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Media asset list with pagination metadata' },
          '403': { description: 'Requires admin queue read permission' },
        },
      },
    },
    '/creative/providers': {
      get: {
        summary: 'List safe creative provider capabilities',
        responses: {
          '200': {
            description: 'Creative provider registry with safe capability metadata',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        defaultProviderId: { type: 'string' },
                        providers: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              label: { type: 'string' },
                              mode: { type: 'string', enum: ['mock', 'replicate_staging'] },
                              enabled: { type: 'boolean' },
                              configured: { type: 'boolean' },
                              default: { type: 'boolean' },
                              capabilities: {
                                type: 'array',
                                items: {
                                  type: 'object',
                                  properties: {
                                    workspace: { type: 'string', enum: ['image', 'video', 'music', 'chat'] },
                                    label: { type: 'string' },
                                    modes: { type: 'array', items: { type: 'string' } },
                                    inputAssetPurposes: { type: 'array', items: { type: 'string' } },
                                    outputTypes: { type: 'array', items: { type: 'string' } },
                                    maxPromptCharacters: { type: 'integer' },
                                    supportedParameters: { type: 'array', items: { type: 'string' } },
                                  },
                                },
                              },
                              safeMetadata: {
                                type: 'object',
                                properties: {
                                  externalCredentialsConfigured: { type: 'boolean' },
                                  persistsOutputs: { type: 'boolean' },
                                  costMetered: { type: 'boolean' },
                                  stagingOnly: { type: 'boolean' },
                                  productionDenied: { type: 'boolean' },
                                  adapterImplemented: { type: 'boolean' },
                                  httpClientImplemented: { type: 'boolean' },
                                  networkCallsEnabled: { type: 'boolean' },
                                  callbackImplemented: { type: 'boolean' },
                                  callbackEnabled: { type: 'boolean' },
                                  pollingImplemented: { type: 'boolean' },
                                  pollingEnabled: { type: 'boolean' },
                                  pollingWorkerEnabled: { type: 'boolean' },
                                  statusClientImplemented: { type: 'boolean' },
                                  statusClientEnabled: { type: 'boolean' },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/creative/providers/replicate/callback/{generationId}': {
      post: {
        summary: 'Accept a signed Replicate staging lifecycle callback',
        description: 'Staging-only and independently disabled by default. Requires app-managed timestamp, HMAC signature, and generation/job nonce headers. This endpoint never dispatches Provider traffic.',
        parameters: [
          { name: 'generationId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'x-creative-provider-timestamp', in: 'header', required: true, schema: { type: 'string', pattern: '^\\d+$' } },
          { name: 'x-creative-provider-signature', in: 'header', required: true, schema: { type: 'string', pattern: '^sha256=[a-fA-F0-9]{64}$' } },
          { name: 'x-creative-provider-nonce', in: 'header', required: true, schema: { type: 'string', pattern: '^sha256=[a-fA-F0-9]{64}$' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'status'],
                properties: {
                  id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$' },
                  event_id: { type: ['string', 'null'], pattern: '^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$' },
                  status: { type: 'string', enum: ['starting', 'processing', 'succeeded', 'failed', 'canceled', 'cancelled'] },
                  output: {
                    oneOf: [
                      { type: 'string', format: 'uri' },
                      { type: 'array', maxItems: 8, items: { type: 'string', format: 'uri' } },
                      { type: 'null' },
                    ],
                  },
                  error: { type: ['string', 'null'], maxLength: 4096 },
                  logs: { type: ['string', 'null'], maxLength: 4096 },
                  metrics: {
                    type: ['object', 'null'],
                    additionalProperties: false,
                    properties: {
                      predict_time: { type: 'number', minimum: 0 },
                      total_time: { type: 'number', minimum: 0 },
                    },
                  },
                  cost_usd: { type: ['number', 'null'], minimum: 0 },
                  created_at: { type: ['string', 'null'], format: 'date-time' },
                  started_at: { type: ['string', 'null'], format: 'date-time' },
                  completed_at: { type: ['string', 'null'], format: 'date-time' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Callback accepted, applied, no-op, or duplicate-suppressed without exposing raw Provider payloads',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        accepted: { type: 'boolean' },
                        generationId: { type: 'string' },
                        providerId: { type: 'string' },
                        providerJobId: { type: ['string', 'null'] },
                        normalizedStatus: { type: 'string' },
                        outcome: { type: 'string', enum: ['applied', 'resumed', 'noop', 'duplicate_suppressed', 'duplicate_in_progress'] },
                        duplicate: { type: 'boolean' },
                        replayId: { type: ['string', 'null'] },
                        sideEffectsCompleted: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Malformed JSON or callback payload outside the strict allowlist' },
          '403': { description: 'Missing or invalid callback signature, timestamp, or nonce' },
          '404': { description: 'Bound generation not found' },
          '409': { description: 'Provider, generation, or provider job binding mismatch' },
          '413': { description: 'Callback body exceeds the dedicated body limit' },
          '415': { description: 'Callback content type is not application/json' },
          '503': { description: 'Callback kill switch is disabled or lifecycle side effects require retry' },
        },
      },
    },
    '/creative/generations': {
      post: {
        summary: 'Execute a creative generation through the configured provider boundary',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['workspace', 'mode', 'prompt'],
                properties: {
                  workspace: { type: 'string', enum: ['image', 'video', 'music', 'chat'] },
                  mode: { type: 'string' },
                  prompt: { type: 'string', maxLength: 4000 },
                  inputAssetIds: { type: 'array', items: { type: 'string' } },
                  parameters: { type: 'object', additionalProperties: true },
                  providerId: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Normalized creative generation result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        workspace: { type: 'string' },
                        mode: { type: 'string' },
                        status: { type: 'string', enum: ['completed', 'review_required'] },
                        provider: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            mode: { type: 'string' },
                            label: { type: 'string' },
                          },
                        },
                        prompt: { type: 'string' },
                        inputAssetIds: { type: 'array', items: { type: 'string' } },
                        parameters: { type: 'object', additionalProperties: true },
                        outputs: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              type: { type: 'string', enum: ['image', 'video', 'audio', 'text'] },
                              label: { type: 'string' },
                              contentType: { type: 'string' },
                              url: { type: 'string' },
                              storage: {
                                type: 'object',
                                properties: {
                                  persisted: { type: 'boolean' },
                                  provider: { type: 'string' },
                                  mediaAssetId: { type: 'string' },
                                  scanStatus: { type: 'string' },
                                  downloadPath: { type: 'string' },
                                },
                              },
                              source: {
                                type: 'object',
                                properties: {
                                  kind: { type: 'string', enum: ['mock_provider'] },
                                  persistedMediaAssetId: { type: ['string', 'null'] },
                                },
                              },
                              mediaAsset: {
                                type: 'object',
                                properties: {
                                  id: { type: 'string' },
                                  status: { type: 'string' },
                                  purpose: { type: 'string' },
                                  contentType: { type: 'string' },
                                  scanStatus: { type: 'string' },
                                },
                              },
                            },
                          },
                        },
                        usage: {
                          type: 'object',
                          properties: {
                            estimatedCredits: { type: 'number' },
                            providerCostCents: { type: 'number' },
                            metered: { type: 'boolean' },
                            costModel: { type: 'string' },
                            currency: { type: 'string' },
                          },
                        },
                        credit: {
                          type: ['object', 'null'],
                          properties: {
                            ledgerId: { type: 'string' },
                            generationId: { type: 'string' },
                            quotaReservationId: { type: ['string', 'null'] },
                            status: {
                              type: 'string',
                              enum: ['reserved', 'settled', 'refunded', 'cancelled'],
                            },
                            currency: { type: 'string' },
                            reserved: { type: 'integer' },
                            settled: { type: 'integer' },
                            refunded: { type: 'integer' },
                            amount: { type: 'integer' },
                            reasonCode: { type: ['string', 'null'] },
                            metadata: { type: ['object', 'null'], additionalProperties: true },
                            reservedAt: { type: ['string', 'null'], format: 'date-time' },
                            settledAt: { type: ['string', 'null'], format: 'date-time' },
                            refundedAt: { type: ['string', 'null'], format: 'date-time' },
                            cancelledAt: { type: ['string', 'null'], format: 'date-time' },
                          },
                        },
                        quota: {
                          type: 'object',
                          properties: {
                            policyVersion: { type: 'string' },
                            scope: { type: 'string' },
                            workspace: { type: 'string' },
                            limit: { type: 'integer' },
                            reserved: { type: 'integer' },
                            used: { type: 'integer' },
                            released: { type: 'integer' },
                            remaining: { type: 'integer' },
                            reservationId: { type: ['string', 'null'] },
                            window: {
                              type: 'object',
                              properties: {
                                id: { type: 'string' },
                                type: { type: 'string' },
                                start: { type: 'string', format: 'date-time' },
                                end: { type: 'string', format: 'date-time' },
                                resetsAt: { type: 'string', format: 'date-time' },
                              },
                            },
                          },
                        },
                        safety: {
                          type: 'object',
                          properties: {
                            moderationRequired: { type: 'boolean' },
                            reviewRequired: { type: 'boolean' },
                            reasons: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  id: { type: 'string' },
                                  label: { type: 'string' },
                                },
                              },
                            },
                            policyVersion: { type: 'string' },
                          },
                        },
                        policy: {
                          type: 'object',
                          properties: {
                            version: { type: 'string' },
                            enforcedAt: { type: 'string', format: 'date-time' },
                            gates: {
                              type: 'object',
                              properties: {
                                quota: { type: 'boolean' },
                                credit: { type: 'boolean' },
                                moderation: { type: 'boolean' },
                                review: { type: 'boolean' },
                              },
                            },
                          },
                        },
                        createdAt: { type: 'string', format: 'date-time' },
                        generationRecord: {
                          type: ['object', 'null'],
                          description: 'Safe durable generation lifecycle record. Does not include the raw prompt.',
                          properties: {
                            id: { type: 'string' },
                            actorId: { type: ['string', 'null'] },
                            actorHandle: { type: ['string', 'null'] },
                            workspace: { type: 'string' },
                            mode: { type: 'string' },
                            providerId: { type: 'string' },
                            providerMode: { type: ['string', 'null'] },
                            status: {
                              type: 'string',
                              enum: ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required'],
                            },
                            promptHash: { type: 'string' },
                            promptPreview: { type: ['string', 'null'] },
                            inputAssetIds: { type: 'array', items: { type: 'string' } },
                            parameterKeys: { type: 'array', items: { type: 'string' } },
                            outputAssetIds: { type: 'array', items: { type: 'string' } },
                            usage: { type: ['object', 'null'], additionalProperties: true },
                            credit: { type: ['object', 'null'], additionalProperties: true },
                            quota: { type: ['object', 'null'], additionalProperties: true },
                            safety: { type: ['object', 'null'], additionalProperties: true },
                            policy: { type: ['object', 'null'], additionalProperties: true },
                            providerRequestId: { type: ['string', 'null'] },
                            providerJobId: { type: ['string', 'null'] },
                            errorCode: { type: ['string', 'null'] },
                            errorMessagePreview: { type: ['string', 'null'] },
                            startedAt: { type: ['string', 'null'], format: 'date-time' },
                            completedAt: { type: ['string', 'null'], format: 'date-time' },
                            failedAt: { type: ['string', 'null'], format: 'date-time' },
                            createdAt: { type: 'string', format: 'date-time' },
                            updatedAt: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid workspace, mode, prompt, or parameter payload' },
          '401': { description: 'Authentication required' },
          '422': { description: 'Creative moderation policy blocked the request before provider execution' },
          '429': { description: 'Creative generation quota exceeded for the user/workspace/day window' },
          '503': { description: 'Creative provider unavailable' },
        },
      },
    },
    '/media/scan-jobs': {
      get: {
        summary: 'List asynchronous media scan job health',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'queued', 'retrying', 'timed_out', 'completed', 'failed', 'all'], default: 'active' } },
          { name: 'purpose', in: 'query', schema: { type: 'string', enum: ['task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Media assets with asynchronous scan job metadata' },
          '403': { description: 'Requires admin queue read permission' },
        },
      },
    },
    '/media/scan-jobs/archive': {
      get: {
        summary: 'Export media scan job archive candidate manifest',
        parameters: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
        ],
        responses: {
          '200': { description: 'Retention manifest for inactive scan jobs eligible for cold archival before pruning' },
          '403': { description: 'Requires admin queue read permission' },
        },
      },
      post: {
        summary: 'Write media scan job archive manifest to object storage',
        parameters: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
        ],
        responses: {
          '200': { description: 'Archive manifest with storage write metadata' },
          '403': { description: 'Requires admin queue review permission' },
        },
      },
    },
    '/media/scan-jobs/sweep': {
      post: {
        summary: 'Run media scan job timeout, retry, and retention maintenance once',
        responses: {
          '200': { description: 'Sweep summary, retention pruning count, and affected media assets' },
          '403': { description: 'Requires admin queue review permission' },
        },
      },
    },
    '/media/governance-config': {
      get: {
        summary: 'Return safe media governance configuration status',
        responses: {
          '200': { description: 'Storage, scanner, retention, alert threshold, and channel configuration summary without secret material' },
          '403': { description: 'Requires admin queue read permission' },
        },
      },
    },
    '/media/governance-policy': {
      put: {
        summary: 'Update editable numeric media governance policy overrides',
        responses: {
          '200': { description: 'Updated safe media governance configuration projection' },
          '400': { description: 'Invalid numeric policy value' },
          '403': { description: 'Requires permission management access' },
        },
      },
    },
    '/media/governance-policy/history': {
      get: {
        summary: 'List media governance policy change history',
        responses: {
          '200': { description: 'Media governance policy change history with previous, next, diff, and summary' },
          '403': { description: 'Requires admin queue read permission' },
        },
      },
    },
    '/media/governance-policy/rollback': {
      post: {
        summary: 'Rollback media governance policy',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['eventId'],
                properties: {
                  eventId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Rolled back safe media governance configuration projection' },
          '403': { description: 'Requires permission management access' },
          '404': { description: 'Policy history event not found or cannot be rolled back' },
        },
      },
    },
    '/media/scan-alerts': {
      get: {
        summary: 'List scanner health alerts that crossed configured thresholds',
        responses: {
          '200': { description: 'Scanner callback, scanner dispatch, timeout, and alert delivery failure summaries' },
          '403': { description: 'Requires admin queue read permission' },
        },
      },
    },
    '/media/scan-alerts/{id}/events': {
      get: {
        summary: 'List recent scanner health alert contributing samples',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Recent audit or scan-job samples for the scanner health alert' },
          '403': { description: 'Requires admin queue read permission' },
          '404': { description: 'Scanner health alert not found' },
        },
      },
    },
    '/media/scan-alerts/{id}/acknowledge': {
      post: {
        summary: 'Acknowledge a scanner health alert',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Updated scanner health alert with acknowledgement state' },
          '403': { description: 'Requires admin queue review permission' },
          '404': { description: 'Scanner health alert not found' },
        },
      },
    },
    '/media/scan-alerts/{id}/silence': {
      post: {
        summary: 'Silence a scanner health alert for a bounded window',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Updated scanner health alert with silence state' },
          '400': { description: 'Invalid silence window' },
          '403': { description: 'Requires admin queue review permission' },
          '404': { description: 'Scanner health alert not found' },
        },
      },
    },
    '/media/scan-alerts/{id}/unsilence': {
      post: {
        summary: 'Remove a scanner health alert silence',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Updated scanner health alert after removing silence' },
          '403': { description: 'Requires admin queue review permission' },
          '404': { description: 'Scanner health alert not found' },
        },
      },
    },
    '/media/uploads/{id}/scan-jobs': {
      get: {
        summary: 'List scan job history for a media asset',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
        ],
        responses: {
          '200': { description: 'Paginated scan job attempt history for the media asset' },
          '403': { description: 'Requires admin queue read permission' },
          '404': { description: 'Media asset not found' },
        },
      },
    },
    '/media/uploads/{id}/complete': {
      post: {
        summary: 'Mark a media upload as completed',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  checksum: { type: 'string' },
                  detectedContentType: { type: 'string', description: 'Optional server-side or client-side detected MIME type for secondary validation.' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Uploaded media asset, or rejected asset when secondary MIME validation or scanner rejection fails' },
        },
      },
    },
    '/media/uploads/{id}/scan': {
      post: {
        summary: 'Record media scan result for an uploaded asset',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['decision'],
                properties: {
                  decision: { type: 'string', enum: ['clean', 'reject'] },
                  note: { type: 'string' },
                  detectedContentType: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Scanned media asset' },
          '403': { description: 'Requires admin queue review permission' },
          '404': { description: 'Media asset not found' },
        },
      },
    },
    '/media/uploads/{id}/scan-callback': {
      post: {
        summary: 'Record asynchronous media scanner callback result',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'x-media-scan-secret', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'x-media-scan-timestamp', in: 'header', required: false, schema: { type: 'string' }, description: 'Required when callback HMAC verification is configured.' },
          { name: 'x-media-scan-signature', in: 'header', required: false, schema: { type: 'string' }, description: 'sha256 HMAC over `${timestamp}.${rawJsonBody}` when configured.' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['clean', 'review', 'rejected'] },
                  note: { type: 'string' },
                  reason: { type: 'string' },
                  detectedContentType: { type: 'string' },
                  externalScanId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated scanned media asset' },
          '403': { description: 'Invalid or missing media scan callback secret/signature; denied attempts are audited' },
          '404': { description: 'Media asset not found' },
        },
      },
    },
    '/media/uploads/{id}/scan-retry': {
      post: {
        summary: 'Requeue a media asset for asynchronous scanner retry',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Media asset with refreshed scan job metadata' },
          '403': { description: 'Requires admin queue review permission' },
          '404': { description: 'Media asset not found' },
        },
      },
    },
    '/media/assets/{id}/download': {
      get: {
        summary: 'Create a private download contract for a clean uploaded media asset',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Media asset and private download contract',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        asset: { type: 'object' },
                        download: {
                          type: 'object',
                          properties: {
                            provider: { type: 'string', enum: ['mock', 's3'] },
                            method: { type: 'string', enum: ['GET'] },
                            url: { type: 'string' },
                            headers: { type: 'object', additionalProperties: { type: 'string' } },
                            expiresAt: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { description: 'Asset not found, not authorized, not uploaded, or not clean' },
        },
      },
    },
    '/posts': {
      get: {
        summary: 'List seed-backed community posts',
        parameters: [
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['new', 'hot', 'unanswered', 'solved'] } },
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'tag', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Post list' },
        },
      },
      post: {
        summary: 'Create a community post',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'body', 'category'],
                properties: {
                  title: { type: 'string' },
                  body: { type: 'string' },
                  category: { type: 'string' },
                  tag: { type: 'string' },
                  excerpt: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created post' },
          '403': { description: 'Requires post create permission' },
        },
      },
    },
    '/posts/{id}': {
      get: {
        summary: 'Get post detail',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Post detail' },
        },
      },
    },
    '/posts/{id}/comments': {
      post: {
        summary: 'Create a post comment',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['body'],
                properties: {
                  body: { type: 'string' },
                  parentId: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created comment' },
        },
      },
    },
    '/posts/{id}/like': {
      post: {
        summary: 'Like a post',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Updated post like state' },
        },
      },
      delete: {
        summary: 'Unlike a post',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Updated post like state' },
        },
      },
    },
    '/posts/{id}/convert-to-task': {
      post: {
        summary: 'Convert a post to a task',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['acceptanceRules', 'pointsReward'],
                properties: {
                  acceptanceRules: { type: 'string' },
                  pointsReward: { type: 'number' },
                  rewardAmount: { type: ['number', 'null'] },
                  deadlineAt: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Converted task' },
        },
      },
    },
    '/library': {
      get: {
        summary: 'List library items',
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'source', in: 'query', schema: { type: 'string' } },
          { name: 'sourceId', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Library items' },
        },
      },
    },
    '/library/items': {
      post: {
        summary: 'Save a library item',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'text', 'type', 'source'],
                properties: {
                  title: { type: 'string' },
                  text: { type: 'string' },
                  type: { type: 'string' },
                  source: { type: 'string' },
                  sourceId: { type: ['string', 'null'] },
                  metadata: {},
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Library item saved' },
        },
      },
    },
    '/library/items/{id}/convert-to-task': {
      post: {
        summary: 'Convert a library item to a task',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['acceptanceRules', 'pointsReward'],
                properties: {
                  acceptanceRules: { type: 'string' },
                  pointsReward: { type: 'number' },
                  rewardAmount: { type: ['number', 'null'] },
                  deadlineAt: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Converted task' },
        },
      },
    },
    '/library/items/{id}/send-to-workspace': {
      post: {
        summary: 'Create a workspace draft from a library item',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Workspace draft' },
        },
      },
    },
    '/profiles': {
      get: {
        summary: 'List public profiles',
        parameters: [
          { name: 'lane', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Profile list' },
        },
      },
    },
    '/profiles/{handle}': {
      get: {
        summary: 'Get a public profile by handle',
        parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Profile detail' },
        },
      },
    },
    '/points/ledger': {
      get: {
        summary: 'List points ledger entries',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'settled', 'cancelled'] } },
          { name: 'userHandle', in: 'query', schema: { type: 'string' }, description: 'Requires points:adjust when querying another user' },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': {
            description: 'Points ledger',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          occurredAtLabel: { type: 'string' },
                          description: { type: 'string' },
                          delta: { type: 'integer' },
                          balanceAfter: { type: 'integer' },
                          status: { type: 'string', enum: ['pending', 'settled', 'cancelled'] },
                          sourceType: { type: 'string', examples: ['task_escrow', 'task_completion', 'task_escrow_release'] },
                          sourceId: { type: ['string', 'null'] },
                          userHandle: { type: ['string', 'null'] },
                        },
                      },
                    },
                    meta: {
                      type: 'object',
                      properties: {
                        summary: {
                          type: 'object',
                          properties: {
                            userHandle: { type: ['string', 'null'] },
                            balance: { type: 'integer' },
                            available: { type: 'integer' },
                            frozen: { type: 'integer' },
                            pendingSettlement: { type: 'integer' },
                            projectedBalance: { type: 'integer' },
                            lifetimeEarned: { type: 'integer' },
                            lifetimeSpent: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/admin/audit': {
      get: {
        summary: 'List recent privileged audit events',
        parameters: [
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'resourceType', in: 'query', schema: { type: 'string' } },
          { name: 'actorId', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Audit event list' },
        },
      },
    },
    '/admin/audit/export': {
      get: {
        summary: 'Export filtered privileged audit events as JSON',
        parameters: [
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'resourceType', in: 'query', schema: { type: 'string' } },
          { name: 'actorId', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 } },
        ],
        responses: {
          '200': { description: 'Filtered audit export artifact' },
          '403': { description: 'Requires audit read permission' },
        },
      },
    },
    '/admin/audit/{id}': {
      get: {
        summary: 'Read a single privileged audit event',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Audit event detail' },
          '403': { description: 'Requires audit read permission' },
          '404': { description: 'Audit event not found' },
        },
      },
    },
    '/admin/creative/generations': {
      get: {
        summary: 'List read-only creative generation history for Admin operations',
        parameters: [
          { name: 'userHandle', in: 'query', schema: { type: 'string' } },
          { name: 'actorHandle', in: 'query', schema: { type: 'string' } },
          { name: 'workspace', in: 'query', schema: { type: 'string', enum: ['image', 'video', 'music', 'chat'] } },
          { name: 'mode', in: 'query', schema: { type: 'string' } },
          { name: 'providerId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required'] } },
          { name: 'reviewRequired', in: 'query', schema: { type: 'boolean' } },
          { name: 'mediaAssetId', in: 'query', schema: { type: 'string' } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Creative generation history list with sanitized provider cost, budget, and replay evidence summaries when available' },
          '403': { description: 'Requires audit read permission' },
        },
      },
    },
    '/admin/creative/generations/{id}': {
      get: {
        summary: 'Read a single creative generation history record',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Creative generation history detail with sanitized provider cost, budget, and replay evidence summaries when available' },
          '403': { description: 'Requires audit read permission' },
          '404': { description: 'Creative generation record not found' },
        },
      },
    },
    '/admin/security/events': {
      get: {
        summary: 'List recent security guard and anomaly events',
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'source', in: 'query', schema: { type: 'string', enum: ['rate_limit', 'body_size', 'auth_failure'] } },
          { name: 'severity', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Security event list' },
          '403': { description: 'Requires audit read permission' },
        },
      },
    },
    '/admin/security/alerts': {
      get: {
        summary: 'List aggregated security event alerts',
        responses: {
          '200': { description: 'Security alert list' },
          '403': { description: 'Requires audit read permission' },
        },
      },
    },
    '/admin/security/alerts/{id}/events': {
      get: {
        summary: 'List recent security event samples for an alert',
        responses: {
          '200': { description: 'Security event samples' },
          '403': { description: 'Requires audit read permission' },
          '404': { description: 'Alert not found' },
        },
      },
    },
    '/admin/security/alerts/{id}/export': {
      get: {
        summary: 'Export a security alert investigation artifact',
        responses: {
          '200': { description: 'Security alert JSON artifact' },
          '403': { description: 'Requires audit read permission' },
          '404': { description: 'Alert not found' },
        },
      },
    },
    '/admin/security/alerts/{id}/acknowledge': {
      post: {
        summary: 'Acknowledge a security alert',
        responses: {
          '200': { description: 'Updated security alert acknowledgement state' },
          '403': { description: 'Requires security alert management permission' },
          '404': { description: 'Alert not found' },
        },
      },
    },
    '/admin/security/alerts/{id}/silence': {
      post: {
        summary: 'Silence a security alert',
        responses: {
          '200': { description: 'Updated security alert silence state' },
          '400': { description: 'Invalid silence window' },
          '403': { description: 'Requires security alert management permission' },
          '404': { description: 'Alert not found' },
        },
      },
    },
    '/admin/security/alerts/{id}/unsilence': {
      post: {
        summary: 'Remove a security alert silence',
        responses: {
          '200': { description: 'Updated security alert after removing silence' },
          '403': { description: 'Requires security alert management permission' },
          '404': { description: 'Alert not found' },
        },
      },
    },
    '/admin/operations/metrics': {
      get: {
        summary: 'Return security and media operations metric aggregates',
        parameters: [
          { name: 'windowMinutes', in: 'query', schema: { type: 'integer', minimum: 5, maximum: 1440, default: 60 } },
        ],
        responses: {
          '200': { description: 'Operations metrics summary for the requested time window' },
          '400': { description: 'Invalid metrics window' },
          '403': { description: 'Requires audit read permission' },
        },
      },
    },
    '/admin/operations/metrics/export': {
      get: {
        summary: 'Export an auditable operations metrics handoff snapshot',
        parameters: [
          { name: 'windowMinutes', in: 'query', schema: { type: 'integer', minimum: 5, maximum: 1440, default: 60 } },
        ],
        responses: {
          '200': { description: 'Operations metrics handoff artifact with samples and remediation hints' },
          '400': { description: 'Invalid metrics window' },
          '403': { description: 'Requires audit read permission' },
        },
      },
    },
    '/admin/points/ledger': {
      get: {
        summary: 'Search points ledger entries across users',
        parameters: [
          { name: 'userHandle', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'settled', 'cancelled'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Admin points ledger rows and balance summary' },
          '403': { description: 'Requires points adjustment permission' },
        },
      },
    },
    '/admin/points/ledger.csv': {
      get: {
        summary: 'Export filtered points ledger rows as CSV',
        parameters: [
          { name: 'userHandle', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'settled', 'cancelled'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': {
            description: 'CSV ledger export',
            content: {
              'text/csv': {
                schema: { type: 'string' },
              },
            },
          },
          '403': { description: 'Requires points adjustment permission' },
        },
      },
    },
    '/admin/points/adjustments': {
      post: {
        summary: 'Create or request a manual points adjustment',
        description: 'Applies adjustments within the actor role direct limit; otherwise creates a points review item that requires a different approver with points:adjust.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userHandle', 'delta', 'reason'],
                properties: {
                  userHandle: { type: 'string' },
                  delta: { type: 'integer', minimum: -1000000, maximum: 1000000 },
                  reason: { type: 'string' },
                  reasonCode: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Applied adjustment or created a high-value review request' },
          '403': { description: 'Requires points adjustment permission' },
          '404': { description: 'User handle not found' },
        },
      },
    },
    '/admin/points/policy': {
      get: {
        summary: 'Get point adjustment policy',
        responses: {
          '200': { description: 'Point adjustment role limits and review templates' },
          '403': { description: 'Requires points adjustment permission' },
        },
      },
      put: {
        summary: 'Update point adjustment policy',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['roleLimits', 'reasonCodes', 'approvalTemplates'],
                properties: {
                  roleLimits: {
                    type: 'object',
                    properties: {
                      member: { type: 'integer', minimum: 0, maximum: 1000000 },
                      creator: { type: 'integer', minimum: 0, maximum: 1000000 },
                      publisher: { type: 'integer', minimum: 0, maximum: 1000000 },
                      moderator: { type: 'integer', minimum: 0, maximum: 1000000 },
                      admin: { type: 'integer', minimum: 0, maximum: 1000000 },
                    },
                  },
                  reasonCodes: { type: 'array', items: { type: 'string' } },
                  approvalTemplates: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated point adjustment policy' },
          '403': { description: 'Requires permission management access' },
        },
      },
    },
    '/admin/points/policy/history': {
      get: {
        summary: 'List point policy change history',
        responses: {
          '200': { description: 'Policy change history with previous, next, diff, and summary' },
          '403': { description: 'Requires points adjustment permission' },
        },
      },
    },
    '/admin/points/policy/rollback': {
      post: {
        summary: 'Rollback point adjustment policy',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['eventId'],
                properties: {
                  eventId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Rolled back point adjustment policy' },
          '403': { description: 'Requires permission management access' },
          '404': { description: 'Policy history event not found or cannot be rolled back' },
        },
      },
    },
    '/notifications': {
      get: {
        summary: 'List current user notifications',
        parameters: [
          { name: 'readState', in: 'query', schema: { type: 'string', enum: ['unread', 'read', 'all'] } },
          { name: 'unreadOnly', in: 'query', schema: { type: 'boolean' } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'resourceType', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Notification inbox for the current user' },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/notifications/{id}/read': {
      post: {
        summary: 'Mark a notification as read',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Updated notification' },
          '401': { description: 'Authentication required' },
          '404': { description: 'Notification not found for the current user' },
        },
      },
    },
    '/notifications/read-all': {
      post: {
        summary: 'Mark every current-user notification as read',
        responses: {
          '200': { description: 'Number of notifications updated' },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/admin/permissions': {
      get: {
        summary: 'List permission catalog',
        responses: {
          '200': { description: 'Permission catalog' },
        },
      },
    },
    '/admin/roles': {
      get: {
        summary: 'List role permission matrix',
        responses: {
          '200': { description: 'Role permission matrix' },
        },
      },
    },
    '/admin/roles/{role}/permissions': {
      put: {
        summary: 'Update role permission grants',
        parameters: [{ name: 'role', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['permissions'],
                properties: {
                  permissions: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated role permission matrix row' },
        },
      },
    },
    '/admin/reviews': {
      get: {
        summary: 'List admin review queues',
        parameters: [
          { name: 'queue', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Review queue list' },
        },
      },
    },
    '/admin/reviews/{id}/actions': {
      post: {
        summary: 'Review an admin queue item',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['decision'],
                properties: {
                  decision: { type: 'string', enum: ['approve', 'reject'] },
                  note: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Reviewed queue item' },
        },
      },
    },
  },
}
