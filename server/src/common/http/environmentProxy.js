import * as http from 'node:http'

export const configureEnvironmentProxy = (source = process.env, runtime = http) => {
  if (String(source.NODE_USE_ENV_PROXY ?? '').trim() !== '1') {
    return false
  }
  if (typeof runtime.setGlobalProxyFromEnv !== 'function') {
    throw new Error('NODE_USE_ENV_PROXY requires a Node.js runtime with setGlobalProxyFromEnv support')
  }
  runtime.setGlobalProxyFromEnv(source)
  return true
}
