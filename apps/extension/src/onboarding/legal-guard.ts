import type { LegalStatus } from "@nulo/legal"
import type { NavigationGuard, RouteLocationRaw } from "vue-router"

export const TERMS_PATH = "/onboarding/terms"
/** An ALLOWLIST: a page added later is gated until someone decides otherwise. */
const OPEN_PATHS: ReadonlySet<string> = new Set(["/onboarding/welcome", TERMS_PATH])

export type OnboardingNext = "create" | "import"

/** `next` arrives in the URL, so it is an enum or it is `create` — never a path. */
export function parseNext(raw: unknown): OnboardingNext {
	return raw === "import" ? "import" : "create"
}

/** Where a gated path resumes once the Terms are accepted. */
function resumeTarget(path: string): OnboardingNext {
	return path === "/onboarding/import" ? "import" : "create"
}

/**
 * Every onboarding route except the two open ones needs a current acceptance. A status read that
 * fails is "not accepted": the gate is the safe side of an unreachable background.
 */
export function createLegalGuard(getStatus: () => Promise<LegalStatus>): NavigationGuard {
	return async (to): Promise<true | RouteLocationRaw> => {
		if (OPEN_PATHS.has(to.path)) return true
		const status = await getStatus().catch((): LegalStatus => "missing")
		if (status === "current") return true
		return { path: TERMS_PATH, query: { next: resumeTarget(to.path) }, replace: true }
	}
}
