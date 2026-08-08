import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  buildSshInfrastructureArguments,
  parseSshInfrastructureConfiguration,
} from './lib/release-infrastructure-ssh.mjs'
import {
  verifyEvidence,
  verifySourcePreflight,
} from './lib/release-infrastructure-rehearsal.mjs'

const mode = process.argv.find((value) => value.startsWith('--mode='))?.slice('--mode='.length)
const configuration = parseSshInfrastructureConfiguration({ mode })
const root = process.cwd()
const artifactDirectory = path.join(root, '.artifacts/release-infrastructure')
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'newchat-infrastructure-ssh-'))
const privateKeyPath = path.join(temporaryDirectory, 'identity')
const knownHostsPath = path.join(temporaryDirectory, 'known_hosts')

try {
  fs.writeFileSync(privateKeyPath, `${configuration.privateKey.trim()}\n`, { mode: 0o600 })
  fs.writeFileSync(knownHostsPath, `${configuration.knownHosts.trim()}\n`, { mode: 0o600 })
  const args = buildSshInfrastructureArguments({ configuration, privateKeyPath, knownHostsPath })
  const stdout = execFileSync('ssh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30 * 60 * 1000,
    maxBuffer: 2 * 1024 * 1024,
  })
  const document = JSON.parse(stdout)
  fs.mkdirSync(artifactDirectory, { recursive: true })

  if (mode === 'preflight') {
    const verification = verifySourcePreflight({
      preflight: document,
      source: {
        gitCommit: document.gitCommit,
        clean: document.clean,
        snapshotSha256: document.sourceSnapshotSha256,
      },
      maximumAgeSeconds: 7200,
    })
    if (!verification.valid || document.gitCommit !== configuration.sourceSha || document.clean !== true) {
      throw new Error('Remote infrastructure preflight evidence is invalid')
    }
    fs.writeFileSync(path.join(artifactDirectory, 'target-preflight.json'), `${JSON.stringify(document, null, 2)}\n`)
    console.log(JSON.stringify({ mode, sourceSha: configuration.sourceSha, receiptHash: document.receiptHash }, null, 2))
  } else {
    const verification = verifyEvidence(document)
    if (!verification.valid || document.source?.gitCommit !== configuration.sourceSha || document.run?.profile !== 'env') {
      throw new Error('Remote infrastructure rehearsal evidence is invalid')
    }
    fs.writeFileSync(path.join(artifactDirectory, 'latest.json'), `${JSON.stringify(document, null, 2)}\n`)
    console.log(JSON.stringify({
      mode,
      sourceSha: configuration.sourceSha,
      complete: document.result.complete,
      checks: { passed: document.result.passed, total: document.result.total },
      receiptHash: document.receiptHash,
    }, null, 2))
  }
} catch (error) {
  if (error instanceof SyntaxError) throw new Error('Protected infrastructure rehearsal returned invalid JSON')
  if (String(error?.message).startsWith('Remote infrastructure')) throw error
  const code = Number.isInteger(error?.status) ? `exit_${error.status}` : error?.code === 'ETIMEDOUT' ? 'timeout' : 'execution_failed'
  throw new Error(`Protected infrastructure rehearsal failed: ${code}`)
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}
