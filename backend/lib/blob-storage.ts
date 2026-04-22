import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob"

type BlobStorageConfig = {
  account: string
  key: string
  container: string
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

export function getBlobStorageConfig(): BlobStorageConfig {
  return {
    account: requireEnv("AZURE_STORAGE_ACCOUNT"),
    key: requireEnv("AZURE_STORAGE_KEY"),
    container: requireEnv("AZURE_STORAGE_CONTAINER"),
  }
}

function getServiceClient(cfg: BlobStorageConfig): BlobServiceClient {
  const credential = new StorageSharedKeyCredential(cfg.account, cfg.key)
  const url = `https://${cfg.account}.blob.core.windows.net`
  return new BlobServiceClient(url, credential)
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)
}

export async function uploadResidentAttachment(params: {
  trackingItemId: number
  companyId: number
  originalFileName: string
  contentType: string
  bytes: Buffer
}): Promise<{ blobUrl: string; blobContainer: string; blobName: string }> {
  const cfg = getBlobStorageConfig()
  const service = getServiceClient(cfg)
  const containerClient = service.getContainerClient(cfg.container)
  await containerClient.createIfNotExists()

  const extIdx = params.originalFileName.lastIndexOf(".")
  const ext = extIdx > -1 ? params.originalFileName.slice(extIdx).slice(0, 20) : ""
  const base = extIdx > -1 ? params.originalFileName.slice(0, extIdx) : params.originalFileName
  const blobName =
    `resident/${params.companyId}/${params.trackingItemId}/` +
    `${Date.now()}-${sanitizeSegment(base)}${sanitizeSegment(ext)}`

  const blobClient = containerClient.getBlockBlobClient(blobName)
  await blobClient.uploadData(params.bytes, {
    blobHTTPHeaders: { blobContentType: params.contentType || "application/octet-stream" },
  })

  return {
    blobUrl: blobClient.url,
    blobContainer: cfg.container,
    blobName,
  }
}

export function generateReadSasUrl(blobContainer: string, blobName: string): string {
  const cfg = getBlobStorageConfig()
  if (blobContainer !== cfg.container) {
    throw new Error("Attachment container mismatch.")
  }
  const credential = new StorageSharedKeyCredential(cfg.account, cfg.key)
  const startsOn = new Date(Date.now() - 60_000)
  const expiresOn = new Date(Date.now() + 10 * 60_000)
  const sas = generateBlobSASQueryParameters(
    {
      containerName: blobContainer,
      blobName,
      startsOn,
      expiresOn,
      permissions: BlobSASPermissions.parse("r"),
      protocol: "https",
    },
    credential
  ).toString()
  return `https://${cfg.account}.blob.core.windows.net/${blobContainer}/${encodeURI(blobName)}?${sas}`
}
