import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Field Configuration | Clinical Architect",
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  /* Material Symbols: single <link> in root app/layout.tsx */
  return children
}
