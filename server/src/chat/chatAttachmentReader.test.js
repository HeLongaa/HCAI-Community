import assert from 'node:assert/strict'
import test from 'node:test'

import { readChatAttachmentBytes } from './chatAttachmentReader.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

const asset = (overrides = {}) => ({
  id: 'asset-1',
  fileName: 'brief.md',
  storageKey: 'private/brief.md',
  contentType: 'text/markdown',
  sizeBytes: 64,
  purpose: 'library_asset',
  scanStatus: 'clean',
  ...overrides,
})

test('Chat attachment reader decodes bounded UTF-8 text for policy and Provider input', async () => {
  const body = Buffer.from('# Safe brief')
  const attachments = await readChatAttachmentBytes([asset({ sizeBytes: body.length })], async () => body)
  assert.equal(attachments[0].providerInput.kind, 'text')
  assert.equal(attachments[0].providerInput.text, '# Safe brief')
  assert.equal(JSON.stringify(attachments).includes(body.toString('base64')), false)
})

test('Chat attachment reader validates image magic bytes and creates in-memory data input', async () => {
  const attachments = await readChatAttachmentBytes([
    asset({ fileName: 'reference.png', contentType: 'image/png', sizeBytes: png.length }),
  ], async () => png)
  assert.equal(attachments[0].providerInput.kind, 'image')
  assert.match(attachments[0].providerInput.dataUrl, /^data:image\/png;base64,/)
  await assert.rejects(
    readChatAttachmentBytes([asset({ fileName: 'fake.png', contentType: 'image/png', sizeBytes: 4 })], async () => Buffer.from('fake')),
    (error) => error.code === 'CHAT_ATTACHMENT_BYTES_UNAVAILABLE' && error.details.reasonCode === 'magic_type_mismatch',
  )
})

test('Chat attachment reader fails closed on missing reader, binary text, and size mismatch', async () => {
  await assert.rejects(
    readChatAttachmentBytes([asset()], null),
    (error) => error.details.reasonCode === 'object_reader_unavailable',
  )
  await assert.rejects(
    readChatAttachmentBytes([asset({ sizeBytes: 3 })], async () => Buffer.from([0, 1, 2])),
    (error) => error.details.reasonCode === 'text_binary_content',
  )
  await assert.rejects(
    readChatAttachmentBytes([asset({ sizeBytes: 2 })], async () => Buffer.from('longer')),
    (error) => error.details.reasonCode === 'size_mismatch',
  )
  await assert.rejects(
    readChatAttachmentBytes([asset({ sizeBytes: 64 })], async () => Buffer.from('shorter')),
    (error) => error.details.reasonCode === 'size_mismatch',
  )
})
