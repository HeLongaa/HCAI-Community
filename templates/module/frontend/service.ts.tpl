import { api } from './apiClient'

import type { {{pascalName}}Record } from './{{camelName}}Contracts'

export const {{camelName}}Service = {
  list: () => api.get<{{pascalName}}Record[]>('/{{routeSegment}}'),
}
