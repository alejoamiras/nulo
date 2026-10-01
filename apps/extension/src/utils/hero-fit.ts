/** Utils */
import { balanceFormatted, formatBaseUnits } from "@/utils/amount"
import { formatUsdMicro, usdMicroToCents } from "@/wallet/services/price/convert"

/** Below this size a shorter form reads better than smaller type. */
export const HERO_MIN_SCALE = 0.6

/** Which of the hero's forms to draw, longest first, and the fraction of the full type size. */
export interface HeroFit {
	readonly index: number
	readonly scale: number
}

export const FULL_SIZE: HeroFit = { index: 0, scale: 1 }

/** A form's drawn width in px at a scale. */
export type HeroWidthAt = (index: number, scale: number) => number

/** The largest scale, in hundredths from `floor` to 100, at which form `index` fits `room`. */
function largestFit(widthAt: HeroWidthAt, index: number, room: number, floor: number): number | undefined {
	for (let hundredths = Math.min(100, Math.floor((100 * room) / widthAt(index, 1))); hundredths >= floor; hundredths--) {
		// Glyph advances need not scale linearly, so the estimate is checked at the size it picks.
		if (widthAt(index, hundredths / 100) <= room) return hundredths
	}
	return undefined
}

/**
 * The first of `count` forms, longest first, that fits `room` at `HERO_MIN_SCALE` or more, at the
 * largest hundredth that fits. When none does, the shortest form takes whatever scale fits. A
 * `room` of 0 is a line not laid out yet.
 */
export function fitHero(count: number, widthAt: HeroWidthAt, room: number): HeroFit {
	if (!(room > 0) || count < 1) return FULL_SIZE
	const floor = Math.round(HERO_MIN_SCALE * 100)
	for (let index = 0; index < count - 1; index++) {
		const hundredths = largestFit(widthAt, index, room, floor)
		if (hundredths !== undefined) return { index, scale: hundredths / 100 }
	}
	return { index: count - 1, scale: (largestFit(widthAt, count - 1, room, 1) ?? 1) / 100 }
}

/** A held fit may shrink or change form, never grow: proportional digits change a counting
 *  figure's width every frame, and a scale that followed them would pulse. */
export function holdHeroFit(previous: HeroFit, fresh: HeroFit): HeroFit {
	return fresh.index === previous.index && fresh.scale > previous.scale ? previous : fresh
}

/**
 * The token hero's forms: the amount at `length` characters (or in full), then the compact rule
 * at each shorter length. A whole part under a thousand stops at three characters, where a
 * shorter cut would read "0K" or "0".
 */
export function tokenHeroCandidates(units: bigint, decimals: number, length?: number): string[] {
	const full = formatBaseUnits(units, decimals)
	const shortest = units / 10n ** BigInt(decimals) >= 1000n ? 1 : 3
	const forms = [length ? balanceFormatted(units, decimals, length, { compact: true }).value : full]
	for (let cut = (length ?? full.length) - 1; cut >= shortest; cut--) {
		forms.push(balanceFormatted(units, decimals, cut, { compact: true }).value)
	}
	return [...new Set(forms)]
}

/**
 * The fiat hero's forms: the figure with its cents, the same figure's whole dollars, then those
 * dollars in K/M/B/T, truncated. The dollars come from the rounded cents, so no shorter form
 * contradicts the figure it replaces.
 */
export function fiatHeroCandidates(micro: bigint): string[] {
	const shown = formatUsdMicro(micro)
	const dollars = usdMicroToCents(micro) / 100n
	if (dollars < 1n) return [shown]
	const whole = formatBaseUnits(dollars, 0)
	const forms = [shown, `$${whole}`]
	for (let cut = dollars >= 1000n ? whole.length - 1 : 0; cut >= 1; cut--) {
		forms.push(`$${balanceFormatted(dollars, 0, cut, { compact: true }).value}`)
	}
	return [...new Set(forms)]
}
