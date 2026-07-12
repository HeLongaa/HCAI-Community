import { registerAuthRoutes } from './auth/routes.js'
import { registerDocsRoutes } from './docs/routes.js'
import { registerHealthRoutes } from './health/routes.js'
import { registerMetricsRoutes } from './metrics/routes.js'
import { registerTaskRoutes } from './tasks/routes.js'
import { registerUserRoutes } from './users/routes.js'
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

export const registerModules = (router) => {
  registerHealthRoutes(router)
  registerMetricsRoutes(router)
  registerDocsRoutes(router)
  registerComplianceRoutes(router)
  registerAuthRoutes(router)
  registerUserRoutes(router)
  registerTaskRoutes(router)
  registerPostRoutes(router)
  registerLibraryRoutes(router)
  registerMediaRoutes(router)
  registerCreativeRoutes(router)
  registerChatRoutes(router)
  registerNotificationRoutes(router)
  registerAdminRoutes(router)
  registerProfileRoutes(router)
  registerPointsRoutes(router)
}
