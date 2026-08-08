import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  buildSshDeploymentArguments,
  parseSshDeploymentConfiguration,
} from './lib/release-application-ssh.mjs'

const configuration = parseSshDeploymentConfiguration()
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'newchat-release-ssh-'))
const privateKeyPath = path.join(temporaryDirectory, 'identity')
const knownHostsPath = path.join(temporaryDirectory, 'known_hosts')

try {
  fs.writeFileSync(privateKeyPath, `${configuration.privateKey.trim()}\n`, { mode: 0o600 })
  fs.writeFileSync(knownHostsPath, `${configuration.knownHosts.trim()}\n`, { mode: 0o600 })
  const args = buildSshDeploymentArguments({ configuration, privateKeyPath, knownHostsPath })
  execFileSync('ssh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15 * 60 * 1000,
    maxBuffer: 1024 * 1024,
  })
  console.log(`Protected staging deployment completed for artifact ${configuration.targetArtifactSha256}`)
} catch (error) {
  const code = Number.isInteger(error?.status) ? `exit_${error.status}` : error?.code === 'ETIMEDOUT' ? 'timeout' : 'execution_failed'
  throw new Error(`Protected staging deployment failed: ${code}`)
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}
