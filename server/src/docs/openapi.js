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
    '/admin/auth/oauth/providers': {
      get: {
        summary: 'List secret-free OAuth Provider controls and environment readiness',
        parameters: [],
        responses: {
          '200': { description: 'Provider control state, version, mode, callback method, and scopes' },
          '403': { description: 'Missing admin:auth:read' },
        },
      },
    },
    '/admin/auth/oauth/providers/{provider}/status': {
      post: {
        summary: 'Enable or disable one OAuth Provider with optimistic version control',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['enabled', 'expectedVersion', 'reasonCode'], additionalProperties: false,
            properties: { enabled: { type: 'boolean' }, expectedVersion: { type: 'integer', minimum: 0 }, reasonCode: { type: 'string', pattern: '^[a-z0-9][a-z0-9._:-]{0,79}$' } },
          } } },
        },
        responses: { '200': { description: 'Updated Provider control' }, '403': { description: 'Missing admin:auth:manage' }, '409': { description: 'Stale version or unavailable environment configuration' } },
      },
    },
    '/admin/auth/oauth/accounts': {
      get: {
        summary: 'Query linked OAuth accounts using a masked Provider identity projection',
        parameters: [
          { name: 'provider', in: 'query', schema: { type: 'string', enum: ['google', 'apple', 'discord'] } },
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 96 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['createdAt'] } },
          { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
        ],
        responses: { '200': { description: 'Bounded OAuth account page' }, '403': { description: 'Missing admin:auth:read' } },
      },
    },
    '/admin/auth/oauth/accounts/{id}': {
      delete: {
        summary: 'Unlink an OAuth account while preserving a final sign-in method',
        responses: { '200': { description: 'OAuth account unlinked' }, '403': { description: 'Missing admin:auth:manage' }, '404': { description: 'OAuth account not found' }, '409': { description: 'Final sign-in method cannot be removed' } },
      },
    },
    '/admin/auth/oauth/authorization-requests': {
      get: {
        summary: 'Query safe OAuth authorization request lifecycle projections',
        parameters: [
          { name: 'provider', in: 'query', schema: { type: 'string', enum: ['google', 'apple', 'discord'] } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'consumed', 'revoked', 'expired'] } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['createdAt', 'expiresAt'] } },
          { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
        ],
        responses: { '200': { description: 'Bounded authorization request page without state or redirect context' }, '403': { description: 'Missing admin:auth:read' } },
      },
    },
    '/admin/auth/oauth/authorization-requests/{id}/revoke': {
      post: {
        summary: 'Revoke one pending OAuth authorization request',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['reasonCode'], additionalProperties: false, properties: { reasonCode: { type: 'string', pattern: '^[a-z0-9][a-z0-9._:-]{0,79}$' } } } } } },
        responses: { '200': { description: 'Authorization request revoked' }, '403': { description: 'Missing admin:auth:manage' }, '404': { description: 'Authorization request not found' }, '409': { description: 'Authorization request is not pending' } },
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
                          available: { type: 'boolean' },
                          mode: { type: 'string', enum: ['dev', 'external', 'unavailable'] },
                          authorizationUrl: { type: ['string', 'null'], format: 'uri' },
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
          { name: 'provider', in: 'path', required: true, schema: { type: 'string', enum: ['google', 'apple', 'discord'] } },
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
          '503': { description: 'Provider is unavailable in this environment' },
        },
      },
    },
    '/auth/oauth/{provider}/callback': {
      get: {
        summary: 'Complete OAuth login from provider callback',
        parameters: [
          { name: 'provider', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'state', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'code', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'error', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Browser OAuth bridge HTML for top-level redirects' },
          '201': { description: 'Session tokens and user' },
          '400': { description: 'Invalid or expired OAuth state' },
          '401': { description: 'Provider response could not be verified' },
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
                required: ['state'],
                properties: {
                  state: { type: 'string' },
                  code: { type: 'string' },
                  error: { type: 'string' },
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
          '401': { description: 'Provider response could not be verified' },
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
    '/admin/tasks': {
      get: {
        summary: 'List tasks for administrative operations',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'open', 'assigned', 'in_progress', 'submitted', 'pending_review', 'disputed', 'completed', 'rejected', 'cancelled', 'expired'] } },
          { name: 'archiveState', in: 'query', schema: { type: 'string', enum: ['active', 'archived', 'all'], default: 'active' } },
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'publisherHandle', in: 'query', schema: { type: 'string' } },
          { name: 'assigneeHandle', in: 'query', schema: { type: 'string' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['createdAt', 'updatedAt', 'deadlineAt', 'status', 'title'], default: 'updatedAt' } },
          { name: 'direction', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          '200': { description: 'Owner-safe task operations page with stable cursor metadata' },
          '403': { description: 'Requires admin:tasks:read' },
        },
      },
    },
    '/admin/tasks/summary': {
      get: {
        summary: 'Summarize task operations by lifecycle and archive state',
        responses: {
          '200': { description: 'Total, active, archived, and status counts' },
          '403': { description: 'Requires admin:tasks:read' },
        },
      },
    },
    '/admin/tasks/{id}': {
      get: {
        summary: 'Read one administrative task projection',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Task detail including version and archive evidence' }, '403': { description: 'Requires admin:tasks:read' }, '404': { description: 'Task not found' } },
      },
      patch: {
        summary: 'Edit bounded fields on a draft or open task',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['expectedVersion', 'reasonCode'], properties: {
            expectedVersion: { type: 'integer', minimum: 1 }, reasonCode: { type: 'string' }, note: { type: 'string', maxLength: 240 },
            title: { type: 'string' }, category: { type: 'string' }, description: { type: 'string' }, acceptanceRules: { type: 'string' },
            visibility: { type: 'string', enum: ['public', 'community', 'invite_only'] }, deadlineAt: { type: ['string', 'null'], format: 'date-time' },
          } } } },
        },
        responses: { '200': { description: 'Updated task with incremented version' }, '403': { description: 'Requires admin:tasks:manage' }, '409': { description: 'Version conflict or task is no longer editable' } },
      },
    },
    '/admin/tasks/{id}/archive': {
      post: {
        summary: 'Soft archive an eligible task',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expectedVersion', 'reasonCode'], properties: { expectedVersion: { type: 'integer', minimum: 1 }, reasonCode: { type: 'string' }, note: { type: 'string', maxLength: 240 } } } } } },
        responses: { '200': { description: 'Archived task evidence' }, '403': { description: 'Requires admin:tasks:manage' }, '409': { description: 'Version conflict or active fulfillment task' } },
      },
    },
    '/admin/tasks/{id}/restore': {
      post: {
        summary: 'Restore a soft archived task',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expectedVersion', 'reasonCode'], properties: { expectedVersion: { type: 'integer', minimum: 1 }, reasonCode: { type: 'string' }, note: { type: 'string', maxLength: 240 } } } } } },
        responses: { '200': { description: 'Restored task with incremented version' }, '403': { description: 'Requires admin:tasks:manage' }, '409': { description: 'Version conflict' } },
      },
    },
    '/admin/tasks/{id}/transitions': {
      post: {
        summary: 'Apply an explicit administrative task status transition',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expectedVersion', 'action', 'reasonCode'], properties: { expectedVersion: { type: 'integer', minimum: 1 }, action: { type: 'string', enum: ['publish', 'cancel'] }, reasonCode: { type: 'string' }, note: { type: 'string', maxLength: 240 } } } } } },
        responses: { '200': { description: 'Transitioned task and accounting evidence' }, '403': { description: 'Requires admin:tasks:manage' }, '409': { description: 'Invalid transition or version conflict' } },
      },
    },
    '/admin/tasks/{id}/lifecycle': {
      get: {
        summary: 'List immutable cancellation, expiry, and recovery evidence for a task',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'cursor', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } }],
        responses: { '200': { description: 'Task lifecycle mutation evidence page' }, '403': { description: 'Requires admin:tasks:read' }, '404': { description: 'Task not found' } },
      },
    },
    '/admin/tasks/{id}/recovery': {
      post: {
        summary: 'Run a registered terminal-task escrow reconciliation',
        description: 'Only the release_escrow action is accepted, and only for cancelled or expired tasks. This endpoint cannot assign an arbitrary task status.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['action', 'expectedVersion', 'idempotencyKey', 'reasonCode'], properties: { action: { type: 'string', enum: ['release_escrow'] }, expectedVersion: { type: 'integer', minimum: 1 }, idempotencyKey: { type: 'string' }, reasonCode: { type: 'string' }, note: { type: 'string', maxLength: 240 } } } } } },
        responses: { '200': { description: 'Stable reconciliation evidence' }, '403': { description: 'Requires admin:tasks:manage' }, '409': { description: 'Version, state, or idempotency conflict' } },
      },
    },
    '/admin/tasks/expiry/sweep': {
      post: {
        summary: 'Run the registered bounded task expiry sweep',
        requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } } } } } },
        responses: { '200': { description: 'Scanned and expired counts with mutation evidence' }, '403': { description: 'Requires admin:tasks:manage' } },
      },
    },
    '/admin/tasks/bulk/preview': {
      post: {
        summary: 'Preview bounded task archive or cancellation disposition',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['action', 'targetIds'], properties: { action: { type: 'string', enum: ['archive', 'cancel'] }, targetIds: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string' } } } } } } },
        responses: { '200': { description: 'Eligibility, target hash, and required confirmation phrase' }, '403': { description: 'Requires admin:tasks:manage' } },
      },
    },
    '/admin/tasks/bulk': {
      post: {
        summary: 'Execute a previewed idempotent task disposition',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['action', 'targetIds', 'targetHash', 'confirmationText', 'idempotencyKey', 'reasonCode'], properties: { action: { type: 'string', enum: ['archive', 'cancel'] }, targetIds: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string' } }, targetHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, confirmationText: { type: 'string' }, idempotencyKey: { type: 'string' }, reasonCode: { type: 'string' }, note: { type: 'string', maxLength: 240 } } } } } },
        responses: { '200': { description: 'Stable per-target result including explicit skips' }, '403': { description: 'Requires admin:tasks:manage' }, '409': { description: 'Target hash or idempotency conflict' } },
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
    '/tasks/{id}/workflow': {
      get: {
        summary: 'Return actor-scoped task lifecycle state and allowed actions',
        description: 'The server derives an allowlisted role and actions from current task, proposal, submission, dispute, and permission state. Clients must not infer mutation eligibility from local UI state.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Task workflow eligibility',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['taskId', 'taskStatus', 'role', 'actions'],
                  properties: {
                    taskId: { type: 'string' },
                    taskStatus: { type: 'string' },
                    disputeStatus: { type: ['string', 'null'] },
                    latestSubmissionStatus: { type: ['string', 'null'] },
                    role: { type: 'string', enum: ['publisher', 'assignee', 'proposer', 'admin', 'viewer'] },
                    actions: {
                      type: 'array',
                      uniqueItems: true,
                      items: { type: 'string', enum: ['view', 'propose', 'claim', 'review_proposals', 'submit', 'review_submission', 'open_dispute', 'view_timeline', 'cancel'] },
                    },
                    version: { type: 'integer', minimum: 1 },
                    cancelledAt: { type: ['string', 'null'], format: 'date-time' },
                    expiredAt: { type: ['string', 'null'], format: 'date-time' },
                    terminalReasonCode: { type: ['string', 'null'] },
                  },
                },
              },
            },
          },
          '401': { description: 'Authentication required' },
          '404': { description: 'Task not found' },
        },
      },
    },
    '/tasks/delivery-targets': {
      get: {
        summary: 'List tasks the current actor can legally submit to',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Owner-scoped submit-ready task projections' },
          '403': { description: 'Requires task submit permission' },
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
    '/tasks/{id}/cancel': {
      post: {
        summary: 'Cancel an owned draft or open task and release escrow',
        description: 'The transition, immutable idempotency record, escrow release, and audit evidence commit atomically. Replaying the same request returns the prior result.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expectedVersion', 'idempotencyKey'], properties: { expectedVersion: { type: 'integer', minimum: 1 }, idempotencyKey: { type: 'string' }, reasonCode: { type: 'string', default: 'user_cancelled' }, note: { type: 'string', maxLength: 240 } } } } } },
        responses: { '200': { description: 'Stable cancellation mutation evidence' }, '403': { description: 'Requires task:cancel and publisher ownership' }, '409': { description: 'Version, state, or idempotency conflict' } },
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
          '201': { description: 'Created task proposal or recovered the same creator payload' },
          '409': { description: 'Task is closed, publisher self-proposal, or the creator already has a different proposal' },
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
          '200': { description: 'Reviewed task proposal or recovered the same prior decision' },
          '409': { description: 'Proposal or task was decided concurrently or already has a different decision' },
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
        summary: 'Submit task work with immutable governed asset evidence',
        description: 'Every asset id is revalidated for owner, active uploaded state, clean scan, compatible purpose, and completed source generation. The submission stores an allowlisted evidence snapshot and rights note; later asset archival does not alter that evidence.',
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
          '201': { description: 'Updated task and created a normalized submission, or recovered an identical pending payload' },
          '409': { description: 'Task is not submit-ready, another payload is pending, or an asset fails delivery governance' },
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
        description: 'The submitter can dispute the latest rejected or stale submission. This conditionally marks the task and submission disputed, opens one stable task_disputes Admin review, notifies reviewers, and writes a task timeline event. Repeating the same reason recovers the existing result.',
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
          '409': { description: 'A different dispute is already open or state changed concurrently' },
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
        description: 'Approval requires all supplied acceptance checklist items to be checked, settles escrow and the creator reward, and increments reputation once. Rejection keeps escrow pending for revision or dispute; rejected Admin dispute resolution releases escrow. Conditional transitions make repeated identical reviews idempotent.',
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
                  checksumSha256: { type: 'string', pattern: '^(?:[a-fA-F0-9]{64}|[A-Za-z0-9+/]{43}=)$', description: 'Required for S3 uploads and signed as x-amz-checksum-sha256.' },
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
    '/media/assets': {
      get: {
        summary: 'List owner-scoped governed creative assets without private storage or Provider fields',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'mediaType', in: 'query', schema: { type: 'string', enum: ['image', 'video', 'audio', 'document'] } },
          { name: 'purpose', in: 'query', schema: { type: 'string', enum: ['task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset'] } },
          { name: 'workspace', in: 'query', schema: { type: 'string', enum: ['image', 'video', 'music', 'chat'] } },
          { name: 'lifecycle', in: 'query', schema: { type: 'string', enum: ['active', 'archived', 'deleted', 'all'], default: 'active' } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: { '200': { description: 'Safe asset list and stable pagination metadata' }, '401': { description: 'Authentication required' } },
      },
    },
    '/media/assets/{id}': {
      get: {
        summary: 'Get an owner-scoped safe asset detail with lineage and action eligibility',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Safe asset detail' }, '404': { description: 'Asset not found or not owned by the caller' } },
      },
      delete: {
        summary: 'Soft-delete an owned asset and immediately revoke download, reuse, and public portfolio projection',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Soft-deleted safe asset detail with retained lineage evidence' }, '404': { description: 'Asset not found or not owned by the caller' } },
      },
    },
    '/media/assets/{id}/library': {
      post: {
        summary: 'Save an owned governed creative output as an idempotent private library reference',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '201': { description: 'Private LibraryItem reference; no media bytes or provenance are copied' },
          '409': { description: 'Asset fails delivery governance or lacks completed generation evidence' },
        },
      },
    },
    '/media/assets/{id}/portfolio': {
      post: {
        summary: 'Create an idempotent private portfolio draft from a governed creative output',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, caption: { type: 'string' }, sourceSubmissionId: { type: ['string', 'null'] } } } } } },
        responses: {
          '201': { description: 'Draft normalized portfolio relation; it is not public until explicitly published' },
          '409': { description: 'Asset or optional source submission fails governance validation' },
        },
      },
    },
    '/media/assets/{id}/archive': {
      post: {
        summary: 'Archive an owned asset without deleting referenced delivery evidence',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Archived safe asset detail' }, '404': { description: 'Asset not found or not owned by the caller' } },
      },
    },
    '/media/assets/{id}/restore': {
      post: {
        summary: 'Restore an owned archived asset',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Restored safe asset detail' }, '404': { description: 'Asset not found or not owned by the caller' } },
      },
    },
    '/media/assets/{id}/recover': {
      post: {
        summary: 'Recover an owned soft-deleted asset without silently republishing portfolio records',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Recovered safe asset detail' }, '404': { description: 'Asset not found or not owned by the caller' } },
      },
    },
    '/admin/media/assets': {
      get: {
        summary: 'List safe cross-owner media lifecycle records for administrators',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'ownerHandle', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'uploaded', 'rejected'] } },
          { name: 'storageState', in: 'query', schema: { type: 'string', enum: ['pending_upload', 'verifying', 'quarantined', 'available', 'cleanup_pending', 'deleting', 'deleted', 'verification_failed'] } },
          { name: 'purpose', in: 'query', schema: { type: 'string', enum: ['task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset'] } },
          { name: 'lifecycle', in: 'query', schema: { type: 'string', enum: ['active', 'archived', 'deleted', 'all'], default: 'all' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['created_desc', 'created_asc', 'updated_desc', 'name_asc'] } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: { '200': { description: 'Safe lifecycle list with owner and portfolio state summaries' }, '403': { description: 'Requires admin media read permission' } },
      },
    },
    '/admin/media/assets/export': {
      get: {
        summary: 'Export a bounded filtered safe media asset projection as JSON or CSV',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'], default: 'json' } }],
        responses: { '200': { description: 'Safe export without storage keys, signed URLs, or raw metadata' }, '403': { description: 'Requires admin media export permission' } },
      },
    },
    '/admin/media/assets/bulk-actions': {
      post: {
        summary: 'Apply a bounded audited lifecycle action with per-item outcomes',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ids', 'action'], properties: { ids: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string' } }, action: { type: 'string', enum: ['archive', 'restore', 'delete', 'recover'] }, reason: { type: 'string' } } } } } },
        responses: { '200': { description: 'Per-item succeeded and failed outcomes' }, '403': { description: 'Requires admin media manage permission' } },
      },
    },
    '/admin/media/storage/cleanup': {
      post: {
        summary: 'Run a bounded retention-gated private object cleanup sweep',
        security: [{ bearerAuth: [] }],
        requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 } } } } } },
        responses: { '200': { description: 'Per-object cleanup outcomes without storage keys or signed URLs' }, '403': { description: 'Requires admin media manage permission' }, '503': { description: 'One or more object deletions failed and are eligible for JobRun retry/DLQ' } },
      },
    },
    '/admin/media/assets/{id}': {
      get: {
        summary: 'Get a safe administrative media lifecycle detail',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Safe administrative media lifecycle detail with bounded scan history' }, '404': { description: 'Asset not found' } },
      },
    },
    '/admin/media/assets/{id}/scan': {
      post: {
        summary: 'Record an administrative clean or reject scan decision',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated safe media detail' }, '403': { description: 'Requires admin media manage permission' } },
      },
    },
    '/admin/media/assets/{id}/scan-retry': {
      post: {
        summary: 'Request a bounded media scan retry',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated safe media detail' }, '403': { description: 'Requires admin media manage permission' } },
      },
    },
    '/admin/media/assets/{id}/{action}': {
      post: {
        summary: 'Apply an audited archive, restore, delete, or recover transition',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string', enum: ['archive', 'restore', 'delete', 'recover'] } },
        ],
        responses: { '200': { description: 'Updated safe lifecycle detail' }, '403': { description: 'Requires admin media manage permission' }, '409': { description: 'Invalid lifecycle transition' } },
      },
    },
    '/media/assets/{id}/relations': {
      post: {
        summary: 'Create an idempotent owner-scoped parent, variant, or reuse relation',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['targetAssetId', 'relationType'], properties: { targetAssetId: { type: 'string' }, relationType: { type: 'string', enum: ['parent', 'variant', 'reused_as_input'] }, targetWorkspace: { type: ['string', 'null'], enum: ['image', 'video', 'music', 'chat', null] }, role: { type: ['string', 'null'] } } } } } },
        responses: { '200': { description: 'Updated safe asset detail' }, '409': { description: 'Relation cycle or ineligible reuse' }, '404': { description: 'Source or target asset not owned by the caller' } },
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
    '/chat/conversations': {
      get: {
        summary: 'List owner-scoped Chat conversations',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: {
          '200': { description: 'Encrypted application-owned conversation summaries' },
          '401': { description: 'Authentication required' },
          '503': { description: 'Chat encryption is unavailable' },
        },
      },
      post: {
        summary: 'Create an application-owned Chat conversation',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['mode'],
                properties: { mode: { type: 'string', enum: ['assistant', 'prompt_assist', 'storyboard'] } },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Conversation created' },
          '401': { description: 'Authentication required' },
          '503': { description: 'Chat encryption is unavailable' },
        },
      },
    },
    '/chat/conversations/{id}': {
      delete: {
        summary: 'Delete an owned Chat conversation and create restore-replay evidence',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Conversation deleted with bounded tombstone metadata' },
          '404': { description: 'Conversation not found for current owner' },
        },
      },
    },
    '/chat/conversations/{id}/messages': {
      get: {
        summary: 'Read decrypted messages from an owned Chat conversation',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 } },
        ],
        responses: {
          '200': { description: 'Owner-scoped decrypted messages' },
          '404': { description: 'Conversation not found for current owner' },
        },
      },
    },
    '/chat/conversations/{id}/turns/stream': {
      post: {
        summary: 'Start an idempotent Chat turn over server-sent events',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['clientTurnId', 'message', 'mode'],
                properties: {
                  clientTurnId: { type: 'string', minLength: 8, maxLength: 128 },
                  message: { type: 'string', maxLength: 4000 },
                  mode: { type: 'string', enum: ['assistant', 'prompt_assist', 'storyboard'] },
                  parameters: { type: 'object', additionalProperties: true },
                  inputAssetIds: {
                    type: 'array',
                    maxItems: 5,
                    uniqueItems: true,
                    items: { type: 'string', minLength: 1, maxLength: 128 },
                  },
                  productContext: {
                    type: 'array',
                    maxItems: 5,
                    uniqueItems: true,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['type', 'id'],
                      properties: {
                        type: { type: 'string', enum: ['task', 'library_item'] },
                        id: { type: 'string', minLength: 1, maxLength: 128 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'SSE stream containing authorized context metadata, classified deltas, usage, and terminal events' },
          '404': { description: 'Conversation not found for current owner' },
          '422': { description: 'Context, safety, or request contract rejected before dispatch' },
        },
      },
    },
    '/chat/input-assets': {
      get: {
        summary: 'List current user scan-clean assets eligible for Chat attachment metadata',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 24 } },
        ],
        responses: {
          '200': { description: 'Owner-scoped Chat attachment metadata without storage keys or object bytes' },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/chat/turns/{id}/stop': {
      post: {
        summary: 'Request idempotent stop for an owned Chat turn',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Stop request state and current turn snapshot' },
          '404': { description: 'Turn not found for current owner' },
        },
      },
    },
    '/creative/input-assets': {
      get: {
        summary: 'List current user clean image assets available as creative inputs',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 24 } },
        ],
        responses: {
          '200': { description: 'Owner-scoped governed image assets with pagination metadata' },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/creative/accounting-policy': {
      get: {
        summary: 'Read the active immutable creative accounting policy',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'CreativeAccountingPolicyV1 manifest with separate credit, quota, and Provider cost units' },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/creative/accounting-policy/preview': {
      get: {
        summary: 'Preview creative credits, quota, capability, and Provider cost availability before generation',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'workspace', in: 'query', required: true, schema: { type: 'string', enum: ['image', 'video', 'music', 'chat'] } },
          { name: 'mode', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'providerId', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Actor-scoped preflight estimate; Provider cost is available/unavailable and never converted from credits' },
          '400': { description: 'Unsupported workspace or mode' },
          '401': { description: 'Authentication required' },
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
                              mode: { type: 'string', enum: ['mock', 'openai_image', 'openai_chat', 'anthropic_chat', 'replicate_staging'] },
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
                                    allModes: { type: 'array', items: { type: 'string' } },
                                    contractVersion: { type: 'string', enum: ['image-capability-v1', 'chat-capability-v1'] },
                                    modeContracts: {
                                      type: 'array',
                                      items: {
                                        type: 'object',
                                        properties: {
                                          id: { type: 'string', enum: ['text_to_image', 'image_to_image', 'image_edit', 'image_variation', 'assistant', 'prompt_assist', 'storyboard'] },
                                          label: { type: 'string' },
                                          runtimeAvailable: { type: 'boolean' },
                                          available: { type: 'boolean' },
                                          unavailableReason: { type: ['string', 'null'] },
                                          inputAssets: {
                                            type: 'object',
                                            properties: {
                                              minimum: { type: 'integer' },
                                              maximum: { type: 'integer' },
                                              purposes: { type: 'array', items: { type: 'string' } },
                                              contentTypes: { type: 'array', items: { type: 'string' } },
                                            },
                                          },
                                          parameters: { type: 'array', items: { type: 'string' } },
                                        },
                                      },
                                    },
                                    inputAssetPurposes: { type: 'array', items: { type: 'string' } },
                                    outputTypes: { type: 'array', items: { type: 'string' } },
                                    maxPromptCharacters: { type: 'integer' },
                                    supportedParameters: { type: 'array', items: { type: 'string' } },
                                    parameterDefinitions: { type: 'object', additionalProperties: { type: 'object' } },
                                    output: { type: 'object' },
                                    modelDecision: { type: 'object' },
                                    runtime: { type: 'object' },
                                    cost: { type: 'object' },
                                    safety: { type: 'object' },
                                    context: { type: 'object' },
                                    persistence: { type: 'object' },
                                    tools: { type: 'object' },
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
                                  approvalRequired: { type: 'boolean' },
                                  adapterImplemented: { type: 'boolean' },
                                  httpClientImplemented: { type: 'boolean' },
                                  httpClientEnabled: { type: 'boolean' },
                                  networkCallsEnabled: { type: 'boolean' },
                                  synchronousOutput: { type: 'boolean' },
                                  streamingImplemented: { type: 'boolean' },
                                  providerStateStored: { type: 'boolean' },
                                  automaticFailoverAllowed: { type: 'boolean' },
                                  callbackImplemented: { type: 'boolean' },
                                  callbackEnabled: { type: 'boolean' },
                                  pollingImplemented: { type: 'boolean' },
                                  pollingEnabled: { type: 'boolean' },
                                  pollingWorkerEnabled: { type: 'boolean' },
                                  statusClientImplemented: { type: 'boolean' },
                                  statusClientEnabled: { type: 'boolean' },
                                  mutationClientImplemented: { type: 'boolean' },
                                  outputFetchClientImplemented: { type: 'boolean' },
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
          '503': { description: 'Callback or Provider output fetch is disabled, or lifecycle side effects require retry' },
        },
      },
    },
    '/creative/generation-center': {
      get: {
        summary: 'List the current user generation tasks across Image, Chat, Video, and Music',
        description: 'Returns one safe owner-scoped projection without raw prompts, Provider identifiers, private URLs, storage keys, or internal safety evidence.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'workspace', in: 'query', schema: { type: 'string', enum: ['image', 'video', 'music', 'chat'] } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required'] } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: {
          '200': { description: 'Newest-first stable cursor page of unified safe generation tasks' },
          '400': { description: 'Invalid workspace, status, date range, cursor, or limit' },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/creative/generation-center/{id}': {
      get: {
        summary: 'Read one owned generation task through the unified safe projection',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Safe task detail with cost summary, review state, governed assets, errors, action eligibility, and workspace deep link' },
          '401': { description: 'Authentication required' },
          '404': { description: 'Generation not found or belongs to another user' },
        },
      },
    },
    '/creative/generations': {
      get: {
        summary: 'List the current user creative generation history with safe lifecycle and governed output summaries',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'workspace', in: 'query', schema: { type: 'string', enum: ['image', 'video', 'music', 'chat'], default: 'image' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required'] } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: {
          '200': { description: 'Owner-scoped history page. Responses exclude raw prompts, Provider job/request ids, private URLs, storage keys, and internal audit evidence.' },
          '400': { description: 'Invalid workspace, status, cursor, or limit' },
          '401': { description: 'Authentication required' },
        },
      },
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
                  idempotencyKey: { type: 'string', minLength: 8, maxLength: 128, description: 'Actor-scoped create idempotency key. The web client always supplies one.' },
                  workspace: { type: 'string', enum: ['image', 'video', 'music', 'chat'] },
                  mode: { type: 'string' },
                  prompt: { type: 'string', maxLength: 4000 },
                  inputAssetIds: { type: 'array', items: { type: 'string' } },
                  parameters: { type: 'object', additionalProperties: true },
                  providerId: { type: ['string', 'null'] },
                },
                allOf: [{
                  if: { properties: { workspace: { const: 'image' } }, required: ['workspace'] },
                  then: {
                    properties: {
                      mode: { type: 'string', enum: ['text_to_image', 'image_to_image', 'image_edit', 'image_variation'] },
                      prompt: { type: 'string', maxLength: 2000 },
                      parameters: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          aspectRatio: { type: 'string', enum: ['1:1', '3:2', '2:3', '4:5', '5:4', '16:9', '9:16'] },
                          stylePreset: { type: 'string', enum: ['none', 'editorial', 'editorial_launch', 'poster', 'avatar', 'product_visual', 'logo_concept'] },
                          seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
                          strength: { type: 'number', minimum: 0, maximum: 1 },
                          quality: { type: 'string', enum: ['low', 'medium', 'high'] },
                          outputCount: { type: 'integer', minimum: 1, maximum: 1 },
                          outputFormat: { type: 'string', enum: ['png'] },
                        },
                      },
                    },
                  },
                }],
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
                            quotaUnits: { type: 'integer' },
                            creditEstimateKind: { type: 'string', enum: ['policy_estimate'] },
                            providerCostAvailability: {
                              type: 'object',
                              properties: {
                                availability: { type: 'string', enum: ['available', 'unavailable'] },
                                reasonCode: { type: ['string', 'null'] },
                              },
                            },
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
                            retryOfId: { type: ['string', 'null'] },
                            attemptNumber: { type: 'integer', minimum: 1 },
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
          '429': { description: 'Creative generation quota or durable Provider budget cap exceeded before dispatch' },
          '503': { description: 'Creative provider unavailable' },
        },
      },
    },
    '/creative/generations/{id}': {
      get: {
        summary: 'Read one owned creative generation with safe action eligibility and governed output summaries',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Safe user generation detail suitable for lifecycle polling' },
          '401': { description: 'Authentication required' },
          '404': { description: 'Generation not found or belongs to another user' },
        },
      },
    },
    '/creative/generations/{id}/cancel': {
      post: {
        summary: 'Cancel an owned queued or running generation with idempotent accounting closeout',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['idempotencyKey'],
                properties: {
                  idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
                  reasonCode: { type: 'string' },
                  note: { type: 'string', maxLength: 240 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Cancellation mutation and safe generation record' },
          '403': { description: 'Generation belongs to another user' },
          '409': { description: 'Generation state is not cancellable or Provider did not confirm cancellation' },
          '503': { description: 'Provider cancellation adapter is not configured; no Provider call is attempted' },
        },
      },
    },
    '/creative/generations/{id}/retry': {
      post: {
        summary: 'Retry an owned failed or cancelled generation as a new child attempt',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['idempotencyKey', 'generation'],
                properties: {
                  idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
                  reasonCode: { type: 'string' },
                  note: { type: 'string', maxLength: 240 },
                  authorizationMutationId: { type: ['string', 'null'] },
                  generation: {
                    type: 'object',
                    description: 'Full resubmitted generation request. Prompt hash and immutable inputs must match the original record.',
                    required: ['workspace', 'mode', 'prompt'],
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Retry mutation and new child generation, or the prior idempotent result' },
          '403': { description: 'Generation belongs to another user' },
          '409': { description: 'Generation is not retryable, inputs differ, or authorization is invalid' },
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
        summary: 'Verify an uploaded object with HEAD and begin governed scanning',
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
          '200': { description: 'Verified media asset in available or quarantined storage state' },
          '409': { description: 'Object missing, mismatched, already completing, or changed concurrently' },
          '503': { description: 'Storage verification dependency is unavailable' },
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
                required: ['status', 'externalScanId'],
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
          '200': { description: 'Updated scanned media asset; exact duplicate callbacks are idempotent' },
          '409': { description: 'Callback attempt mismatch, terminal result conflict, or concurrent transition' },
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
    '/profiles/me/portfolio': {
      get: {
        summary: 'List the current owner private portfolio records in every lifecycle state',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Private draft, published, withdrawn, and archived portfolio records' } },
      },
    },
    '/profiles/me/portfolio/{id}': {
      patch: {
        summary: 'Edit or explicitly transition an owned portfolio record',
        description: 'Supported actions are publish, withdraw, archive, and restore. Publish revalidates current asset governance. Restoring an archived record returns it to draft and never republishes automatically.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, caption: { type: 'string' }, sortOrder: { type: 'integer', minimum: 0 }, action: { type: 'string', enum: ['publish', 'withdraw', 'archive', 'restore'] } } } } } },
        responses: { '200': { description: 'Updated private portfolio record' }, '409': { description: 'Invalid lifecycle transition or asset governance failure' } },
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
        summary: 'Get a public profile with only clean active published portfolio assets',
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
    '/admin/observability/logs': {
      get: {
        summary: 'Search sanitized structured application logs',
        parameters: [
          { name: 'level', in: 'query', schema: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] } },
          { name: 'service', in: 'query', schema: { type: 'string' } },
          { name: 'module', in: 'query', schema: { type: 'string' } },
          { name: 'operation', in: 'query', schema: { type: 'string' } },
          { name: 'outcome', in: 'query', schema: { type: 'string', enum: ['success', 'client_error', 'server_error'] } },
          { name: 'errorCode', in: 'query', schema: { type: 'string' } },
          { name: 'requestId', in: 'query', schema: { type: 'string' } },
          { name: 'traceId', in: 'query', schema: { type: 'string', pattern: '^[a-f0-9]{32}$' } },
          { name: 'resourceType', in: 'query', schema: { type: 'string' } },
          { name: 'resourceId', in: 'query', schema: { type: 'string' } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          '200': { description: 'Cursor-paginated sanitized log records' },
          '400': { description: 'Invalid filter or date range exceeds 30 days' },
          '403': { description: 'Requires admin:observability:read' },
        },
      },
    },
    '/admin/observability/logs/export': {
      get: {
        summary: 'Export up to 1000 sanitized log records with an integrity manifest',
        responses: {
          '200': { description: 'Verifiable observability.log-export.v1 JSON artifact' },
          '403': { description: 'Requires admin:observability:export' },
        },
      },
    },
    '/admin/observability/logs/{id}': {
      get: {
        summary: 'Read one sanitized structured log record',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Sanitized log detail' },
          '403': { description: 'Requires admin:observability:read' },
          '404': { description: 'Log record not found' },
        },
      },
    },
    '/admin/observability/traces/{traceId}': {
      get: {
        summary: 'Reconstruct a trace timeline from persisted spans',
        parameters: [{ name: 'traceId', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{32}$' } }],
        responses: {
          '200': { description: 'Ordered trace spans and parent relationships' },
          '400': { description: 'Invalid W3C trace identifier' },
          '403': { description: 'Requires admin:observability:read' },
          '404': { description: 'Trace not found' },
        },
      },
    },
    '/admin/observability/slos': {
      get: {
        summary: 'Read API availability and latency SLO status',
        responses: {
          '200': { description: 'Thirty-day SLO status with 5-minute and 60-minute burn rates' },
          '403': { description: 'Requires admin:observability:read' },
        },
      },
    },
    '/admin/observability/slos/evaluate': {
      post: {
        summary: 'Evaluate SLO burn rates and persist alert transitions',
        responses: {
          '200': { description: 'SLO evaluation and current alerts' },
          '403': { description: 'Requires admin:observability:manage' },
        },
      },
    },
    '/admin/observability/alerts': {
      get: {
        summary: 'List SLO burn-rate alerts',
        responses: {
          '200': { description: 'Current and resolved observability alerts' },
          '403': { description: 'Requires admin:observability:read' },
        },
      },
    },
    '/admin/observability/alerts/{id}/acknowledge': {
      post: {
        summary: 'Acknowledge an observability alert using optimistic concurrency',
        responses: { '200': { description: 'Acknowledged alert' }, '409': { description: 'Alert version conflict' } },
      },
    },
    '/admin/observability/alerts/{id}/silence': {
      post: {
        summary: 'Silence an observability alert for at most seven days',
        responses: { '200': { description: 'Silenced alert' }, '409': { description: 'Alert version conflict' } },
      },
    },
    '/admin/observability/alerts/{id}/resolve': {
      post: {
        summary: 'Resolve an observability alert using optimistic concurrency',
        responses: { '200': { description: 'Resolved alert' }, '409': { description: 'Alert version conflict' } },
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
        summary: 'Export filtered privileged audit events as a portable verifiable JSON chain',
        parameters: [
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'resourceType', in: 'query', schema: { type: 'string' } },
          { name: 'actorId', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 } },
        ],
        responses: {
          '200': { description: 'Filtered audit export with integrity manifest, event links, and root hash' },
          '403': { description: 'Requires admin:audit:export' },
        },
      },
    },
    '/admin/audit/verify': {
      get: {
        summary: 'Verify the persisted audit event hash chain',
        responses: {
          '200': { description: 'Complete, broken, or unverifiable integrity result' },
          '403': { description: 'Requires admin:audit:verify' },
        },
      },
    },
    '/admin/audit/archives': {
      get: {
        summary: 'List immutable audit archive manifests',
        responses: {
          '200': { description: 'Recent archive manifests with sequence ranges and root hashes' },
          '403': { description: 'Requires admin:audit:read' },
        },
      },
      post: {
        summary: 'Anchor the current complete audit chain in an immutable archive manifest',
        requestBody: {
          required: false,
          content: { 'application/json': { schema: { type: 'object', properties: { objectRef: { type: 'string' } } } } },
        },
        responses: {
          '200': { description: 'Immutable archive manifest and integrity evidence' },
          '403': { description: 'Requires admin:audit:archive' },
          '409': { description: 'Audit chain is broken or unverifiable' },
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
    '/admin/accounting/reconciliation': {
      get: {
        summary: 'List internal accounting reconciliation issues',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'repair_pending', 'resolved', 'ignored'] } },
          { name: 'unit', in: 'query', schema: { type: 'string', enum: ['points', 'creative_credit', 'quota_unit'] } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Reconciliation issues with status summary and scan timestamp' },
          '403': { description: 'Requires admin:accounting:read' },
        },
      },
    },
    '/admin/accounting/reconciliation/scan': {
      post: {
        summary: 'Run and persist an internal accounting reconciliation scan',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'repair_pending', 'resolved', 'ignored'] } },
          { name: 'unit', in: 'query', schema: { type: 'string', enum: ['points', 'creative_credit', 'quota_unit'] } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Persisted reconciliation scan results' },
          '403': { description: 'Requires admin:accounting:scan' },
        },
      },
    },
    '/admin/accounting/reconciliation/export': {
      get: {
        summary: 'Export filtered internal accounting reconciliation evidence as JSON',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'repair_pending', 'resolved', 'ignored'] } },
          { name: 'unit', in: 'query', schema: { type: 'string', enum: ['points', 'creative_credit', 'quota_unit'] } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 } },
        ],
        responses: {
          '200': { description: 'Reconciliation evidence export artifact' },
          '403': { description: 'Requires admin:accounting:read' },
        },
      },
    },
    '/admin/accounting/reconciliation/{id}': {
      get: {
        summary: 'Read one internal accounting reconciliation issue',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Reconciliation issue detail and evidence' },
          '403': { description: 'Requires admin:accounting:read' },
          '404': { description: 'Reconciliation issue not found' },
        },
      },
    },
    '/admin/accounting/reconciliation/{id}/repair-requests': {
      post: {
        summary: 'Request reviewed compensation for a supported accounting issue',
        description: 'Queues a high-risk compensation request. Approval must come from a different admin and appends a compensation operation without rewriting historical movements.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['repairKind', 'reasonCode', 'reason'],
                properties: {
                  repairKind: { type: 'string', enum: ['compensation'] },
                  reasonCode: { type: 'string', enum: ['repair_missing_movement', 'repair_balance_drift'] },
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Repair review request and repair-pending issue' },
          '403': { description: 'Requires admin:accounting:repair' },
          '404': { description: 'Reconciliation issue not found' },
          '409': { description: 'Issue is stale, already closed, or not eligible for automated compensation' },
        },
      },
    },
    '/admin/creative/provider-controls': {
      get: {
        summary: 'List sanitized Provider controls, circuits, cap evidence, and retry state',
        parameters: [
          { name: 'providerId', in: 'query', schema: { type: 'string' } },
          { name: 'workspace', in: 'query', schema: { type: 'string', enum: ['image', 'video', 'music', 'chat'] } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Sanitized Provider operations bundle without account references, raw errors, failure keys, full hashes, secrets, or probe tokens' },
          '403': { description: 'Requires admin:creative:provider-control:read' },
        },
      },
    },
    '/admin/creative/provider-controls/disable': {
      post: {
        summary: 'Immediately disable new Provider dispatch for an existing control scope',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['resourceId', 'expectedVersion', 'reasonCode'],
            properties: {
              resourceId: { type: 'string' },
              expectedVersion: { type: 'integer', minimum: 0 },
              reasonCode: { type: 'string' },
            },
          } } },
        },
        responses: {
          '200': { description: 'Versioned control state disabled or idempotently unchanged' },
          '403': { description: 'Requires admin:creative:provider-control:manage' },
          '404': { description: 'Control scope not found' },
          '409': { description: 'Control version conflict' },
        },
      },
    },
    '/admin/creative/provider-controls/cap-evidence': {
      post: {
        summary: 'Record immutable expiring Provider-side cap evidence',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['sourceKey', 'scopeKey', 'providerId', 'providerAccountRef', 'currency', 'capAmount', 'sourceType', 'sourceRef', 'verifiedAt', 'expiresAt'],
            properties: {
              sourceKey: { type: 'string' },
              scopeKey: { type: 'string' },
              providerId: { type: 'string' },
              providerAccountRef: { type: 'string' },
              currency: { type: 'string', pattern: '^[A-Z]{3}$' },
              capAmount: { type: 'string' },
              remainingAmount: { type: ['string', 'null'] },
              sourceType: { type: 'string', enum: ['fixture_config', 'manual_attestation', 'injected_reader'] },
              sourceRef: { type: 'string' },
              verifiedAt: { type: 'string', format: 'date-time' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          } } },
        },
        responses: {
          '200': { description: 'Sanitized cap evidence summary; raw source and complete hashes are omitted' },
          '403': { description: 'Requires admin:creative:provider-control:manage' },
          '409': { description: 'Source-key payload conflict' },
        },
      },
    },
    '/admin/creative/provider-controls/recovery-requests': {
      post: {
        summary: 'Request second-person review for control enablement or circuit recovery',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['resourceId', 'target', 'expectedVersion', 'reasonCode'],
            properties: {
              resourceId: { type: 'string' },
              target: { type: 'string', enum: ['enable', 'half_open', 'closed'] },
              expectedVersion: { type: 'integer', minimum: 0 },
              reasonCode: { type: 'string' },
              probeTtlSeconds: { type: 'integer', minimum: 1, maximum: 300, default: 60 },
            },
          } } },
        },
        responses: {
          '200': { description: 'Pending recovery review; approval must be performed by another operator' },
          '403': { description: 'Requires admin:creative:provider-control:recover' },
          '409': { description: 'Duplicate or stale recovery request' },
        },
      },
    },
    '/admin/creative/accounting-policy/history': {
      get: {
        summary: 'Read immutable creative accounting policy history',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Immutable policy manifests; historical ledgers are not repriced' },
          '403': { description: 'Requires admin:audit:read' },
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
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['createdAt', 'updatedAt', 'status'], default: 'createdAt' } },
          { name: 'direction', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
        ],
        responses: {
          '200': { description: 'Creative generation history list with sanitized durable Provider cost ledger, pricing snapshot, budget, replay, mutation, and output-ingestion evidence summaries when available' },
          '403': { description: 'Requires audit read permission' },
        },
      },
    },
    '/admin/creative/generations/summary': {
      get: {
        summary: 'Aggregate generation lifecycle counts across the complete filtered dataset',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Totals grouped by status, workspace, and Provider plus active, failed, review, and output asset counts' },
          '403': { description: 'Requires admin:audit:read' },
        },
      },
    },
    '/admin/creative/generations/export': {
      get: {
        summary: 'Export a bounded filtered page of safe generation evidence',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'], default: 'json' } }],
        responses: {
          '200': { description: 'JSON or CSV generation evidence export' },
          '403': { description: 'Requires admin:audit:export' },
        },
      },
    },
    '/admin/creative/generations/bulk-preview': {
      post: {
        summary: 'Preview bounded generation cancellation or retry authorization',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['action', 'targetIds'],
                properties: {
                  action: { type: 'string', enum: ['cancel', 'authorize_retry'] },
                  targetIds: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Eligible, blocked, and missing counts with stable target hash and exact confirmation phrase' },
          '403': { description: 'Requires the dedicated permission for the selected action' },
        },
      },
    },
    '/admin/creative/generations/bulk-actions': {
      post: {
        summary: 'Execute a previewed bounded generation disposition with per-target idempotency',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['action', 'targetIds', 'targetHash', 'confirmationText', 'idempotencyKey'],
                properties: {
                  action: { type: 'string', enum: ['cancel', 'authorize_retry'] },
                  targetIds: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string' } },
                  targetHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                  confirmationText: { type: 'string' },
                  idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
                  reasonCode: { type: 'string', maxLength: 64 },
                  note: { type: 'string', maxLength: 240 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Bounded per-target succeeded, duplicate, blocked, and missing results' },
          '400': { description: 'Confirmation phrase or request validation failed' },
          '403': { description: 'Requires the dedicated permission for the selected action' },
          '409': { description: 'Target hash no longer matches the selected IDs' },
        },
      },
    },
    '/admin/creative/executions': {
      get: {
        summary: 'List safe create execution claims and recovery state',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Cursor page without idempotency keys, payload hashes, prompts, or Provider identifiers' },
          '403': { description: 'Requires admin:audit:read' },
        },
      },
    },
    '/admin/creative/executions/{id}/recover': {
      post: {
        summary: 'Resolve an expired execution lease as failed after operator evidence review',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Recovery-required claim marked failed; redispatch remains explicit through Retry' },
          '403': { description: 'Requires admin:creative:retry' },
          '404': { description: 'Recovery-required execution not found' },
        },
      },
    },
    '/admin/creative/generations/{id}': {
      get: {
        summary: 'Read a single creative generation history record',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Creative generation history detail with sanitized durable Provider cost ledger, pricing snapshot, budget, replay, mutation, and output-ingestion evidence summaries when available' },
          '403': { description: 'Requires audit read permission' },
          '404': { description: 'Creative generation record not found' },
        },
      },
    },
    '/admin/creative/generations/{id}/cancel': {
      post: {
        summary: 'Cancel an eligible generation as an authorized operator',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Idempotent cancellation mutation and safe generation record' },
          '403': { description: 'Requires admin:creative:cancel' },
          '409': { description: 'Generation is not cancellable' },
          '503': { description: 'Provider cancellation adapter is not configured' },
        },
      },
    },
    '/admin/creative/generations/{id}/retry-requests': {
      post: {
        summary: 'Create a retry authorization for the generation owner to confirm',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'One-time retry authorization mutation; no prompt is reconstructed or stored' },
          '403': { description: 'Requires admin:creative:retry' },
          '409': { description: 'Generation is not retryable' },
        },
      },
    },
    '/admin/creative/generations/{id}/manual-replay-requests': {
      post: {
        summary: 'Submit a safe manual Provider lifecycle replay for second-person review',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['providerId', 'providerMode', 'providerJobId', 'normalizedStatus', 'reasonCode'],
                properties: {
                  providerId: { type: 'string' },
                  providerMode: { type: 'string' },
                  providerJobId: { type: 'string' },
                  normalizedStatus: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'cancelled'] },
                  reasonCode: { type: 'string' },
                  note: { type: 'string', maxLength: 500 },
                  idempotencyKey: { type: 'string', maxLength: 220 },
                  providerEventId: { type: ['string', 'null'] },
                  occurredAt: { type: ['string', 'null'], format: 'date-time' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Pending manual replay mutation and review queue item' },
          '403': { description: 'Requires admin:creative:replay' },
          '409': { description: 'Provider binding, terminal state, or persisted output prerequisite failed' },
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
        summary: 'Return security, media, and Provider lifecycle operations metric aggregates',
        parameters: [
          { name: 'windowMinutes', in: 'query', schema: { type: 'integer', minimum: 5, maximum: 1440, default: 60 } },
        ],
        responses: {
          '200': { description: 'Operations metrics summary with low-cardinality Provider lifecycle, retry, budget, and control aggregates' },
          '400': { description: 'Invalid metrics window' },
          '403': { description: 'Requires audit read permission' },
        },
      },
    },
    '/admin/overview': {
      get: {
        summary: 'Return a permission-aware Admin operations overview',
        parameters: [
          { name: 'windowMinutes', in: 'query', schema: { type: 'integer', minimum: 5, maximum: 1440, default: 60 } },
        ],
        responses: {
          '200': { description: 'Bounded operations metrics, pending reviews, active alerts, and recovery items' },
          '400': { description: 'Invalid overview window' },
          '403': { description: 'Requires Admin console access' },
        },
      },
    },
    '/admin/search': {
      get: {
        summary: 'Search permission-aware safe projections across Admin resource families',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 80 } },
          { name: 'types', in: 'query', schema: { type: 'string', description: 'Comma-separated allowlisted resource types' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 20, default: 20 } },
          { name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 300 } },
        ],
        responses: {
          '200': { description: 'Safe bounded search projections with Admin deep links' },
          '400': { description: 'Invalid query, type, or limit' },
          '403': { description: 'Requires Admin console access' },
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
          '200': { description: 'Operations metrics handoff artifact with safe Provider lifecycle samples, audit filters, and remediation hints' },
          '400': { description: 'Invalid metrics window' },
          '403': { description: 'Requires audit read permission' },
        },
      },
    },
    '/admin/releases': {
      get: {
        summary: 'List release changes and immutable evidence',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending_approval', 'approved', 'rejected', 'deployed', 'failed', 'rolled_back'] } },
          { name: 'targetEnvironment', in: 'query', schema: { type: 'string', enum: ['development', 'staging', 'production'] } },
          { name: 'changeType', in: 'query', schema: { type: 'string', enum: ['promotion', 'secret_rotation', 'configuration'] } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: { '200': { description: 'Cursor-paginated release changes' }, '403': { description: 'Requires release read permission' } },
      },
      post: {
        summary: 'Request an environment, configuration, or SecretRef release change',
        description: 'Creates a pending change with artifact and rollback versions. Plaintext secret fields are rejected.',
        responses: { '200': { description: 'Pending release change with request evidence' }, '400': { description: 'Invalid environment, version, or SecretRef' }, '403': { description: 'Requires release management permission' } },
      },
    },
    '/admin/releases/{id}': {
      get: {
        summary: 'Get one release change and its evidence chain',
        responses: { '200': { description: 'Release change details' }, '403': { description: 'Requires release read permission' }, '404': { description: 'Release change not found' } },
      },
    },
    '/admin/releases/{id}/approve': {
      post: {
        summary: 'Approve a release change using two-person control',
        responses: { '200': { description: 'Approved release change' }, '400': { description: 'Requester cannot self-approve' }, '409': { description: 'Invalid or concurrent transition' } },
      },
    },
    '/admin/releases/{id}/reject': {
      post: {
        summary: 'Reject a release change using two-person control',
        responses: { '200': { description: 'Rejected release change' }, '400': { description: 'Requester cannot self-review' }, '409': { description: 'Invalid or concurrent transition' } },
      },
    },
    '/admin/releases/{id}/apply': {
      post: {
        summary: 'Record a deployment outcome and evidence URL',
        responses: { '200': { description: 'Deployed or failed release change' }, '409': { description: 'Change is not approved or was modified concurrently' } },
      },
    },
    '/admin/releases/{id}/rollback': {
      post: {
        summary: 'Record rollback to the required rollback version',
        responses: { '200': { description: 'Rolled-back release change with evidence' }, '409': { description: 'Change cannot be rolled back or was modified concurrently' } },
      },
    },
    '/admin/settings': {
      get: {
        summary: 'List registered system settings by category and search text',
        parameters: [
          { name: 'category', in: 'query', schema: { type: 'string', maxLength: 96 } },
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 96 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: { '200': { description: 'Registered settings with current published projections' }, '403': { description: 'Requires settings read permission' } },
      },
    },
    '/admin/settings/changes': {
      get: {
        summary: 'List versioned system setting changes',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending_approval', 'approved', 'rejected', 'published'] } },
          { name: 'settingKey', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: { '200': { description: 'Cursor-paginated setting changes' }, '403': { description: 'Requires settings read permission' } },
      },
    },
    '/admin/settings/changes/{id}': {
      get: { summary: 'Read one system setting change', responses: { '200': { description: 'Setting change detail' }, '404': { description: 'Change not found' } } },
    },
    '/admin/settings/{key}': {
      get: { summary: 'Read one registered system setting', responses: { '200': { description: 'Current setting projection and schema' }, '404': { description: 'Setting not registered' } } },
    },
    '/admin/settings/{key}/history': {
      get: { summary: 'List immutable published revisions for one setting', responses: { '200': { description: 'Cursor-paginated setting revisions' }, '404': { description: 'Setting not registered' } } },
    },
    '/admin/settings/{key}/preview': {
      post: { summary: 'Validate a candidate setting value and preview its deterministic diff', responses: { '200': { description: 'Validated preview and content hash' }, '400': { description: 'Invalid schema or inline secret' } } },
    },
    '/admin/settings/{key}/changes': {
      post: { summary: 'Request a versioned system setting change using a base version', responses: { '200': { description: 'Pending setting change' }, '409': { description: 'Base version conflict' } } },
    },
    '/admin/settings/{key}/rollback-requests': {
      post: { summary: 'Request rollback to an immutable prior revision', responses: { '200': { description: 'Pending rollback change' }, '409': { description: 'Base version conflict or revision already current' } } },
    },
    '/admin/settings/changes/{id}/approve': {
      post: { summary: 'Approve a setting change using an independent reviewer and CAS', responses: { '200': { description: 'Approved setting change' }, '400': { description: 'Requester cannot self-approve' }, '409': { description: 'Invalid or concurrent transition' } } },
    },
    '/admin/settings/changes/{id}/reject': {
      post: { summary: 'Reject a setting change using an independent reviewer and CAS', responses: { '200': { description: 'Rejected setting change' }, '409': { description: 'Invalid or concurrent transition' } } },
    },
    '/admin/settings/changes/{id}/publish': {
      post: { summary: 'Publish an approved setting change atomically with revision and audit evidence', responses: { '200': { description: 'Published setting, change, and immutable revision' }, '409': { description: 'Base or transition version conflict' } } },
    },
    '/admin/config-resources/{kind}': {
      get: {
        summary: 'List one independently authorized configuration resource domain',
        parameters: [
          { name: 'kind', in: 'path', required: true, schema: { type: 'string', enum: ['feature_flag', 'reference_data', 'announcement'] } },
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 96 } },
          { name: 'deleted', in: 'query', schema: { type: 'string', enum: ['active', 'deleted', 'all'], default: 'active' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['key', 'title', 'updatedAt', 'publishedVersion'], default: 'updatedAt' } },
          { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: { '200': { description: 'Cursor-paginated draft and published projections' }, '403': { description: 'Requires the kind-specific read permission' } },
      },
      post: {
        summary: 'Create a validated configuration resource draft',
        description: 'The value schema is selected by kind. Feature flags support bounded user, role, and environment rules plus deterministic percentage rollout.',
        responses: { '200': { description: 'Created draft' }, '400': { description: 'Invalid kind-specific schema' }, '409': { description: 'Kind and key already exist' } },
      },
    },
    '/admin/model-control/summary': {
      get: { summary: 'Read normalized model catalog counts and the real-Provider approval state', responses: { '200': { description: 'Catalog summary with Provider traffic disabled' }, '403': { description: 'Requires model control read permission' } } },
    },
    '/admin/model-control/routing-summary': {
      get: { summary: 'Read route-policy, revision, and primary/backup target counts', responses: { '200': { description: 'Credential-free routing summary' }, '403': { description: 'Requires model control read permission' } } },
    },
    '/admin/model-control/routing-export': {
      get: { summary: 'Export bounded route policies and immutable revisions without subject identifiers', responses: { '200': { description: 'Portable routing policy document' }, '403': { description: 'Requires model control read permission' } } },
    },
    '/admin/model-control/routing-policies': {
      get: { summary: 'List route policies with lifecycle, modality, environment, sorting, and cursor filters', responses: { '200': { description: 'Route policy page' }, '403': { description: 'Requires model control read permission' } } },
      post: { summary: 'Create a fail-closed route policy draft', responses: { '201': { description: 'Route policy draft created' }, '409': { description: 'Policy key already exists' } } },
    },
    '/admin/model-control/routing-policies/{id}': {
      get: { summary: 'Read one route policy and its ordered deployment targets', responses: { '200': { description: 'Route policy detail' }, '404': { description: 'Policy not found' } } },
      patch: { summary: 'Edit a non-active route policy using optimistic concurrency', responses: { '200': { description: 'Route policy updated' }, '409': { description: 'Active, archived, or stale policy' } } },
    },
    '/admin/model-control/routing-policies/{id}/targets': {
      put: { summary: 'Atomically replace primary and backup targets on a non-active policy and append a revision', responses: { '200': { description: 'Route targets replaced' }, '409': { description: 'Active or stale policy' }, '422': { description: 'Deployment missing or environment mismatch' } } },
    },
    '/admin/model-control/routing-policies/{id}/status': {
      post: { summary: 'Apply an audited route-policy state transition', responses: { '200': { description: 'Route policy transitioned' }, '409': { description: 'Invalid transition, missing primary, or version conflict' } } },
    },
    '/admin/model-control/routing-policies/{id}/revisions': {
      get: { summary: 'List immutable route-policy snapshots', responses: { '200': { description: 'Bounded revision history' }, '404': { description: 'Policy not found' } } },
    },
    '/admin/model-control/routing-policies/{id}/rollback': {
      post: { summary: 'Restore a prior snapshot while keeping traffic disabled until explicit reactivation', responses: { '200': { description: 'Policy restored in its non-active state' }, '404': { description: 'Policy or revision not found' }, '409': { description: 'Active, archived, or stale policy' } } },
    },
    '/admin/model-control/route-preview': {
      post: { summary: 'Preview deterministic audience routing and append a safe decision fact without dispatch', responses: { '200': { description: 'Explainable selected or unavailable route projection with decision ID' }, '403': { description: 'Requires model control read permission' } } },
    },
    '/admin/model-control/route-decisions': {
      get: { summary: 'List immutable route decisions with source, result, modality, environment, policy, sorting, and cursor filters', responses: { '200': { description: 'Safe route decision page without raw subject identifiers' }, '403': { description: 'Requires model control read permission' } } },
    },
    '/admin/model-control/route-decisions/{id}': {
      get: { summary: 'Read one immutable explainable route decision', responses: { '200': { description: 'Route decision detail' }, '404': { description: 'Decision not found' } } },
    },
    '/admin/model-control/secret-refs': {
      get: { summary: 'List immutable external SecretRef metadata with Provider, environment, purpose, sorting, and cursor filters', responses: { '200': { description: 'SecretRef metadata page without secret material' } } },
      post: { summary: 'Append a secret:// metadata reference or linked rotation', responses: { '201': { description: 'SecretRef metadata appended' }, '400': { description: 'Plaintext, ordinary URL, or invalid metadata rejected' }, '422': { description: 'Provider or rotation source mismatch' } } },
    },
    '/admin/model-control/secret-refs/{id}': {
      get: { summary: 'Read one immutable SecretRef metadata record', responses: { '200': { description: 'SecretRef metadata detail' }, '404': { description: 'SecretRef not found' } } },
    },
    '/admin/model-control/provider-legal-reviews': {
      get: { summary: 'List immutable Provider legal reviews by Provider, model version, environment, decision, and cursor', responses: { '200': { description: 'Provider legal review page' }, '403': { description: 'Requires Provider legal read permission' } } },
      post: { summary: 'Append independently reviewed Provider legal and data-processing evidence', responses: { '201': { description: 'Immutable Provider legal review recorded' }, '403': { description: 'Requires Provider legal management permission' }, '409': { description: 'Version or source evidence conflict' } } },
    },
    '/admin/model-control/provider-legal-reviews/{id}': {
      get: { summary: 'Read one immutable Provider legal review and its safe catalog references', responses: { '200': { description: 'Provider legal review detail' }, '404': { description: 'Review not found' } } },
    },
    '/admin/model-control/provider-legal-summary': {
      get: { summary: 'Summarize current approved and blocked Provider legal scopes', responses: { '200': { description: 'Provider legal readiness summary' } } },
    },
    '/admin/model-control/provider-legal-export': {
      get: { summary: 'Export bounded immutable Provider legal evidence without contract bodies or URLs', responses: { '200': { description: 'Portable Provider legal evidence document' } } },
    },
    '/admin/model-control/evaluation-suites': {
      get: { summary: 'List immutable versioned AI evaluation suites with modality, operation, search, and cursor filters', responses: { '200': { description: 'Evaluation suite page without raw prompts or expected outputs' }, '403': { description: 'Requires model evaluation read permission' } } },
      post: { summary: 'Append a versioned evaluation suite and hashed case references atomically', responses: { '201': { description: 'Immutable suite and cases appended' }, '400': { description: 'Raw or invalid evidence rejected' }, '409': { description: 'Suite version conflict' } } },
    },
    '/admin/model-control/evaluation-suites/{id}': {
      get: { summary: 'Read one immutable evaluation suite and its hashed case inventory', responses: { '200': { description: 'Evaluation suite detail' }, '404': { description: 'Suite not found' } } },
    },
    '/admin/model-control/evaluation-policies': {
      get: { summary: 'List independently reviewed immutable quality and safety threshold policies', responses: { '200': { description: 'Evaluation policy page' }, '403': { description: 'Requires model evaluation read permission' } } },
      post: { summary: 'Append a reviewed threshold policy version', responses: { '201': { description: 'Immutable threshold policy appended' }, '400': { description: 'Invalid or self-reviewed policy' }, '409': { description: 'Policy version conflict' } } },
    },
    '/admin/model-control/evaluation-policies/{id}': {
      get: { summary: 'Read one immutable evaluation threshold policy', responses: { '200': { description: 'Evaluation policy detail' }, '404': { description: 'Policy not found' } } },
    },
    '/admin/model-control/evaluation-runs': {
      get: { summary: 'List immutable evaluation runs with suite, policy, model, deployment, status, and cursor filters', responses: { '200': { description: 'Evaluation run page' }, '403': { description: 'Requires model evaluation read permission' } } },
      post: { summary: 'Record a deterministic scored evaluation run and regression report', responses: { '201': { description: 'Immutable run and case results recorded' }, '400': { description: 'Unsafe, incomplete, or invalid result shape' }, '409': { description: 'Source-key or evidence conflict' }, '422': { description: 'Suite, policy, baseline, model, or deployment mismatch' } } },
    },
    '/admin/model-control/evaluation-runs/{id}': {
      get: { summary: 'Read one immutable evaluation run, case results, threshold policy, and baseline comparison', responses: { '200': { description: 'Verifiable regression report detail' }, '404': { description: 'Run not found' } } },
    },
    '/admin/model-control/evaluation-summary': {
      get: { summary: 'Read evaluation suite, policy, run, status, and current passing evidence counts', responses: { '200': { description: 'AI evaluation operational summary' } } },
    },
    '/admin/model-control/evaluation-export': {
      get: { summary: 'Export bounded immutable suites, policies, runs, and hashed case results', responses: { '200': { description: 'Versioned AI evaluation evidence document' } } },
    },
    '/admin/model-control/promotions': {
      get: { summary: 'List model promotions and linked release approval state', responses: { '200': { description: 'Promotion page' } } },
      post: { summary: 'Request staging-to-production model promotion using current evaluation and Provider legal evidence plus release approval control', responses: { '201': { description: 'Promotion pending independent approval' }, '409': { description: 'Route, SecretRef, evaluation, legal review, or deployment is not eligible' }, '422': { description: 'Promotion references or scopes mismatch' } } },
    },
    '/admin/model-control/promotions/{id}': {
      get: { summary: 'Read one promotion with immutable associations and linked release evidence', responses: { '200': { description: 'Promotion detail' }, '404': { description: 'Promotion not found' } } },
    },
    '/admin/model-control/governance-export': {
      get: { summary: 'Export bounded immutable route decision, SecretRef, and promotion evidence', responses: { '200': { description: 'Versioned governance JSON document without raw subjects or secret material' } } },
    },
    '/admin/model-control/governance-summary': {
      get: { summary: 'Read route decision, SecretRef expiry, and promotion status counts', responses: { '200': { description: 'Model governance operational summary' } } },
    },
    '/admin/model-control/provider-operations': {
      get: { summary: 'List Provider operational policies with explainable readiness, filters, sorting, and cursor pagination', responses: { '200': { description: 'Provider operations policy page' }, '403': { description: 'Requires model control read permission' } } },
      post: { summary: 'Create a disabled-by-default Provider operational policy referencing an external SecretRef purpose', responses: { '201': { description: 'Provider operations draft created' }, '409': { description: 'Operational scope already exists' }, '422': { description: 'Provider not found' } } },
    },
    '/admin/model-control/provider-operations/{id}': {
      get: { summary: 'Read a Provider operational policy with secret, budget, health, circuit, Kill Switch, and rate-limit gates', responses: { '200': { description: 'Provider operations readiness snapshot' }, '404': { description: 'Policy not found' } } },
      patch: { summary: 'Update a disabled Provider operational policy using optimistic concurrency', responses: { '200': { description: 'Policy updated' }, '409': { description: 'Active policy or version conflict' } } },
    },
    '/admin/model-control/provider-operations/{id}/status': {
      post: { summary: 'Activate only when every external readiness gate passes, or immediately disable', responses: { '200': { description: 'Policy transitioned' }, '409': { description: 'Readiness gate or version conflict' } } },
    },
    '/admin/model-control/provider-operations/{id}/health': {
      get: { summary: 'List append-only Provider health evidence by status with cursor pagination', responses: { '200': { description: 'Safe health evidence page' } } },
      post: { summary: 'Append hashed Provider health evidence without raw requests, responses, URLs, prompts, or credentials', responses: { '201': { description: 'Health evidence appended' }, '400': { description: 'Unsafe or invalid evidence rejected' } } },
    },
    '/admin/model-control/provider-operations-summary': {
      get: { summary: 'Read Provider readiness, health, and active dispatch lease counts', responses: { '200': { description: 'Provider operations summary' } } },
    },
    '/admin/model-control/provider-operations-export': {
      get: { summary: 'Export bounded Provider operational policies, append-only health evidence, safe leases, and readiness results', responses: { '200': { description: 'Versioned Provider operations evidence' } } },
    },
    '/admin/model-control/export': {
      get: { summary: 'Export the bounded normalized model catalog without credentials or endpoints', responses: { '200': { description: 'Portable model catalog document' }, '403': { description: 'Requires model control read permission' } } },
    },
    '/admin/model-control/providers': {
      get: { summary: 'List Provider registry entries with filtering, sorting, and cursor pagination', responses: { '200': { description: 'Provider registry page' }, '403': { description: 'Requires model control read permission' } } },
      post: { summary: 'Create a disabled-by-default Provider registry draft', responses: { '201': { description: 'Provider draft created' }, '409': { description: 'Provider key already exists' } } },
    },
    '/admin/model-control/providers/{id}': {
      get: { summary: 'Read one Provider registry entry', responses: { '200': { description: 'Provider detail' }, '404': { description: 'Provider not found' } } },
      patch: { summary: 'Update Provider draft metadata using optimistic concurrency', responses: { '200': { description: 'Provider updated' }, '409': { description: 'Version conflict or immutable archive' } } },
    },
    '/admin/model-control/providers/{id}/status': {
      post: { summary: 'Apply an audited Provider lifecycle transition', responses: { '200': { description: 'Provider transitioned' }, '409': { description: 'Invalid transition or version conflict' } } },
    },
    '/admin/model-control/models': {
      get: { summary: 'List normalized models by Provider and lifecycle status', responses: { '200': { description: 'Model registry page' } } },
      post: { summary: 'Create a model draft under a registered Provider', responses: { '201': { description: 'Model draft created' }, '422': { description: 'Provider not found' } } },
    },
    '/admin/model-control/models/{id}': {
      get: { summary: 'Read one normalized model', responses: { '200': { description: 'Model detail' }, '404': { description: 'Model not found' } } },
    },
    '/admin/model-control/models/{id}/status': {
      post: { summary: 'Apply an audited model lifecycle transition', responses: { '200': { description: 'Model transitioned' }, '409': { description: 'Invalid transition or version conflict' } } },
    },
    '/admin/model-control/versions': {
      get: { summary: 'List normalized model versions with immutable capability, deployment, and price projections', responses: { '200': { description: 'Model version page' }, '403': { description: 'Requires model control read permission' } } },
      post: { summary: 'Create an immutable-on-activation model version draft', responses: { '201': { description: 'Model version draft created' }, '422': { description: 'Model not found' } } },
    },
    '/admin/model-control/versions/{id}': {
      get: { summary: 'Read a model version with capabilities, deployments, and pricing history', responses: { '200': { description: 'Model version detail' }, '404': { description: 'Model version not found' } } },
    },
    '/admin/model-control/versions/{id}/status': {
      post: { summary: 'Apply an audited model-version lifecycle transition', responses: { '200': { description: 'Model version transitioned' }, '409': { description: 'Invalid transition or version conflict' } } },
    },
    '/admin/model-control/versions/{id}/capabilities': {
      put: { summary: 'Upsert one modality capability while the version is draft', responses: { '200': { description: 'Capability projection updated' }, '409': { description: 'Activated versions are immutable' } } },
    },
    '/admin/model-control/deployments': {
      get: { summary: 'List deployments by lifecycle, version, and environment with cursor pagination', responses: { '200': { description: 'Deployment page' }, '403': { description: 'Requires model control read permission' } } },
      post: { summary: 'Create a traffic-ineligible environment deployment record', responses: { '201': { description: 'Deployment draft created' }, '422': { description: 'Model version not found' } } },
    },
    '/admin/model-control/deployments/{id}': {
      get: { summary: 'Read one model deployment record', responses: { '200': { description: 'Deployment detail' }, '404': { description: 'Deployment not found' } } },
    },
    '/admin/model-control/deployments/{id}/status': {
      post: { summary: 'Apply a deployment lifecycle transition; traffic-eligible activation requires PROVIDER-APPROVAL', responses: { '200': { description: 'Deployment transitioned' }, '409': { description: 'Approval required, invalid transition, or version conflict' } } },
    },
    '/admin/model-control/pricing': {
      post: { summary: 'Create an additive pricing version without overwriting historical prices', responses: { '201': { description: 'Pricing version draft created' }, '422': { description: 'Version or deployment not found' } } },
    },
    '/admin/model-control/pricing/{id}': {
      get: { summary: 'Read one immutable pricing version', responses: { '200': { description: 'Pricing version detail' }, '404': { description: 'Pricing version not found' } } },
    },
    '/admin/model-control/pricing/{id}/status': {
      post: { summary: 'Apply an audited pricing lifecycle transition', responses: { '200': { description: 'Pricing version transitioned' }, '409': { description: 'Invalid transition or version conflict' } } },
    },
    '/admin/config-resources/{kind}/bulk-delete': {
      post: { summary: 'Atomically soft-delete up to 100 resources using expected versions', responses: { '200': { description: 'Soft-deleted resources' }, '409': { description: 'At least one resource was stale or unavailable' } } },
    },
    '/admin/config-resources/{kind}/export': {
      get: { summary: 'Export up to 1000 active reference data drafts as versioned JSON', responses: { '200': { description: 'Portable reference data document' }, '404': { description: 'Export is not supported for this kind' } } },
    },
    '/admin/config-resources/{kind}/import': {
      post: { summary: 'Atomically import up to 100 validated reference data drafts', responses: { '200': { description: 'Created and updated drafts' }, '400': { description: 'Invalid document or kind-specific value' }, '409': { description: 'Existing, deleted, or stale resource' } } },
    },
    '/admin/config-resources/{kind}/{id}': {
      get: { summary: 'Read one configuration resource draft and published projection', responses: { '200': { description: 'Configuration resource' }, '404': { description: 'Resource not found in this kind' } } },
      patch: { summary: 'Update a configuration resource draft using optimistic concurrency', responses: { '200': { description: 'Updated draft' }, '400': { description: 'Invalid kind-specific schema' }, '409': { description: 'Expected version conflict or resource is deleted' } } },
      delete: { summary: 'Soft-delete a configuration resource using optimistic concurrency', responses: { '200': { description: 'Soft-deleted resource' }, '409': { description: 'Expected version conflict' } } },
    },
    '/admin/config-resources/{kind}/{id}/history': {
      get: { summary: 'List immutable published revisions', responses: { '200': { description: 'Cursor-paginated revisions' }, '404': { description: 'Resource not found in this kind' } } },
    },
    '/admin/config-resources/{kind}/{id}/publish': {
      post: { summary: 'Atomically publish the draft with immutable revision and audit evidence', responses: { '200': { description: 'Published resource and revision' }, '409': { description: 'Expected version conflict or deleted resource' } } },
    },
    '/admin/config-resources/{kind}/{id}/rollback': {
      post: { summary: 'Publish a new version from an immutable prior revision', responses: { '200': { description: 'Rolled-back resource and new revision' }, '404': { description: 'Revision does not belong to this resource' }, '409': { description: 'Expected version conflict' } } },
    },
    '/admin/config-resources/{kind}/{id}/restore': {
      post: { summary: 'Restore a soft-deleted configuration resource using optimistic concurrency', responses: { '200': { description: 'Restored resource' }, '409': { description: 'Expected version conflict or resource is active' } } },
    },
    '/feature-flags/{key}/evaluate': {
      get: { summary: 'Evaluate one published feature flag for the authenticated user and server environment', responses: { '200': { description: 'Deterministic evaluation without raw targeting context' }, '401': { description: 'Authentication required' }, '404': { description: 'Published flag not found' } } },
    },
    '/admin/config-resources/feature_flag/{id}/preview': {
      post: { summary: 'Preview a feature flag draft against an explicit administrative context', responses: { '200': { description: 'Matched rule summary and effective value' }, '400': { description: 'Invalid preview context' }, '403': { description: 'Requires feature flag read permission' } } },
    },
    '/admin/config-resources/feature_flag/{id}/emergency-off': {
      post: { summary: 'Immediately disable a published feature flag using optimistic concurrency', responses: { '200': { description: 'Emergency override and updated resource version' }, '403': { description: 'Requires feature flag emergency permission' }, '409': { description: 'Expected version conflict or unpublished flag' } } },
    },
    '/admin/config-resources/feature_flag/{id}/emergency-restore': {
      post: { summary: 'Remove a feature flag emergency override using optimistic concurrency', responses: { '200': { description: 'Restored rule evaluation and updated resource version' }, '403': { description: 'Requires feature flag emergency permission' }, '409': { description: 'Expected version conflict or unpublished flag' } } },
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
          '200': { description: 'Recipient-scoped notification inbox with versioned allowlisted metadata.target deep links; destination APIs reauthorize every target' },
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
    '/admin/domain-events': {
      get: {
        summary: 'List versioned domain event Outbox records and publication state',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'claimed', 'published', 'failed'] } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'aggregateType', in: 'query', schema: { type: 'string' } },
          { name: 'aggregateId', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: { '200': { description: 'Sanitized domain event publication page' }, '403': { description: 'Requires admin:events:read' } },
      },
    },
    '/admin/domain-events/{id}': {
      get: {
        summary: 'Read one immutable domain event and its publication state',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Domain event detail' }, '404': { description: 'Event not found' } },
      },
    },
    '/admin/domain-events/{id}/replay': {
      post: {
        summary: 'Request replay of a published or failed domain event without changing event content',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reasonCode: { type: 'string' } } } } } },
        responses: { '200': { description: 'Event returned to pending publication' }, '403': { description: 'Requires admin:events:replay' }, '404': { description: 'Event cannot be replayed' } },
      },
    },
    '/admin/domain-event-consumers': {
      get: {
        summary: 'List registered domain event consumers and bounded retry policy',
        responses: { '200': { description: 'Registered consumer definitions' }, '403': { description: 'Requires admin:events:read' } },
      },
    },
    '/admin/domain-event-inbox': {
      get: {
        summary: 'List immutable Inbox receipts with processing and compensation state',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'processing', 'retry_scheduled', 'succeeded', 'dead_lettered', 'compensation_pending', 'compensated', 'compensation_failed'] } },
          { name: 'consumerKey', in: 'query', schema: { type: 'string' } },
          { name: 'eventType', in: 'query', schema: { type: 'string' } },
          { name: 'aggregateType', in: 'query', schema: { type: 'string' } },
          { name: 'aggregateId', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: { '200': { description: 'Consumer Inbox page' }, '403': { description: 'Requires admin:events:read' } },
      },
    },
    '/admin/domain-event-inbox/{id}': {
      get: {
        summary: 'Read one Inbox receipt, attempts, DLQ and compensation evidence',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Consumer Inbox detail' }, '404': { description: 'Inbox receipt not found' } },
      },
    },
    '/admin/domain-event-inbox/{id}/retry': {
      post: {
        summary: 'Grant one audited recovery attempt to a dead-lettered consumption',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reasonCode: { type: 'string' } } } } } },
        responses: { '200': { description: 'Consumption scheduled for recovery' }, '403': { description: 'Requires admin:events:recover' }, '404': { description: 'Consumption is not recoverable' } },
      },
    },
    '/admin/domain-event-inbox/{id}/compensate': {
      post: {
        summary: 'Request an audited registered compensation for a succeeded consumption',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reasonCode: { type: 'string' } } } } } },
        responses: { '200': { description: 'Compensation queued' }, '403': { description: 'Requires admin:events:recover' }, '404': { description: 'Compensation is not allowed' } },
      },
    },
    '/admin/jobs/definitions': {
      get: {
        summary: 'List registered job definitions',
        parameters: [{ name: 'type', in: 'query', schema: { type: 'string' } }, { name: 'enabled', in: 'query', schema: { type: 'boolean' } }],
        responses: { '200': { description: 'Registered job definitions' }, '403': { description: 'Requires admin:jobs:read' } },
      },
    },
    '/admin/jobs/runs': {
      get: {
        summary: 'List job runs with attempts and safe results',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled'] } },
          { name: 'definitionId', in: 'query', schema: { type: 'string' } },
          { name: 'ownerId', in: 'query', schema: { type: 'string' } },
          { name: 'correlationId', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: { '200': { description: 'Job run page' }, '403': { description: 'Requires admin:jobs:read' } },
      },
    },
    '/admin/jobs/runs/{id}': {
      get: {
        summary: 'Read one job run and all attempts',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Job run detail' }, '404': { description: 'Run not found' } },
      },
    },
    '/admin/jobs/runs/{id}/cancel': {
      post: {
        summary: 'Request cancellation of a queued or running job',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reasonCode: { type: 'string' } } } } } },
        responses: { '200': { description: 'Updated job run' }, '403': { description: 'Requires admin:jobs:manage' }, '404': { description: 'Run not found' } },
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
