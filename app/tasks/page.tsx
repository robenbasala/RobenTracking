"use client"

import { MainAppShell } from "@/components/main-app-shell"
import { TasksScreen } from "@/components/tasks-screen"

const DEFAULT_COMPANY_ID = Number(
  process.env.NEXT_PUBLIC_TRACKING_DEFAULT_COMPANY_ID ?? "1"
)

const DEFAULT_STATE = process.env.NEXT_PUBLIC_DEFAULT_STATE?.trim() || ""

export default function TasksPage() {
  const companyId = Number.isFinite(DEFAULT_COMPANY_ID)
    ? DEFAULT_COMPANY_ID
    : 1

  return (
    <MainAppShell>
      <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="max-w-2xl">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
            Peak Healthcare
          </span>
          <h1 className="font-headline mb-2 text-4xl font-extrabold tracking-tight text-on-surface">
            Tasks
          </h1>
          <p className="text-lg text-on-surface-variant">
            Operational task queue for case managers and billing follow-ups.
          </p>
        </div>
      </div>

      <TasksScreen
        companyId={companyId}
        state={DEFAULT_STATE || undefined}
      />
    </MainAppShell>
  )
}
