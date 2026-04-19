import type { Response } from "express"
import PDFDocument from "pdfkit"

function normalizeCell(s: unknown): string {
  return String(s ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function truncateChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (maxChars <= 1) return "…"
  return `${text.slice(0, maxChars - 1)}…`
}

/** Width in pt for each column; sums to `usableW`. */
function computeColWidths(
  headers: string[],
  rows: string[][],
  usableW: number,
  bodyFs: number
): number[] {
  const n = headers.length
  if (n === 0) return []
  const sample = rows.length > 600 ? rows.slice(0, 600) : rows
  const charUnit = Math.max(3.2, bodyFs * 0.5)
  const weights = headers.map((h, i) => {
    let maxChars = normalizeCell(h).length
    for (const r of sample) {
      const cell = normalizeCell(r[i] ?? "")
      if (cell.length > maxChars) maxChars = cell.length
    }
    return Math.sqrt(2 + maxChars)
  })
  let wsum = weights.reduce((a, b) => a + b, 0)
  if (!Number.isFinite(wsum) || wsum <= 0) wsum = n
  const raw = weights.map((w) => (w / wsum) * usableW)
  const minW = 24
  const adjusted = raw.map((w) => Math.max(minW, w))
  const sum2 = adjusted.reduce((a, b) => a + b, 0)
  return adjusted.map((w) => (w / sum2) * usableW)
}

export function streamTrackingGridPdf(
  res: Response,
  opts: {
    titleLine: string
    headers: string[]
    rows: string[][]
    filename: string
  }
): void {
  const safeName = opts.filename.replace(/["\r\n]/g, "_")

  const doc = new PDFDocument({
    margin: 22,
    size: "LETTER",
    layout: "landscape",
    autoFirstPage: true,
  })

  res.setHeader("Content-Type", "application/pdf")
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeName.replace(/"/g, "")}"`
  )

  doc.on("error", (err) => {
    console.error("PDFDocument error:", err)
    if (!res.headersSent) {
      res.status(500).json({ error: "PDF generation failed." })
    } else {
      res.end()
    }
  })

  doc.pipe(res)

  const left = doc.page.margins.left
  const usableW =
    doc.page.width - doc.page.margins.left - doc.page.margins.right
  const pageBottom = doc.page.height - doc.page.margins.bottom

  const n = Math.max(1, opts.headers.length)
  const bodyFs = Math.max(5, Math.min(7.2, 5.4 + 48 / n))
  const headerFs = Math.max(5.5, Math.min(8.2, bodyFs + 1.1))
  const charUnitBody = Math.max(3.2, bodyFs * 0.5)
  const charUnitHeader = Math.max(3.4, headerFs * 0.52)

  const colWidths = computeColWidths(
    opts.headers,
    opts.rows,
    usableW,
    bodyFs
  )

  const headerH = headerFs + 9
  const rowH = bodyFs + 5

  doc.fontSize(10).font("Helvetica-Bold").text(opts.titleLine, {
    width: usableW,
    underline: true,
  })
  doc.moveDown(0.35)

  let y = doc.y

  const drawHeader = () => {
    doc.font("Helvetica-Bold").fontSize(headerFs)
    let x = left
    for (let i = 0; i < n; i++) {
      const cw = colWidths[i] ?? usableW / n
      const maxChars = Math.max(
        2,
        Math.floor((cw - 4) / charUnitHeader)
      )
      const t = truncateChars(normalizeCell(opts.headers[i]), maxChars)
      doc.text(t, x, y, {
        width: Math.max(10, cw - 2),
        lineBreak: false,
      })
      x += cw
    }
    y += headerH
    doc.moveTo(left, y - 4).lineTo(left + usableW, y - 4).stroke()
    doc.font("Helvetica").fontSize(bodyFs)
  }

  drawHeader()

  for (const row of opts.rows) {
    if (y + rowH > pageBottom) {
      doc.addPage({ layout: "landscape", margin: 22 })
      y = doc.page.margins.top
      drawHeader()
    }
    let x = left
    for (let i = 0; i < n; i++) {
      const cw = colWidths[i] ?? usableW / n
      const maxChars = Math.max(
        2,
        Math.floor((cw - 4) / charUnitBody)
      )
      const raw = row[i] ?? ""
      const t = truncateChars(normalizeCell(raw), maxChars)
      doc.text(t, x, y, {
        width: Math.max(10, cw - 2),
        lineBreak: false,
      })
      x += cw
    }
    y += rowH
  }

  doc.end()
}
