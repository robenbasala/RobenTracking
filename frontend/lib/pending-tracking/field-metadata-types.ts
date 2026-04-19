/**
 * Client-only type shape for grid row mapping (no mssql / server imports).
 */
export type FieldMetadataRow = {
  FieldMetadataId: number
  FieldName: string
  DisplayName: string
  DataType: string
  ScreenLocation: string
  DisplayOrder: number
  IsActive: boolean
  IsRequired: boolean
  IsEditable: boolean
  IsSystemField: boolean
  SourceType: string
  SourceColumnName: string | null
  ModalSectionId: number | null
}
