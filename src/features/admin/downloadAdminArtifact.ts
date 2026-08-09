type DownloadTextArtifactOptions = {
  content: BlobPart
  fileName: string
  mimeType: string
}

type DownloadJsonArtifactOptions = {
  value: unknown
  fileName: string
  mimeType: string
}

const objectUrlRevokeDelayMs = 1_000

export const downloadTextArtifact = ({ content, fileName, mimeType }: DownloadTextArtifactOptions) => {
  const objectUrl = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const link = document.createElement('a')

  try {
    link.href = objectUrl
    link.download = fileName
    link.hidden = true
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), objectUrlRevokeDelayMs)
  }
}

export const downloadJsonArtifact = ({ value, fileName, mimeType }: DownloadJsonArtifactOptions) => {
  downloadTextArtifact({
    content: JSON.stringify(value, null, 2),
    fileName,
    mimeType,
  })
}
