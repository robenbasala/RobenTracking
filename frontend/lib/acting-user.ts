/** Shown in UI and sent as stoppedBy until real auth exists. */
export function getActingUserLabel(): string {
  const fromEnv =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_ACTING_USER?.trim()
  if (fromEnv) return fromEnv
  return "Clinical Architect"
}
