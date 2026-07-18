export const json = (response, statusCode, payload) => {
  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

export const html = (response, statusCode, body) => {
  response.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

export const text = (response, statusCode, body, contentType = 'text/plain; charset=utf-8') => {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

export const ok = (response, data, meta) => {
  json(response, 200, meta ? { data, meta } : { data })
}

export const created = (response, data) => {
  json(response, 201, { data })
}

export const fail = (response, statusCode, code, message, details, meta) => {
  json(response, statusCode, {
    data: null,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
    ...(meta === undefined ? {} : { meta }),
  })
}
