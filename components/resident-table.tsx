"use client"

import { AlertTriangle, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
type TrackingItem = {
  trackingItemId: number
  facilityName: string | null
  residentName: string | null
  payerName: string | null
  payerType: string | null
  admitDate: string | null
  balance: number | null
  status: string | null
  assignedTo: string | null
  isHotCase: boolean
}

type ResidentTableProps = {
  section: string
}

function formatCurrency(value: number | null) {
  if (value === null) return "-"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value)
}

function formatDate(value: string | null) {
  if (!value) return "-"
  return new Date(value).toLocaleDateString("en-US")
}

export function ResidentTable({ section }: ResidentTableProps) {
  const [rows, setRows] = useState<TrackingItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadRows() {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/tracking-items?section=${section}`, {
          cache: "no-store",
        })
        if (!res.ok) {
          throw new Error("Unable to load tracking items.")
        }
        const data = (await res.json()) as { items: TrackingItem[] }
        if (isMounted) {
          setRows(data.items)
        }
      } catch (err) {
        if (isMounted) {
          setRows([])
          setError(err instanceof Error ? err.message : "Unknown error")
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadRows()
    return () => {
      isMounted = false
    }
  }, [section])

  return (
    <div className="bg-surface-container-lowest rounded-3xl overflow-hidden shadow-sm border border-outline-variant/10">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-secondary-container/30 border-b border-outline-variant/10">
              <th className="py-5 px-6 font-sans text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold">
                Facility
              </th>
              <th className="py-5 px-4 font-sans text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold">
                Resident Name
              </th>
              <th className="py-5 px-4 font-sans text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold">
                Payer
              </th>
              <th className="py-5 px-4 font-sans text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold">
                Admit Date
              </th>
              <th className="py-5 px-4 font-sans text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold">
                Balance
              </th>
              <th className="py-5 px-4 font-sans text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold">
                Status
              </th>
              <th className="py-5 px-4 font-sans text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold">
                Assigned To
              </th>
              <th className="py-5 px-4 font-sans text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold">
                Payer Type
              </th>
              <th className="py-5 px-4 font-sans text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold text-center">
                Flags
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/5">
            {isLoading && (
              <tr>
                <td
                  className="py-8 px-6 text-on-surface-variant"
                  colSpan={9}
                >
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading records...
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && error && (
              <tr>
                <td className="py-8 px-6 text-error" colSpan={9}>
                  {error}
                </td>
              </tr>
            )}

            {!isLoading && !error && rows.length === 0 && (
              <tr>
                <td className="py-8 px-6 text-on-surface-variant" colSpan={9}>
                  No records found for this section.
                </td>
              </tr>
            )}

            {!isLoading &&
              !error &&
              rows.map((row) => (
                <tr
                  key={row.trackingItemId}
                  className="hover:bg-surface-container-low/50 transition-colors group"
                >
                  <td className="py-4 px-6 font-bold text-sm text-on-surface">
                    {row.facilityName ?? "-"}
                  </td>
                  <td className="py-4 px-4 font-extrabold text-sm text-primary tracking-tight">
                    {row.residentName ?? "-"}
                  </td>
                  <td className="py-4 px-4">
                    <span className="px-3 py-1 bg-surface-container-highest rounded-full text-xs font-semibold text-on-surface">
                      {row.payerName ?? "-"}
                    </span>
                  </td>
                  <td className="py-4 px-4 font-medium text-sm">
                    {formatDate(row.admitDate)}
                  </td>
                  <td className="py-4 px-4 font-bold text-sm">
                    {formatCurrency(row.balance)}
                  </td>
                  <td className="py-4 px-4 text-sm">{row.status ?? "-"}</td>
                  <td className="py-4 px-4 text-sm">{row.assignedTo ?? "-"}</td>
                  <td className="py-4 px-4 text-sm">{row.payerType ?? "-"}</td>
                  <td className="py-4 px-4 text-center">
                    {row.isHotCase ? (
                      <AlertTriangle
                        className="w-4 h-4 text-error inline"
                        title="Hot Case"
                      />
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Table Footer/Pagination */}
      <div className="px-6 py-4 bg-surface-container-low/30 border-t border-outline-variant/10 flex justify-between items-center">
        <p className="text-xs font-medium text-on-surface-variant">
          Showing {rows.length} records
        </p>
      </div>
    </div>
  )
}
