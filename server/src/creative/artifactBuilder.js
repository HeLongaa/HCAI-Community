import { createHash } from 'node:crypto'

const promptPreview = (prompt) => String(prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
const sha256 = (value) => createHash('sha256').update(String(value ?? '')).digest('hex')
const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export const buildCreativeArtifactMetadata = ({ generation, output }) => ({
  generated: true,
  generationId: generation.id,
  outputId: output.id,
  workspace: generation.workspace,
  mode: generation.mode,
  provider: {
    id: generation.provider.id,
    mode: generation.provider.mode,
  },
  promptHash: sha256(generation.prompt),
  promptPreview: promptPreview(generation.prompt),
  inputAssetIds: generation.inputAssetIds,
  parameterKeys: Object.keys(generation.parameters ?? {}).sort(),
  outputType: output.type,
  sourceUrl: output.url,
  usage: generation.usage,
  quota: generation.quota,
  safety: generation.safety,
  policy: generation.policy,
})

export const buildCreativeArtifactObject = ({ generation, output }) => {
  const metadata = buildCreativeArtifactMetadata({ generation, output })
  if (output.type === 'image') {
    const title = escapeXml(`${generation.workspace}:${generation.mode}`)
    const prompt = escapeXml(metadata.promptPreview || 'Generated mock creative output')
    const body = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img">',
      `<title>${title}</title>`,
      '<rect width="1024" height="1024" fill="#121826"/>',
      '<rect x="96" y="112" width="832" height="800" rx="28" fill="#f5f7fb"/>',
      '<rect x="148" y="164" width="728" height="420" rx="18" fill="#1f6feb"/>',
      '<circle cx="260" cy="276" r="56" fill="#ffd166"/>',
      '<path d="M154 584 L396 368 L536 500 L672 392 L872 584 Z" fill="#49d17d"/>',
      '<text x="148" y="684" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#121826">Mock provider output</text>',
      `<text x="148" y="742" font-family="Arial, sans-serif" font-size="24" fill="#2d3748">${prompt}</text>`,
      `<text x="148" y="808" font-family="Arial, sans-serif" font-size="18" fill="#5f6b7a">${escapeXml(metadata.generationId)}</text>`,
      '</svg>',
    ].join('')
    return {
      fileName: `${generation.workspace}-${generation.id}-${output.id}.svg`,
      contentType: 'image/svg+xml',
      body,
      metadata,
    }
  }
  const body = JSON.stringify({
    kind: 'creative-generated-artifact',
    metadata,
    output: {
      id: output.id,
      type: output.type,
      label: output.label,
      contentType: output.contentType,
    },
  }, null, 2)
  return {
    fileName: `${generation.workspace}-${generation.id}-${output.id}.json`,
    contentType: 'application/json',
    body,
    metadata,
  }
}
