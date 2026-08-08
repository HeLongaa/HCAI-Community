import { isIP } from 'node:net'

const fullGitSha = /^[a-f0-9]{40}$/
const safeUser = /^[a-z_][a-z0-9_-]{0,31}$/i
const safeDnsName = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i

const required = (source, name) => {
  const value = String(source[name] ?? '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export const parseSshInfrastructureConfiguration = ({ source = process.env, mode }) => {
  if (!['preflight', 'execute'].includes(mode)) throw new Error('Infrastructure rehearsal mode must be preflight or execute')
  if (required(source, 'RELEASE_REHEARSAL_CONFIRMATION') !== 'release-01-isolated-rehearsal') {
    throw new Error('RELEASE_REHEARSAL_CONFIRMATION is invalid')
  }

  const sourceSha = required(source, 'RELEASE_REHEARSAL_SOURCE_SHA').toLowerCase()
  if (!fullGitSha.test(sourceSha)) throw new Error('RELEASE_REHEARSAL_SOURCE_SHA must be a full Git SHA')

  const host = required(source, 'RELEASE_REHEARSAL_SSH_HOST').toLowerCase()
  if (isIP(host) === 0 && !safeDnsName.test(host)) throw new Error('RELEASE_REHEARSAL_SSH_HOST is invalid')
  const port = Number(required(source, 'RELEASE_REHEARSAL_SSH_PORT'))
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('RELEASE_REHEARSAL_SSH_PORT is invalid')
  const user = required(source, 'RELEASE_REHEARSAL_SSH_USER')
  if (!safeUser.test(user)) throw new Error('RELEASE_REHEARSAL_SSH_USER is invalid')

  const privateKey = required(source, 'RELEASE_REHEARSAL_SSH_PRIVATE_KEY')
  if (!privateKey.includes('PRIVATE KEY')) throw new Error('RELEASE_REHEARSAL_SSH_PRIVATE_KEY is invalid')
  const knownHosts = required(source, 'RELEASE_REHEARSAL_SSH_KNOWN_HOSTS')
  if (!knownHosts.split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith('#'))) {
    throw new Error('RELEASE_REHEARSAL_SSH_KNOWN_HOSTS is invalid')
  }

  const remoteCommand = required(source, 'RELEASE_REHEARSAL_SSH_INFRASTRUCTURE_COMMAND')
  if (!/^\/[a-zA-Z0-9_./-]+$/.test(remoteCommand) || remoteCommand.includes('..')) {
    throw new Error('RELEASE_REHEARSAL_SSH_INFRASTRUCTURE_COMMAND must be an absolute safe path')
  }

  return { mode, sourceSha, host, port, user, privateKey, knownHosts, remoteCommand }
}

export const buildSshInfrastructureArguments = ({ configuration, privateKeyPath, knownHostsPath }) => [
  '-F', '/dev/null',
  '-i', privateKeyPath,
  '-o', 'IdentitiesOnly=yes',
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=yes',
  '-o', `UserKnownHostsFile=${knownHostsPath}`,
  '-o', 'ConnectTimeout=15',
  '-p', String(configuration.port),
  `${configuration.user}@${configuration.host}`,
  configuration.remoteCommand,
  configuration.mode,
  configuration.sourceSha,
]
