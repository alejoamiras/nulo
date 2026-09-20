import type { LegalViewStatus } from "@/composables/useLegalAcceptance"

export const LEGAL_DISMISSED_KEY = "nulo:legal:dismissed"
export const LEGAL_DECLINED_PATH = "/popup/legal/declined"

/** Route prefixes the sheet may never cover: what a person who declined must still be able to do. */
const NEVER_COVERED_PATHS = ["/popup/legal/", "/popup/settings/security/export"] as const

export interface LegalSheetContext {
	status: LegalViewStatus
	routeName: unknown
	routePath: string
	/** True on routes reachable only while unlocked, so the lock, register and import screens never qualify. */
	isAuthRequired: boolean
	/** The Terms version the person said "Not now" to in this browser session, if any. */
	dismissedVersion: unknown
	termsVersion: string
}

/**
 * Dismissal is per version: a newer Terms version published mid-session asks again. A dApp or
 * passkey window (`windows-*`) is its own app instance whose route IS its pending request, so
 * covering or navigating it would abandon that request.
 */
export function shouldShowLegalSheet(ctx: LegalSheetContext): boolean {
	if (ctx.status !== "missing" && ctx.status !== "stale") return false
	if (!ctx.isAuthRequired) return false
	if (typeof ctx.routeName === "string" && ctx.routeName.startsWith("windows-")) return false
	if (NEVER_COVERED_PATHS.some((prefix) => ctx.routePath.startsWith(prefix))) return false
	return ctx.dismissedVersion !== ctx.termsVersion
}
