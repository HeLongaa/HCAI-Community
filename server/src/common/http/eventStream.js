export const openEventStream = (response) => {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  response.flushHeaders?.()
}

export const writeEvent = (response, event, data) => {
  if (response.destroyed || response.writableEnded) return false
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  return true
}

export const closeEventStream = (response) => {
  if (!response.destroyed && !response.writableEnded) response.end()
}
