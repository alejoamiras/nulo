import { beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { LEGAL_MANIFEST, type LegalStatus, RISK_POINTS } from "@nulo/legal"

const TERMS = LEGAL_MANIFEST.terms.at(-1)?.version as string
const { route, push, legal } = await vi.hoisted(async () => {
	// vi.hoisted runs before the static imports resolve, so these two are imported in place — through
	// Vite, not require(): a require() reaches the raw workspace TS via Node's own loader, whose
	// extensionless re-exports do not resolve there.
	const { reactive: makeReactive } = await import("vue")
	const { EventHandler: Handler } = await import("@nulo/wallet-core/utils")
	return {
		route: makeReactive({ name: "popup-general", path: "/popup/general", meta: { isAuthRequired: true } }),
		push: vi.fn(async (_to: string) => {}),
		legal: {
			onAcceptanceChanged: new Handler<"current" | "stale" | "missing">(),
			onConnected: new Handler<void>(),
			getStatus: vi.fn(async (): Promise<"current" | "stale" | "missing"> => "stale"),
			getRecord: vi.fn(async (): Promise<unknown> => null),
			accept: vi.fn(async (_surface: string) => ({})),
		},
	}
})
const session = new Map<string, unknown>()

vi.mock("vue-router", () => ({ useRoute: () => route, useRouter: () => ({ push }) }))
vi.mock("@/utils/core", () => ({ managers: { legal } }))
vi.mock("@/utils/legal-links", () => ({ openLegalDocument: vi.fn() }))

import LegalAcceptanceSheet from "./LegalAcceptanceSheet.vue"

const STUBS = {
	Flex: { template: '<div v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: '<span v-bind="$attrs"><slot /></span>', inheritAttrs: false },
	LegalConsent: {
		name: "LegalConsent",
		template:
			'<div data-testid="stub-consent" :data-points="points ? points.length : 0" :data-changes="(changes || []).join(\'|\')" @click="$emit(\'accept\')" />',
		props: ["points", "changes", "termsVersion", "busy"],
		emits: ["accept", "open"],
	},
}

const mountSheet = async () => {
	const w = mount(LegalAcceptanceSheet, { global: { stubs: STUBS } })
	await flushPromises()
	return w
}
const sheet = (w: Awaited<ReturnType<typeof mountSheet>>) => w.find('[data-testid="legal-sheet"]')

beforeEach(() => {
	session.clear()
	push.mockClear()
	Object.assign(route, { name: "popup-general", path: "/popup/general", meta: { isAuthRequired: true } })
	legal.getStatus.mockResolvedValue("stale")
	legal.getRecord.mockResolvedValue(null)
	legal.accept.mockClear()
	vi.stubGlobal("chrome", {
		storage: {
			session: {
				get: async (key: string) => ({ [key]: session.get(key) }),
				set: async (entries: Record<string, unknown>) => {
					for (const [key, value] of Object.entries(entries)) session.set(key, value)
				},
			},
			onChanged: { addListener: () => {}, removeListener: () => {} },
		},
	})
})

describe("LegalAcceptanceSheet", () => {
	test("with a prior record it lists what changed; with none it shows the first-run points", async () => {
		legal.getRecord.mockResolvedValue({
			termsVersion: "0.9",
			privacyVersionShown: "0.9",
			acceptedAt: 1,
			surface: "onboarding",
			history: [],
		})
		const changed = await mountSheet()
		expect(sheet(changed).attributes("data-variant")).toBe("changed")
		expect(changed.get('[data-testid="stub-consent"]').attributes("data-changes")).toBe(
			LEGAL_MANIFEST.terms.flatMap((v) => v.changes).join("|"),
		)

		legal.getStatus.mockResolvedValue("missing")
		legal.getRecord.mockResolvedValue(null)
		const review = await mountSheet()
		expect(sheet(review).attributes("data-variant")).toBe("review")
		// Every point whole: the sheet asks the person to acknowledge them, so it may not abridge them.
		expect(review.getComponent({ name: "LegalConsent" }).props("points")).toEqual(RISK_POINTS)
	})

	test("Continue records a popup acceptance and the sheet leaves; Not now remembers the version and goes to the declined screen", async () => {
		const accepting = await mountSheet()
		await accepting.get('[data-testid="stub-consent"]').trigger("click")
		await flushPromises()
		expect(legal.accept).toHaveBeenCalledWith("popup")
		expect(sheet(accepting).exists()).toBe(false)

		const declining = await mountSheet()
		await declining.get('[data-testid="legal-sheet-not-now"]').trigger("click")
		await flushPromises()
		expect(session.get("nulo:legal:dismissed")).toBe(TERMS)
		expect(push).toHaveBeenCalledWith("/popup/legal/declined")
		expect(sheet(declining).exists()).toBe(false)
	})

	test.each([
		{ name: "windows-execute", path: "/windows/execute", meta: { isAuthRequired: true } },
		{ name: "popup-auth", path: "/popup/auth", meta: { isAuthRequired: false } },
		{ name: "popup-settings-security-export-full", path: "/popup/settings/security/export/full", meta: { isAuthRequired: true } },
		{ name: "popup-legal-declined", path: "/popup/legal/declined", meta: { isAuthRequired: true } },
	])("stays off $path", async (where) => {
		Object.assign(route, where)
		expect(sheet(await mountSheet()).exists()).toBe(false)
	})

	test("renders nothing until the first status read lands", async () => {
		let release: (status: LegalStatus) => void = () => {}
		legal.getStatus.mockReturnValue(new Promise<LegalStatus>((resolve) => (release = resolve)))
		const w = await mountSheet()
		expect(sheet(w).exists()).toBe(false)
		release("missing")
		await flushPromises()
		expect(sheet(w).exists()).toBe(true)
	})
})
