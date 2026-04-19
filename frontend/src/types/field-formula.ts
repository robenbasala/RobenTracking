/** Aligned with backend `formula-definition.ts` / API payloads. */

export type FieldKind = "regular" | "calculated"

export type FieldDataType = "text" | "numeric" | "date" | "boolean"

export type CalculationType = "date_arithmetic" | "number_arithmetic" | "conditional"

export type OperandSourceType = "field" | "constant"

export type ArithmeticOperator = "add" | "subtract" | "multiply" | "divide"

export type DateOperator = "add_days" | "subtract_days"

export type ComparisonOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "greater_than_or_equal"
  | "less_than_or_equal"
  | "contains"
  | "is_empty"
  | "is_not_empty"

export interface FormulaOperand {
  sourceType: OperandSourceType
  fieldCode?: string
  constantValue?: string | number | boolean | null
  dataType?: FieldDataType
}

export interface DateArithmeticFormula {
  calculationType: "date_arithmetic"
  sourceFieldCode: string
  operator: DateOperator
  days: number
}

export interface NumberArithmeticFormula {
  calculationType: "number_arithmetic"
  leftOperand: FormulaOperand
  operator: ArithmeticOperator
  rightOperand: FormulaOperand
}

export interface ConditionalFormula {
  calculationType: "conditional"
  leftOperand: FormulaOperand
  comparisonOperator: ComparisonOperator
  rightOperand?: FormulaOperand
  trueResult: FormulaOperand
  falseResult: FormulaOperand
  resultDataType: FieldDataType
}

export type FormulaDefinition =
  | DateArithmeticFormula
  | NumberArithmeticFormula
  | ConditionalFormula

export interface FieldConfigurationPayload {
  fieldCode: string
  displayName: string
  dataType: string
  fieldKind: FieldKind
  screen: string
  displayOrder: number
  active: boolean
  required: boolean
  editable: boolean
  viewTypes: string[]
  states: string[]
  formulaDefinition?: FormulaDefinition | null
}
