import fs from 'node:fs'
import path from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/production-static-delivery-contract.json'), 'utf8'))
const dist = path.join(root, contract.rootDirectory)

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  throw new Error('Production build is missing. Run npm run build before preparing static delivery.')
}

const files = []
const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) visit(target)
    else if (!target.endsWith('.br') && !target.endsWith('.gz')) files.push(target)
  }
}
visit(dist)

let generated = 0
let sourceBytes = 0
let encodedBytes = 0
for (const file of files) {
  const source = fs.readFileSync(file)
  if (source.byteLength < contract.compression.minimumBytes || !contract.compression.extensions.includes(path.extname(file))) continue

  const encodings = [
    ['br', brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })],
    ['gz', gzipSync(source, { level: 9 })],
  ]
  for (const [extension, body] of encodings) {
    const savingsRatio = 1 - body.byteLength / source.byteLength
    const target = `${file}.${extension}`
    if (savingsRatio < contract.compression.minimumSavingsRatio) {
      fs.rmSync(target, { force: true })
      continue
    }
    fs.writeFileSync(target, body)
    generated += 1
    sourceBytes += source.byteLength
    encodedBytes += body.byteLength
  }
}

const savedPercent = sourceBytes === 0 ? 0 : (1 - encodedBytes / sourceBytes) * 100
console.log(`Production static encodings prepared: ${generated} sidecars, ${savedPercent.toFixed(1)}% aggregate savings`)
