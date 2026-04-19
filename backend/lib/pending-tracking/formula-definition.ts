import { z } from "zod"

/** Matches frontend / API contract for stored JSON on FieldMetadata.FormulaDefinitionJson */
export const fieldDataTypeSchema = z.enum(["text", "numeric", "date", "boolean"])

export const formulaOperandSchema = z
  .object({
    sourceType: z.enum(["field", "constant"]),
    fieldCode: z.string().optional(),
    constantValue: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .optional(),
    dataType: fieldDataTypeSchema.optional(),
  })
  .superRefine((op, ctx) => {
    if (op.sourceType === "field") {
      if (!op.fieldCode?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "field operand requires fieldCode",
        })
      }
    }
  })

export const dateArithmeticFormulaSchema = z.object({
  calculationType: z.literal("date_arithmetic"),
  sourceFieldCode: z.string().min(1),
  operator: z.enum(["add_days", "subtract_days"]),
  days: z.number().int(),
})

export const numberArithmeticFormulaSchema = z.object({
  calculationType: z.literal("number_arithmetic"),
  leftOperand: formulaOperandSchema,
  operator: z.enum(["add", "subtract", "multiply", "divide"]),
  rightOperand: formulaOperandSchema,
})

export const comparisonOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "greater_than",
  "less_than",
  "greater_than_or_equal",
  "less_than_or_equal",
  "contains",
  "is_empty",
  "is_not_empty",
])

export const conditionalFormulaSchema = z
  .object({
    calculationType: z.literal("conditional"),
    leftOperand: formulaOperandSchema,
    comparisonOperator: comparisonOperatorSchema,
    rightOperand: formulaOperandSchema.optional(),
    trueResult: formulaOperandSchema,
    falseResult: formulaOperandSchema,
    resultDataType: fieldDataTypeSchema,
  })
  .superRefine((f, ctx) => {
    const needRight = !["is_empty", "is_not_empty"].includes(
      f.comparisonOperator
    )
    if (needRight && !f.rightOperand) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "rightOperand required for this comparison",
        path: ["rightOperand"],
      })
    }
  })

/** Union (not discriminated) because conditional uses .superRefine. */
export const formulaDefinitionSchema = z.union([
  dateArithmeticFormulaSchema,
  numberArithmeticFormulaSchema,
  conditionalFormulaSchema,
])

export type FormulaDefinition = z.infer<typeof formulaDefinitionSchema>
export type FormulaOperand = z.infer<typeof formulaOperandSchema>

export function parseFormulaDefinitionJson(
  raw: string | null | undefined
): FormulaDefinition | null {
  if (raw == null || String(raw).trim() === "") return null
  try {
    const parsed: unknown = JSON.parse(String(raw))
    const r = formulaDefinitionSchema.safeParse(parsed)
    return r.success ? r.data : null
  } catch {
    return null
  }
}
