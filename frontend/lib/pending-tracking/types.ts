export type GridColumnType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "boolean"
  | "dropdown"

export type GridColumnMeta = {
  fieldName: string
  key: string
  title: string
  type: GridColumnType
  isBase: boolean
  order: number
  fieldMetadataId: number
  sourceType: "base" | "custom"
  opensResidentDetail: boolean
  isEditable: boolean
  dropdownOptions?: { optionId: number; value: string; label: string }[]
}

export type PendingTrackingGridResponse = {
  columns: GridColumnMeta[]
  rows: Record<string, unknown>[]
  totalCount: number
  page: number
  pageSize: number
  defaultSortKey: string
}

export type DetailDropdownOption = { optionId: number; value: string; label: string }

export type UnifiedDetailFieldRow = {
  fieldMetadataId: number
  fieldName: string
  displayName: string
  dataType: string
  screenLocation: string
  displayOrder: number
  modalSectionId: number | null
  value: string | number | boolean | null
  sourceType: "BaseTable" | "Custom"
  isEditable: boolean
  dropdownOptions?: DetailDropdownOption[]
  dropdownOptionId?: number | null
}

export type ModalSectionMeta = {
  modalSectionId: number | null
  sectionName: string
  sectionType: "Standard" | "LOCTracking"
  displayOrder: number
  fields: UnifiedDetailFieldRow[]
}

export type ResidentDetailHeader = {
  residentName: string | null
  /** Primary resident / patient key for integrations (e.g. Power BI PatientID). */
  residentId: string | null
  payerLabel: string | null
  dateOfBirthDisplay: string | null
  ageYears: number | null
  ssnDisplay: string | null
  admitDateDisplay: string | null
  dischargeDateDisplay: string | null
  isHotCase?: boolean
}

export type PendingTrackingDetailResponse = {
  trackingItemId: number
  companyId: number
  viewType: string
  fields: UnifiedDetailFieldRow[]
  sections: ModalSectionMeta[]
  header: ResidentDetailHeader
}

export type ResidentTask = {
  taskId: number
  title: string
  dueDate: string | null
  status: "Open" | "InProgress" | "Completed" | "Cancelled"
  assignee: string | null
  notes: string | null
  createdAt: string
  createdBy: string | null
}

export type ResidentNote = {
  noteId: number
  noteType: "CaseNote" | "Internal" | "External"
  body: string
  createdAt: string
  createdBy: string | null
  isPinned?: boolean
  isHighlighted?: boolean
}

export type ResidentEmail = {
  emailId: number
  subject: string
  body: string | null
  recipientEmail: string
  recipientName: string | null
  ccEmails: string | null
  sentAt: string
  sentBy: string | null
  status: "Sent" | "Failed" | "Queued"
  externalMessageId: string | null
}

export type ResidentAttachment = {
  attachmentId: number
  fileName: string
  contentType: string
  fileSizeBytes: number | null
  blobUrl: string
  blobContainer?: string
  blobName?: string
  uniqueId?: string | null
  residentId?: string | null
  uploadedAt: string
  uploadedBy: string | null
  description: string | null
}

export type GlobalTask = ResidentTask & {
  trackingItemId: number
  residentName: string | null
  facilityName: string | null
}

/** @deprecated legacy PendingFieldDefinition row shape */
export type FieldDefinitionRow = {
  FieldDefinitionId: number
  FieldName: string
  DisplayName: string
  DataType: string
  DisplayOrder: number
}
