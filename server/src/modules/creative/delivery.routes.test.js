import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { resetCreativePolicyState } from '../../creative/policy.js'
import { registerMediaRoutes } from '../media/routes.js'
import { registerProfileRoutes } from '../profiles/routes.js'
import { registerTaskRoutes } from '../tasks/routes.js'
import { registerCreativeRoutes } from './routes.js'

test('creative output flows through task evidence, private library, and governed portfolio lifecycle', async () => {
  resetCreativePolicyState()
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'manual'
  const server = await createRouteTestServer(registerCreativeRoutes, registerMediaRoutes, registerTaskRoutes, registerProfileRoutes)
  try {
    const generated = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image', mode: 'text_to_image', prompt: 'A governed delivery portfolio fixture',
        parameters: { aspectRatio: '1:1', seed: 37 },
      },
      token: 'demo-access.promptlin',
    })
    assert.equal(generated.status, 200)
    const assetId = generated.payload.data.outputs[0].storage.mediaAssetId
    const generationId = generated.payload.data.id

    const clean = await requestJson(server.url, `/api/media/uploads/${assetId}/scan`, {
      body: { decision: 'clean', note: 'V1-37 governed output fixture' }, token: 'demo-access.opsplus',
    })
    assert.equal(clean.status, 200)

    const createdTask = await requestJson(server.url, '/api/tasks', {
      body: {
        title: `V1-37 delivery ${Date.now()}`, category: 'Design', description: 'Deliver governed creative output.',
        acceptanceRules: 'Attach the governed output and rights note.', pointsReward: 37, visibility: 'public',
      },
      token: 'demo-access.launchteam',
    })
    assert.equal(createdTask.status, 201)
    const taskId = createdTask.payload.data.id
    const claimed = await requestJson(server.url, `/api/tasks/${taskId}/claim`, { token: 'demo-access.promptlin' })
    assert.equal(claimed.status, 200)

    const targets = await requestJson(server.url, '/api/tasks/delivery-targets', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(targets.status, 200)
    assert.equal(targets.payload.data.some((task) => task.id === String(taskId)), true)

    const savedOnce = await requestJson(server.url, `/api/media/assets/${assetId}/library`, { token: 'demo-access.promptlin' })
    const savedTwice = await requestJson(server.url, `/api/media/assets/${assetId}/library`, { token: 'demo-access.promptlin' })
    assert.equal(savedOnce.status, 201)
    assert.equal(savedTwice.payload.data.id, savedOnce.payload.data.id)
    assert.equal(savedOnce.payload.data.sourceId, assetId)

    const draftOnce = await requestJson(server.url, `/api/media/assets/${assetId}/portfolio`, {
      body: { title: 'Governed fixture', caption: 'Published from a generated MediaAsset.' }, token: 'demo-access.promptlin',
    })
    const draftTwice = await requestJson(server.url, `/api/media/assets/${assetId}/portfolio`, {
      body: { title: 'Ignored duplicate title' }, token: 'demo-access.promptlin',
    })
    assert.equal(draftOnce.status, 201)
    assert.equal(draftTwice.payload.data.id, draftOnce.payload.data.id)
    assert.equal(draftOnce.payload.data.status, 'draft')

    const published = await requestJson(server.url, `/api/profiles/me/portfolio/${draftOnce.payload.data.id}`, {
      method: 'PATCH', body: { action: 'publish', sortOrder: 1 }, token: 'demo-access.promptlin',
    })
    assert.equal(published.status, 200)
    assert.equal(published.payload.data.status, 'published')

    const submitted = await requestJson(server.url, `/api/tasks/${taskId}/submissions`, {
      body: { content: 'Final governed creative delivery.', assetIds: [assetId], rightsNote: 'Licensed for task delivery and public portfolio display.' },
      token: 'demo-access.promptlin',
    })
    assert.equal(submitted.status, 201)

    const submissionsBeforeArchive = await requestJson(server.url, `/api/tasks/${taskId}/submissions`, { method: 'GET', token: 'demo-access.launchteam' })
    const evidence = submissionsBeforeArchive.payload.data[0].assetEvidence[0]
    assert.equal(evidence.assetId, assetId)
    assert.equal(evidence.sourceGeneration.id, generationId)
    assert.equal(evidence.governance.scanStatus, 'clean')
    assert.equal(evidence.governance.archived, false)
    assert.equal('storageKey' in evidence, false)

    const publicBeforeArchive = await requestJson(server.url, '/api/profiles/promptlin', { method: 'GET' })
    assert.equal(publicBeforeArchive.payload.data.portfolio.some((item) => item.assetId === assetId), true)

    const archived = await requestJson(server.url, `/api/media/assets/${assetId}/archive`, { token: 'demo-access.promptlin' })
    assert.equal(archived.status, 200)
    const publicAfterArchive = await requestJson(server.url, '/api/profiles/promptlin', { method: 'GET' })
    assert.equal(publicAfterArchive.payload.data.portfolio.some((item) => item.assetId === assetId), false)
    const ownAfterArchive = await requestJson(server.url, '/api/profiles/me/portfolio', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(ownAfterArchive.payload.data.find((item) => item.assetId === assetId).status, 'withdrawn')

    await requestJson(server.url, `/api/media/assets/${assetId}/restore`, { token: 'demo-access.promptlin' })
    const publicAfterRestore = await requestJson(server.url, '/api/profiles/promptlin', { method: 'GET' })
    assert.equal(publicAfterRestore.payload.data.portfolio.some((item) => item.assetId === assetId), false)

    const submissionsAfterArchive = await requestJson(server.url, `/api/tasks/${taskId}/submissions`, { method: 'GET', token: 'demo-access.launchteam' })
    assert.deepEqual(submissionsAfterArchive.payload.data[0].assetEvidence, submissionsBeforeArchive.payload.data[0].assetEvidence)
  } finally {
    await server.close()
    if (previousProvider == null) delete process.env.MEDIA_SCAN_PROVIDER
    else process.env.MEDIA_SCAN_PROVIDER = previousProvider
  }
})
