import { formatBaseUnits } from "@/utils/amount"
import { FpcType } from "@/wallet/services/fpc/client"

/**
 * Aztec Fee Juice has a fixed 18-decimal scale; the wallet does not
 * read this from chain and the value is unlikely to change for the
 * lifetime of the network.
 */
export const FEE_JUICE_DECIMALS = 18

export interface FeeMethodOption {
	type: "fj" | "private_fpc" | "fpc"
	title: string
	subtitle: string
	disabled?: boolean
	/** When `disabled`, optional short copy rendered in the dropdown row
	 *  in place of the regular subtitle (e.g. "no balance"). The testid
	 *  is still derived from `subtitle`, so this is display-only. */
	disabledReason?: string
	fpc?: { id: string; type: FpcType; name?: string } | null
}

/** Fee Juice balances surfaced from `executionService.getGasBalances`.
 *  `privateFeeJuice` is null when the PrivateFPC isn't registered or the
 *  query errored — the dropdown treats null the same as "0". */
export interface GasBalances {
	publicFeeJuice: string
	privateFeeJuice: string | null
}

export function formatGasBalance(raw: string | null | undefined): string {
	// Truncated to 4 decimals — full 18-decimal precision drowned the row.
	return formatBaseUnits(raw ?? "0", FEE_JUICE_DECIMALS, { maxDecimals: 4 })
}

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

interface RegisteredFpc {
	id: string
	type: FpcType
	name?: string
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
 */
export function settingsForMethod(
	method: FeeMethodOption | undefined,
	priority: string,
	gasPublicFeeJuice: string,
	gasPrivateFeeJuice?: string | null,
): FeeSettings | undefined {
	switch (method?.type) {
		case "fj":
			if (gasPublicFeeJuice === "0") return undefined
			return buildSettings({ kind: "fj" }, priority) as FeeSettings
		case "private_fpc":
			if (!method.fpc) return undefined
			if (!gasPrivateFeeJuice || gasPrivateFeeJuice === "0") return undefined
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
 * "not available" hint so the user can't select a method whose
 * simulation would fail. `gasBalances` is optional so callers can keep
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
	const privateFpc = registeredFpcs.find((f) => f.type === FpcType.PrivateFpc)
	const publicFeeJuiceZero = gasBalances?.publicFeeJuice === "0"
	const privateFeeJuiceZero = gasBalances !== undefined && (gasBalances.privateFeeJuice === null || gasBalances.privateFeeJuice === "0")

	const fj: FeeMethodOption = { type: "fj", title: "Fee Juice", subtitle: "public" }
	if (publicFeeJuiceZero) {
		fj.disabled = true
		fj.disabledReason = "no balance"
	}

	const privateFj: FeeMethodOption = {
		type: "private_fpc",
		title: privateFpc?.name || "Private Fee Juice",
		subtitle: "private",
		fpc: privateFpc ?? null,
	}
	if (!privateFpc) {
		privateFj.disabled = true
		privateFj.disabledReason = "not available"
	} else if (privateFeeJuiceZero) {
		privateFj.disabled = true
		privateFj.disabledReason = "no balance"
	}

	const base: FeeMethodOption[] = [fj, privateFj]

	for (const fpc of registeredFpcs) {
		if (fpc.type === FpcType.PrivateFpc) {
			// already handled above
			continue
		}
		if (fpc.type === FpcType.DefaultSponsoredFpc) {
			// Hidden on networks with no funded sponsor (Alpha/mainnet) — see options.allowSponsored.
			if (!allowSponsored) continue
			base.push({ type: "fpc", title: fpc.name || "Sponsored FPC", subtitle: "sponsored", fpc })
		}
	}

	return base
}

/**
 * Destination of the "get fee juice" nudge — the tools site's fee-juice
 * bridge (Fuel). A single destination for every network for now; override
 * at build time with `VITE_FEE_JUICE_BRIDGE_URL`.
 */
export const FEE_JUICE_BRIDGE_URL: string = (import.meta.env.VITE_FEE_JUICE_BRIDGE_URL as string | undefined) ?? "https://tools.nulo.sh"
