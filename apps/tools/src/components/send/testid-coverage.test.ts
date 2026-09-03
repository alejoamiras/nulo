import { mount } from "@vue/test-utils"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { Component } from "vue"
import type { ExitPlan, GasLegPlan, ResolvedToken, SendPlan, SelectableToken } from "@/lib/send-model"

/**
 * E2E selects only by `data-testid`, so an interactive element without one is unreachable to the
 * suite the moment copy or structure changes. Every send-step component is mounted and swept; the
 * two orchestrators (SendWizard, SendView) compose children rather than emitting controls of their
 * own, so they are swept at the template level instead of dragging the whole service graph in.
 */
const INTERACTIVE = 'button, input, select, textarea, [role="tab"], [role="option"], a[href]'

import AmountStep from "./AmountStep.vue"
import ChoiceCards from "./ChoiceCards.vue"
import GasBreakdown from "./GasBreakdown.vue"
import PasteAddress from "./PasteAddress.vue"
import ReviewDetails from "./ReviewDetails.vue"
import ReviewStep from "./ReviewStep.vue"
import SpriteSheet from "./SpriteSheet.vue"
import StepStrip from "./StepStrip.vue"
import TokenList from "./TokenList.vue"
import TokenStep from "./TokenStep.vue"
import TokenTile from "./TokenTile.vue"
import WizardShell from "./WizardShell.vue"

const TOKEN: SelectableToken = {
	chainId: 11155111,
	address: "0x70e0ba845a1a0f2da3359c97e0285013525ffc49",
	symbol: "USDC",
	name: "Nulo USDC",
	decimals: 6,
	source: "manifest",
	logoKey: "11155111:0x70e0ba845a1a0f2da3359c97e0285013525ffc49",
}

const RESOLVED: ResolvedToken = {
	...TOKEN,
	state: { kind: "registered" } as ResolvedToken["state"],
	portal: "0x94752ef7cf8f037f78ee7722a9387ef95c819fc8",
	words: { nameWord: `0x${"1".repeat(64)}`, symbolWord: `0x${"2".repeat(64)}` },
	l2Token: `0x${"c".repeat(64)}`,
}

const GAS: GasLegPlan = {
	fuelAmount: 1_000_000n,
	fuelFj: 20_000_000_000_000_000_000n,
	quote: 20_000_000_000_000_000_000n,
	minFuelOutput: 19_000_000_000_000_000_000n,
	route: { path: [], zeroForOnes: [] } as GasLegPlan["route"],
	capped: null,
}

const PLAN: SendPlan = { direction: "l1-to-l2", intent: "token+gas", token: RESOLVED, amount: 5_000_000n, isPrivate: true, gas: GAS }
const EXIT: ExitPlan = { direction: "l2-to-l1", token: RESOLVED, amount: 5_000_000n, isPrivate: true, recipientL1: TOKEN.address }
const BALANCES = { l1: 9_000_000n, l2Public: 1n, l2Private: 2n }
const REVIEW = {
	plan: PLAN,
	portalVerified: "verified",
	account: `0x${"a".repeat(64)}`,
	signatureValiditySeconds: 600,
	slippageBps: 300,
}

const CASES: Array<[string, Component, Record<string, unknown>]> = [
	[
		"AmountStep",
		AmountStep,
		{
			direction: "l1-to-l2",
			token: RESOLVED,
			balances: BALANCES,
			intent: "token+gas",
			amount: "1",
			isPrivate: true,
			gas: GAS,
			routeKind: "route",
			routeLoading: false,
			txTarget: 3,
			gasError: null,
		},
	],
	["ChoiceCards", ChoiceCards, { intent: "token", exitOnly: false, feeAsset: false, noRoute: false }],
	["GasBreakdown", GasBreakdown, { token: RESOLVED, amount: 5_000_000n, gas: GAS, txTarget: 3, loading: false, error: null }],
	["PasteAddress", PasteAddress, { error: null }],
	["ReviewDetails", ReviewDetails, REVIEW],
	[
		"ReviewStep",
		ReviewStep,
		{ ...REVIEW, estimate: { takes: "3-8 min", networkFee: "sponsored" }, grant: "idle", busy: false, error: null },
	],
	[
		"ReviewStep (exit)",
		ReviewStep,
		{ ...REVIEW, plan: EXIT, estimate: { takes: "long", networkFee: "own" }, grant: "declined", busy: false, error: "nope" },
	],
	["SpriteSheet", SpriteSheet, {}],
	[
		"StepStrip",
		StepStrip,
		{
			steps: [
				{ key: "token", label: "Token" },
				{ key: "amount", label: "Amount" },
				{ key: "review", label: "Review" },
			],
			active: 0,
			completed: 2,
		},
	],
	[
		"TokenList",
		TokenList,
		{ tokens: [TOKEN], selected: TOKEN, balances: { [TOKEN.logoKey]: 1n }, loading: false, provenance: "fresh", empty: false },
	],
	[
		"TokenStep",
		TokenStep,
		{
			direction: "l1-to-l2",
			tokens: [TOKEN],
			search: "",
			provenance: "fresh",
			loading: false,
			catalogError: null,
			selected: TOKEN,
			resolved: RESOLVED,
			resolving: false,
			selectionError: null,
			balances: BALANCES,
			pasteError: null,
		},
	],
	["TokenTile", TokenTile, { token: TOKEN, selected: false }],
	["WizardShell", WizardShell, { direction: "l1-to-l2", step: 0, completed: 2, canSwitchDirection: true }],
]

/** Every element the sweep can reach, including whatever a disclosure reveals when opened. */
async function sweep(w: ReturnType<typeof mount>): Promise<{ missing: string[]; seen: number }> {
	const found = () => [...w.element.parentElement!.querySelectorAll(INTERACTIVE)]
	const missing = () =>
		found()
			.filter((el) => !el.getAttribute("data-testid"))
			.map((el) => el.outerHTML.slice(0, 120))
	const first = missing()
	let seen = found().length
	for (const btn of w.findAll("button[data-testid]")) await btn.trigger("click")
	seen += found().length
	return { missing: [...first, ...missing()], seen }
}

describe("send-step testid coverage", () => {
	it.each(CASES)("%s gives every interactive element a data-testid", async (name, component, props) => {
		const { missing, seen } = await sweep(mount(component, { props, attachTo: document.body }))
		expect(missing).toEqual([])
		// A selector that stops matching would otherwise pass silently; only the sprite sheet is inert.
		expect(seen > 0 || name === "SpriteSheet").toBe(true)
	})

	it("the orchestrators own no bare controls of their own", () => {
		const here = dirname(fileURLToPath(import.meta.url))
		const sources = [join(here, "SendWizard.vue"), join(here, "..", "..", "views", "SendView.vue")]
		for (const file of sources) {
			const template = readFileSync(file, "utf8").split("<template>")[1] ?? ""
			for (const tag of template.matchAll(/<(button|input|select|textarea|a)\b([^>]*)>/g)) {
				expect(`${file}: ${tag[0]}`).toContain("data-testid")
			}
		}
	})

	it("covers every component in this directory", () => {
		const files = readdirSync(dirname(fileURLToPath(import.meta.url)))
			.filter((f) => f.endsWith(".vue") && f !== "SendWizard.vue")
			.map((f) => f.replace(".vue", ""))
		expect(files.sort()).toEqual([...new Set(CASES.map(([n]) => n.split(" ")[0]))].sort())
	})
})
