"use client"

import { apiGet } from "@/services/api"
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ResidentDetailModal } from "@/components/resident-detail-modal"

type HotCaseRow = {
  trackingItemId: number
  residentName: string | null
  facilityName: string | null
  viewType: string | null
  status: string | null
  balance: number | null
  updatedAt: string | null
}

type HotCasesScreenProps = {
  companyId: number
  facilityId?: string | null
  state?: string | null
}

function formatMoney(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
}

export function HotCasesScreen({
  companyId,
  facilityId,
  state,
}: HotCasesScreenProps) {
  const [items, setItems] = useState<HotCaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set("companyId", String(companyId))
      if (facilityId) params.set("facilityId", facilityId)
      const res = await apiGet(`/api/hot-cases?${params}`, { cache: "no-store" })
      const data = (await res.json()) as { items?: HotCaseRow[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? "Failed to load hot cases.")
      setItems(data.items ?? [])
      if (data.error && (data.items?.length ?? 0) === 0) {
        setError(data.error)
      }
    } catch (e) {
      setItems([])
      setError(e instanceof Error ? e.message : "Failed to load.")
    } finally {
      setLoading(false)
    }
  }, [companyId, facilityId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 bg-orange-50/80">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Resident
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Facility
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Program
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Balance
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Updated
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-slate-500">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading hot cases…
                  </td>
                </tr>
              )}
              {!loading && error && !items.length && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-red-600">
                    {error}
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((row) => (
                  <tr key={row.trackingItemId} className="hover:bg-orange-50/40">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-900">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-orange-500" />
                        {row.residentName ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.facilityName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {row.viewType ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {row.status ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-slate-800">
                      {formatMoney(row.balance)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {row.updatedAt
                        ? new Date(row.updatedAt).toLocaleString(undefined, {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => {
                          setSelectedId(row.trackingItemId)
                          setModalOpen(true)
                        }}
                      >
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              {!loading && !items.length && !error && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    No hot cases right now. Mark residents as hot from the resident
                    detail view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ResidentDetailModal
        trackingItemId={selectedId}
        companyId={companyId}
        state={state}
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setSelectedId(null)
        }}
      />
    </>
  )
}
