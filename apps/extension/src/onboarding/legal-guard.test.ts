import { describe, expect, test } from "vitest"
import type { LegalStatus } from "@nulo/legal"
import type { RouteLocationNormalized } from "vue-router"
import { createLegalGuard, parseNext } from "./legal-guard"

const go = (status: LegalStatus | Error, path: string) => {
	const guard = createLegalGuard(async () => {
		if (status instanceof Error) throw status
		return status
	})
	return (guard as (to: RouteLocationNormalized) => Promise<unknown>)({ path } as RouteLocationNormalized)
}

describe("onboarding legal guard", () => {
	test.each(["/onboarding/welcome", "/onboarding/terms"])("%s is open with no acceptance at all", async (path) => {
		expect(await go("missing", path)).toBe(true)
	})

	test.each(["create", "import", "learn", "fees", "presto", "done", "anything-added-later"])(
		"/onboarding/%s without a current acceptance lands on the Terms",
		async (page) => {
			for (const status of ["missing", "stale", new Error("background unreachable")] as const) {
				expect(await go(status, `/onboarding/${page}`)).toMatchObject({ path: "/onboarding/terms", replace: true })
			}
		},
	)

	test("the import path resumes at import; everything else resumes at create", async () => {
		expect(await go("missing", "/onboarding/import")).toMatchObject({ query: { next: "import" } })
		expect(await go("missing", "/onboarding/learn")).toMatchObject({ query: { next: "create" } })
	})

	test("a current acceptance passes every route", async () => {
		expect(await go("current", "/onboarding/create")).toBe(true)
	})

	test("next is an enum: anything that is not import is create", () => {
		expect(parseNext("import")).toBe("import")
		for (const hostile of ["//evil.example", "/popup/settings", ["import"], undefined, "IMPORT"]) {
			expect(parseNext(hostile)).toBe("create")
		}
	})
})
