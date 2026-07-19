import { registerAuthRoutes } from './auth/routes.js'
import { registerOAuthAdminRoutes } from './oauthAdmin/routes.js'
import { registerAuthSessionAdminRoutes } from './authSessionAdmin/routes.js'
import { registerDocsRoutes } from './docs/routes.js'
import { registerHealthRoutes } from './health/routes.js'
import { registerMetricsRoutes } from './metrics/routes.js'
import { registerTaskRoutes } from './tasks/routes.js'
import { registerUserRoutes } from './users/routes.js'
import { registerUserAdminRoutes } from './userAdmin/routes.js'
import { registerProfileRoutes } from './profiles/routes.js'
import { registerPostRoutes } from './posts/routes.js'
import { registerLibraryRoutes } from './library/routes.js'
import { registerAdminRoutes } from './admin/routes.js'
import { registerPointsRoutes } from './points/routes.js'
import { registerMediaRoutes } from './media/routes.js'
import { registerNotificationRoutes } from './notifications/routes.js'
import { registerCreativeRoutes } from './creative/routes.js'
import { registerComplianceRoutes } from './compliance/routes.js'
import { registerChatRoutes } from './chat/routes.js'
import { registerOperationRoutes } from './operations/routes.js'
import { registerObservabilityRoutes } from './observability/routes.js'
import { registerSettingsRoutes } from './settings/routes.js'
import { registerConfigResourceRoutes } from './configResources/routes.js'
import { registerModelControlRoutes } from './modelControl/routes.js'
import { registerEntitlementRoutes } from './entitlements/routes.js'
import { registerTrustRoutes } from './trust/routes.js'
import { registerCommunityAdminRoutes } from './communityAdmin/routes.js'
import { registerDeveloperAccessRoutes } from './developerAccess/routes.js'
import { registerDeveloperApiRoutes } from './developerApi/routes.js'
import { registerWebhookRoutes } from './webhooks/routes.js'

export const registerModules = (router) => {
  registerHealthRoutes(router)
  registerMetricsRoutes(router)
  registerDocsRoutes(router)
  registerComplianceRoutes(router)
  registerTrustRoutes(router)
  registerCommunityAdminRoutes(router)
  registerDeveloperAccessRoutes(router)
  registerDeveloperApiRoutes(router)
  registerWebhookRoutes(router)
  registerAuthRoutes(router)
  registerOAuthAdminRoutes(router)
  registerAuthSessionAdminRoutes(router)
  registerUserRoutes(router)
  registerUserAdminRoutes(router)
  registerTaskRoutes(router)
  registerPostRoutes(router)
  registerLibraryRoutes(router)
  registerMediaRoutes(router)
  registerCreativeRoutes(router)
  registerChatRoutes(router)
  registerNotificationRoutes(router)
  registerAdminRoutes(router)
  registerObservabilityRoutes(router)
  registerSettingsRoutes(router)
  registerConfigResourceRoutes(router)
  registerModelControlRoutes(router)
  registerOperationRoutes(router)
  registerProfileRoutes(router)
  registerPointsRoutes(router)
  registerEntitlementRoutes(router)
}
