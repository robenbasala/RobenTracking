export const DEFAULT_DATASET_ID = "4c41eb0d-2fea-4ed7-8de3-224dad8455c6"

export function getDatasetId(): string {
  return process.env.TRACKING_DATASET_ID?.trim() || DEFAULT_DATASET_ID
}

