import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL
const storageEndpoint = process.env.MEDIA_STORAGE_INTEGRATION_ENDPOINT

test('Prisma media storage completes a real S3 and scanner lifecycle', {
  skip: !databaseUrl || !storageEndpoint,
}, async () => {
  const objectBody = Buffer.from('MEDIA-03 PostgreSQL MinIO scanner integration')
  const checksumSha256 = createHash('sha256').update(objectBody).digest('hex')
  let scannerRequest = null
  let scannerReadBody = null
  const scannerServer = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      void (async () => {
        scannerRequest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const read = await fetch(scannerRequest.asset.read.url, {
          method: scannerRequest.asset.read.method,
          headers: scannerRequest.asset.read.headers,
        })
        assert.equal(read.status, 200)
        scannerReadBody = Buffer.from(await read.arrayBuffer())
        response.writeHead(202)
        response.end()
      })().catch((error) => {
        response.writeHead(500)
        response.end(error.message)
      })
    })
  })
  await new Promise((resolve) => scannerServer.listen(0, '127.0.0.1', resolve))
  const scannerPort = scannerServer.address().port

  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    DEMO_DATABASE_AUTOSEED: 'false',
    STORAGE_DRIVER: 's3',
    STORAGE_ENDPOINT: storageEndpoint,
    STORAGE_REGION: process.env.MEDIA_STORAGE_INTEGRATION_REGION ?? 'us-east-1',
    STORAGE_BUCKET: process.env.MEDIA_STORAGE_INTEGRATION_BUCKET ?? 'media',
    STORAGE_ACCESS_KEY_ID: process.env.MEDIA_STORAGE_INTEGRATION_ACCESS_KEY ?? 'minioadmin',
    STORAGE_SECRET_ACCESS_KEY: process.env.MEDIA_STORAGE_INTEGRATION_SECRET_KEY ?? 'minioadmin123',
    MEDIA_SCAN_PROVIDER: 'webhook',
    MEDIA_SCAN_REQUEST_ADAPTER: 'generic-webhook',
    MEDIA_SCAN_REQUEST_URL: `http://127.0.0.1:${scannerPort}/scan`,
    MEDIA_SCAN_CALLBACK_BASE_URL: 'http://127.0.0.1:8787',
    MEDIA_SCAN_WEBHOOK_SECRET: 'integration-scan-secret',
    MEDIA_STORAGE_CLEANUP_RETENTION_DAYS: '30',
  })

  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const runId = `media-storage-${Date.now()}-${randomUUID().slice(0, 8)}`
  const userId = `${runId}-user`
  const handle = `storage${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const actor = { id: userId, handle, role: 'creator', permissions: [] }
  let assetId = null

  try {
    await repository.client.user.create({
      data: {
        id: userId,
        displayName: 'Media Storage Integration',
        role: 'creator',
        profile: { create: { handle, lane: 'maker', skills: [], languages: ['en'] } },
      },
    })
    const contract = await repository.media.createUpload({
      fileName: 'integration-clean.pdf',
      contentType: 'application/pdf',
      sizeBytes: objectBody.length,
      purpose: 'library_asset',
      checksumSha256,
      metadata: { source: 'media_storage_integration' },
    }, actor)
    assetId = contract.asset.id
    assert.equal(contract.upload.provider, 's3')
    assert.equal(contract.upload.headers['x-amz-checksum-sha256'], Buffer.from(checksumSha256, 'hex').toString('base64'))

    const uploaded = await fetch(contract.upload.url, {
      method: contract.upload.method,
      headers: contract.upload.headers,
      body: objectBody,
    })
    assert.equal(uploaded.status, 200)

    const completed = await repository.media.completeUpload(assetId, {}, actor)
    assert.equal(completed.storage.state, 'quarantined')
    assert.equal(completed.metadata.security.scanStatus, 'scanning')
    assert.equal(scannerRequest.scanId, completed.metadata.security.externalScanId)
    assert.deepEqual(scannerReadBody, objectBody)
    assert.equal(JSON.stringify(scannerRequest).includes('storageKey'), false)

    const clean = await repository.media.recordScanCallback(assetId, {
      status: 'clean',
      note: 'MinIO fixture passed',
      detectedContentType: 'application/pdf',
      externalScanId: scannerRequest.scanId,
    })
    assert.equal(clean.storage.state, 'available')
    assert.equal(clean.metadata.security.scanStatus, 'clean')

    const download = await repository.media.createDownload(assetId, actor)
    assert.equal(download.download.provider, 's3')
    const downloaded = await fetch(download.download.url, { headers: download.download.headers })
    assert.equal(downloaded.status, 200)
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), objectBody)

    const deleted = await repository.media.setAssetDeleted(assetId, true, actor, { reason: 'integration_cleanup' })
    assert.equal(deleted.storage.state, 'cleanup_pending')
    assert.equal(await repository.media.createDownload(assetId, actor), null)

    const cleanup = await repository.media.cleanupStorageObjects({
      limit: 10,
      now: new Date(Date.now() + 31 * 86400_000),
    })
    assert.deepEqual(cleanup.items, [{ assetId, status: 'deleted', provider: 's3' }])
    assert.equal((await fetch(download.download.url, { headers: download.download.headers })).status, 404)

    const recovered = await repository.media.setAssetDeleted(assetId, false, actor)
    assert.equal(recovered.storage.state, 'deleted')
    assert.equal(await repository.media.createDownload(assetId, actor), null)
  } finally {
    if (assetId) await repository.client.mediaScanJob.deleteMany({ where: { assetId } })
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: userId }, ...(assetId ? [{ resourceId: assetId }] : [])] } })
    })
    if (assetId) {
      await repository.client.mediaStorageObject.deleteMany({ where: { assetId } })
      await repository.client.mediaAsset.deleteMany({ where: { id: assetId } })
    }
    await repository.client.user.deleteMany({ where: { id: userId } })
    await repository.client.$disconnect()
    await new Promise((resolve, reject) => scannerServer.close((error) => error ? reject(error) : resolve()))
  }
})
