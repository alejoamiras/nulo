import { FpcType } from "@/wallet/services/fpc/client"
import { feeJuicePricingFromUsd, feeToUsd, formatGasBalance } from "@/utils/fee-estimation"

export { formatGasBalance }

export interface FeeDisplay {
	amount: string
	/** Null without a live Fee Juice quote. */
	usd: string | null
}

export function feeDisplay(
	estimate: { maxFee: string | bigint; maxFeeFormatted: string } | null | undefined,
	usdPerFeeJuice: number | undefined,
): FeeDisplay | null {
	if (!estimate) return null
	return {
		amount: estimate.maxFeeFormatted,
		usd: feeToUsd(BigInt(estimate.maxFee), feeJuicePricingFromUsd(usdPerFeeJuice)),
	}
}

/** The fee card's "You pay" value as one string, in the card's words. */
export function feeLine(display: FeeDisplay | null): string | undefined {
	if (!display) return undefined
	return display.usd ? `~${display.amount} FJ (${display.usd})` : `~${display.amount} FJ`
}

export interface FeeMethodOption {
	type: "fj" | "private_fpc" | "fpc"
	title: string
	subtitle: string
	disabled?: boolean
	/** When `disabled`, optional short copy rendered in the dropdown row
	 *  in place of `spend` (e.g. "no balance"). The testid is still derived
	 *  from `subtitle`, so this is display-only. */
	disabledReason?: string
	/** What the method can spend, for the menu's right column: a balance, "— FJ" while
	 *  balances are unknown, "free" for Nulo's own sponsor, "—" for one added by hand. */
	spend?: string
	fpc?: { id: string; type: FpcType; name?: string; isProtocol?: boolean } | null
}

/** Fee Juice balances surfaced from `executionService.getGasBalances` —
 *  the CANONICAL wire type (a hand-written copy lived here before and
 *  drifted only by luck). `null` on either leg = UNKNOWN (read failed):
 *  fail closed for gating, render as an em dash for display. */
export type { GasBalances } from "@/wallet/services/execution/models"
import type { GasBalances } from "@/wallet/services/execution/models"

export interface BuildSettingsInput {
	paymentMethod: { kind: string; fpcId?: string } | undefined
	priority?: string
}

export function buildSettings(
	paymentMethod: BuildSettingsInput["paymentMethod"],
	priority?: string,
): { paymentMethod: NonNullable<BuildSettingsInput["paymentMethod"]>; priorityLevel?: string } | undefined {
	if (!paymentMethod) return undefined
	const result: { paymentMethod: NonNullable<BuildSettingsInput["paymentMethod"]>; priorityLevel?: string } = {
		paymentMethod,
	}
	if (priority && priority !== "normal") {
		result.priorityLevel = priority
	}
	return result
}

export interface RegisteredFpc {
	id: string
	type: FpcType
	name?: string
	isProtocol?: boolean
}

/**
 * Build the dropdown's method list from the registered FPCs. The order
 * is: native Fee Juice → PrivateFPC slot (always present even when no
 * PrivateFPC is registered, as a placeholder) → registered Sponsored
 * FPCs in their stored order.
 */
export interface FeeSettings {
	paymentMethod: { kind: string; fpcId?: string }
	priorityLevel?: string
}

/**
 * Compute the wallet's fee settings from the user's UI selection. Returns
 * `undefined` when the selection cannot produce a usable settings object
 * (e.g. zero Fee Juice balance, no PrivateFPC registered, zero private
 * Fee Juice balance). The SFC clears `settings` in those cases so
 * downstream simulators don't fire against a known-broken setup.
 *
 * `balances === undefined` means the balance read failed or timed out (a
 * silent retry is pending). Self-paid methods (fj / private_fpc) fail CLOSED
 * on unknown: fee estimation simulates with `skipFeeEnforcement`, so it
 * would NOT catch an actually-zero balance — deriving settings from a
 * balance we never saw could walk the user into proving a transaction the
 * sequencer must drop. Sponsored FPCs need no user balance and stay usable,
 * which is what keeps the card operable while balances are unavailable.
 * Unknown is still NOT a confirmed zero for messaging: the bridge nudge
 * keys off a known "0" only (see the SFC's `feeJuiceMissing`).
 */
export function settingsForMethod(
	method: FeeMethodOption | undefined,
	priority: string,
	balances: GasBalances | undefined,
): FeeSettings | undefined {
	switch (method?.type) {
		case "fj":
			// null (unknown, per-leg) fails closed exactly like the whole-object
			// unknown: pre-wire-fix this held only because failures fabricated
			// "0" — the explicit null guard is what keeps it true now.
			if (!balances || balances.publicFeeJuice === null || balances.publicFeeJuice === "0") return undefined
			return buildSettings({ kind: "fj" }, priority) as FeeSettings
		case "private_fpc":
			if (!method.fpc) return undefined
			if (!balances || !balances.privateFeeJuice || balances.privateFeeJuice === "0") return undefined
			return buildSettings({ kind: "fpc", fpcId: method.fpc.id }, priority) as FeeSettings
		case "fpc": {
			if (!method.fpc) return undefined
			return buildSettings({ kind: "fpc", fpcId: method.fpc.id }, priority) as FeeSettings
		}
		default:
			return undefined
	}
}

/**
 * Resolve a previously persisted selection against the freshly-built
 * `methods` list. Never trust the stored snapshot for `fpc.name` — that
 * can drift between save and reopen. Returns `undefined` when the saved
 * record can't be resolved (e.g. an FPC that has been deleted, or a
 * `private_fpc` save when no PrivateFpc is now registered), letting the
 * caller fall through to its auto-select path.
 *
 * Defensive against legacy storage shapes — the saved record may carry
 * fields from the pre-FPC-cleanup era (`balance`, `inPublic`, `asset`);
 * we only read `type` / `fpc.id` from it.
 */
export function resolveSavedSelection(
	saved: { type?: string; fpc?: { id?: string } | null } | undefined,
	freshMethods: FeeMethodOption[],
): FeeMethodOption | undefined {
	if (!saved?.type) return undefined
	switch (saved.type) {
		case "fj": {
			const m = freshMethods.find((x) => x.type === "fj")
			return m && !m.disabled ? m : undefined
		}
		case "private_fpc": {
			const m = freshMethods.find((x) => x.type === "private_fpc")
			return m && !m.disabled ? m : undefined
		}
		case "fpc": {
			const fpcId = saved.fpc?.id
			if (!fpcId) return undefined
			const match = freshMethods.find((m) => m.type === "fpc" && m.fpc?.id === fpcId)
			return match ?? undefined
		}
		default:
			return undefined
	}
}

/**
 * Build the dropdown's method list. When `gasBalances` is provided,
 * `fj` and `private_fpc` get marked `disabled` with a "no balance" /
 * "couldn't check balance" / "not available" hint so the user can't
 * select a method whose simulation would fail. `gasBalances` is optional so callers can keep
 * building the list before balances arrive (everything stays enabled
 * during load; balances flip the disabled state once fetched).
 *
 * `options.allowSponsored` (default true) gates whether Sponsored FPC
 * rows are offered — set false on networks that have no funded sponsor
 * (Alpha/mainnet), where offering it would be a trap that fails at send.
 */
export function buildFeeMethods(
	registeredFpcs: RegisteredFpc[],
	gasBalances?: GasBalances,
	options?: { allowSponsored?: boolean },
): FeeMethodOption[] {
	const allowSponsored = options?.allowSponsored ?? true
	// Only the protocol-derived PrivateFPC may pay privately; a same-typed row at any other
	// address (a restored or hand-added one) is never offered, even when it sorts first.
	const privateFpc = registeredFpcs.find((f) => f.type === FpcType.PrivateFpc && f.isProtocol === true)
	const base: FeeMethodOption[] = [feeJuiceOption(gasBalances), privateFeeJuiceOption(privateFpc, gasBalances)]

	// Hidden on networks with no funded sponsor (Alpha/mainnet) — see options.allowSponsored.
	if (!allowSponsored) return base
	// Nulo's sponsor lists first; hand-added ones keep storage order, which is not the order they
	// were added in.
	const sponsors = registeredFpcs
		.filter((f) => f.type === FpcType.DefaultSponsoredFpc)
		.sort((a, b) => Number(b.isProtocol === true) - Number(a.isProtocol === true))
	for (const fpc of sponsors) {
		// Only the sponsor Nulo ships is promised free: a contract added by hand can make its
		// sponsorship conditional on a call from the account and then spend a token
		// authorization the account granted it earlier.
		const spend = fpc.isProtocol === true ? "free" : "—"
		base.push({ type: "fpc", title: fpc.name || "Sponsored", subtitle: "sponsored", spend, fpc })
	}

	return base
}

/** `undefined` (balances not known yet) and `null` (the leg's read failed) are never printed as a
 *  zero, which is what `formatGasBalance` makes of them. */
function spendOf(balance: string | null | undefined): string {
	return typeof balance === "string" ? `${formatGasBalance(balance)} FJ` : "— FJ"
}

function feeJuiceOption(gasBalances?: GasBalances): FeeMethodOption {
	const publicFeeJuiceZero = gasBalances?.publicFeeJuice === "0"
	// Unknown (null) disables too — but with an honest reason, never "no balance".
	const publicFeeJuiceUnknown = gasBalances !== undefined && gasBalances.publicFeeJuice === null

	const fj: FeeMethodOption = {
		type: "fj",
		title: "Public Fee Juice",
		subtitle: "public",
		spend: spendOf(gasBalances?.publicFeeJuice),
	}
	if (publicFeeJuiceZero) {
		fj.disabled = true
		fj.disabledReason = "no balance"
	} else if (publicFeeJuiceUnknown) {
		fj.disabled = true
		fj.disabledReason = "couldn't check balance"
	}
	return fj
}

function privateFeeJuiceOption(privateFpc: RegisteredFpc | undefined, gasBalances?: GasBalances): FeeMethodOption {
	const privateFeeJuiceZero = gasBalances?.privateFeeJuice === "0"
	// Unknown (null) disables too — but with an honest reason, never "no balance".
	const privateFeeJuiceUnknown = gasBalances !== undefined && gasBalances.privateFeeJuice === null

	const privateFj: FeeMethodOption = {
		type: "private_fpc",
		title: privateFpc?.name || "Private Fee Juice",
		subtitle: "private",
		spend: spendOf(gasBalances?.privateFeeJuice),
		fpc: privateFpc ?? null,
	}
	if (!privateFpc) {
		privateFj.disabled = true
		privateFj.disabledReason = "not available"
	} else if (privateFeeJuiceZero) {
		privateFj.disabled = true
		privateFj.disabledReason = "no balance"
	} else if (privateFeeJuiceUnknown) {
		privateFj.disabled = true
		privateFj.disabledReason = "couldn't check balance"
	}
	return privateFj
}

/**
 * Destination of the "get fee juice" nudge — the tools site's fee-juice
 * bridge (Fuel). A single destination for every network for now; override
 * at build time with `VITE_FEE_JUICE_BRIDGE_URL`.
 */
export const FEE_JUICE_BRIDGE_URL: string = (import.meta.env.VITE_FEE_JUICE_BRIDGE_URL as string | undefined) ?? "https://tools.nulo.sh"
