export const {{camelName}}OpenApi = Object.freeze({
  '/api/{{routeSegment}}': {
    get: {
      summary: 'List {{displayName}} records',
      responses: { 200: { description: 'Bounded owner-authorized list' } },
    },
    post: {
      // TODO(DX-SCAFFOLD): replace the unavailable response with the implemented mutation contract.
      summary: 'Create a {{displayName}} record',
      responses: { 501: { description: 'Fail-closed scaffold until implemented' } },
    },
  },
})
