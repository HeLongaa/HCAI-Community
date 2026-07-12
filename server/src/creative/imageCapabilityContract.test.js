import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertImageGenerationRequest,
  imageCapabilityContract,
  imageCapabilityForProvider,
} from './imageCapabilityContract.js'

const request = {
  workspace: 'image',
  mode: 'text_to_image',
  prompt: 'A clean launch poster',
  inputAssetIds: [],
  parameters: { aspectRatio: '16:9', stylePreset: 'poster', seed: 42, quality: 'high' },
}

test('image capability contract freezes model decisions and fail-closed runtime state', () => {
  assert.equal(imageCapabilityContract.schemaVersion, 'image-capability-v1')
  assert.equal(imageCapabilityContract.models.primary.modelId, 'gpt-image-2')
  assert.equal(imageCapabilityContract.models.backup.modelId, 'black-forest-labs/flux-1.1-pro')
  assert.equal(imageCapabilityContract.runtime.realProviderCallsApproved, false)
  assert.equal(imageCapabilityContract.runtime.productionEnablementApproved, false)
  assert.deepEqual(imageCapabilityContract.modes.map((mode) => mode.id), [
    'text_to_image',
    'image_to_image',
    'image_edit',
    'image_variation',
  ])
})

test('image provider projection distinguishes supported and unavailable modes', () => {
  const mock = imageCapabilityForProvider('mock')
  const replicate = imageCapabilityForProvider('replicate-staging')
  const openai = imageCapabilityForProvider('openai-gpt-image-2')

  assert.deepEqual(mock.modes, ['text_to_image', 'image_to_image'])
  assert.deepEqual(replicate.modes, ['text_to_image'])
  assert.deepEqual(replicate.supportedParameters, ['aspectRatio', 'stylePreset', 'seed'])
  assert.deepEqual(replicate.modeContracts.find((mode) => mode.id === 'text_to_image').parameters, ['aspectRatio', 'stylePreset', 'seed'])
  assert.equal(mock.modeContracts.find((mode) => mode.id === 'image_edit').available, false)
  assert.match(mock.modeContracts.find((mode) => mode.id === 'image_edit').unavailableReason, /No approved edit adapter/)
  assert.equal(replicate.modeContracts.find((mode) => mode.id === 'image_to_image').available, false)
  assert.equal(mock.parameterDefinitions.outputCount.maximum, 1)
  assert.deepEqual(openai.modes, ['text_to_image'])
  assert.deepEqual(openai.supportedParameters, ['aspectRatio', 'stylePreset', 'quality', 'outputCount', 'outputFormat'])
  assert.deepEqual(openai.parameterDefinitions.aspectRatio.options, ['1:1', '3:2', '2:3'])
})

test('image generation validation accepts the frozen text and image input contracts', () => {
  assert.equal(assertImageGenerationRequest(request), request)
  assert.equal(assertImageGenerationRequest({
    ...request,
    mode: 'image_to_image',
    inputAssetIds: ['asset-1'],
    parameters: { ...request.parameters, strength: 0.5 },
  }).mode, 'image_to_image')
})

test('image generation validation rejects unknown, unavailable, and invalid combinations', () => {
  assert.throws(
    () => assertImageGenerationRequest({ ...request, mode: 'image_edit', inputAssetIds: ['source', 'mask'] }),
    /mode is unavailable: image_edit/,
  )
  assert.throws(
    () => assertImageGenerationRequest({ ...request, inputAssetIds: ['asset-1'] }),
    /inputAssetIds must include 0 image asset/,
  )
  assert.throws(
    () => assertImageGenerationRequest({ ...request, parameters: { controls: ['HD'] } }),
    /parameters.controls is not supported/,
  )
  assert.throws(
    () => assertImageGenerationRequest({ ...request, parameters: { aspectRatio: '10:1' } }),
    /parameters.aspectRatio must be one of/,
  )
  assert.throws(
    () => assertImageGenerationRequest({ ...request, parameters: { strength: 2 } }),
    /parameters.strength is not supported for text_to_image/,
  )
})
