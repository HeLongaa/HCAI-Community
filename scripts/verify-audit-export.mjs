#!/usr/bin/env node
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { verifyPortableAuditExport } from '../server/src/audit/auditIntegrity.js'

export { verifyPortableAuditExport }

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: node scripts/verify-audit-export.mjs <audit-export.json>')
    process.exitCode = 2
  } else {
    const result = verifyPortableAuditExport(JSON.parse(fs.readFileSync(file, 'utf8')))
    console.log(JSON.stringify(result, null, 2))
    if (!result.verified) process.exitCode = 1
  }
}
