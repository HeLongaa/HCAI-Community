import fs from 'node:fs'
import path from 'node:path'

import { createProductionStaticServer } from './lib/production-static-server.mjs'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/production-static-delivery-contract.json'), 'utf8'))
const host = process.env.STATIC_HOST ?? '127.0.0.1'
const port = Number(process.env.STATIC_PORT ?? 4173)
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('STATIC_PORT must be a valid TCP port')

const server = createProductionStaticServer({ rootDirectory: path.join(root, contract.rootDirectory), contract })
server.listen(port, host, () => {
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  console.log(`HCAI production static server listening on http://${host}:${actualPort}`)
})

const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
