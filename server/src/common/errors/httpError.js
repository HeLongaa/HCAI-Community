export class HttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export const notFound = (pathname) => new HttpError(404, 'NOT_FOUND', `No route for ${pathname}`)
