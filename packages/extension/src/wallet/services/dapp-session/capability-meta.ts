/**
 * UI metadata for the capability types the wallet recognises. Single source
 * of truth consumed by the capabilities popup (L6), the connected-apps L4
 * settings module, and the L5 connected-apps pages. Lives under
 * `wallet/services/dapp-session/` so every consumer can import it without
 * tripping the biome layer-import rules (popup-side caller can't reach into
 * L6 from L4).
 *
 * This module is pure: no Vue, no `chrome.*`, no service-client / managers
 * imports. Keeping it pure is a code-review responsibility — the biome
 * `noRestrictedGlobals` ban on `chrome.*` is scoped to `wallet-core`, not
 * here. The contact-book lookup that some renderers need lives in the flat
 * `src/components/ScopeAddress.vue` instead of in this file.
 */

export type CapabilityRisk = "low" | "medium" | "high"

export interface CapabilityInfo {
	/** Long label rendered as the card head and the settings detail-page header. */
	label: string
	/** Short label rendered in the per-session row on the connected-apps list. */
	shortLabel: string
	/** One-line description rendered beneath the head. */
	description: string
	risk: CapabilityRisk
}

/**
 * Each entry pairs the wire-level `Capability["type"]` discriminator with
 * its wallet-controlled UI metadata. The strings here are the only ones
 * the user sees for a given capability — keep them in sync with the
 * `Capability` union in `@nulo/wallet-bridge`.
 */
export const CAPABILITY_LABELS: Record<string, CapabilityInfo> = {
	accounts: {
		label: "Account access",
		shortLabel: "Accounts",
		description: "Read your account addresses and register tokens. May also request auth witnesses for shared accounts.",
		risk: "medium",
	},
	contracts: {
		label: "Contract registration",
		shortLabel: "Contracts",
		description: "Register and read contract metadata on this network.",
		risk: "low",
	},
	contractClasses: {
		label: "Contract class lookup",
		shortLabel: "Classes",
		description: "Read contract class metadata on this network.",
		risk: "low",
	},
	simulation: {
		label: "Transaction simulation",
		shortLabel: "Simulation",
		description: "Run simulations locally. Nothing is sent to the network.",
		risk: "medium",
	},
	transaction: {
		// Honest reframing: the capability gates what the dApp may REQUEST. Each
		// send still opens an execute popup (dapp-interaction service.ts forces
		// confirmation for send_transaction / aztec_sendTx under default policy).
		label: "Send transactions",
		shortLabel: "Transactions",
		description: "Request transactions within the scope below. Each transaction still requires your approval.",
		risk: "high",
	},
	data: {
		label: "Private data",
		shortLabel: "Private data",
		description: "Read your address book and private events. May also register senders for event decryption.",
		risk: "high",
	},
}

/**
 * Look up the wallet's UI metadata for a capability type. Unknown types
 * fall back to a generic shape — but consumers that care about the
 * "this is wire-controlled, treat with suspicion" property should use
 * `isKnownCapability(type)` to discriminate. The capabilities popup uses
 * the fallback's `risk: "high"` to bias unknown grants toward caution.
 */
export function getCapabilityInfo(type: string): CapabilityInfo {
	return (
		CAPABILITY_LABELS[type] ?? {
			label: type,
			shortLabel: type,
			description: `Capability: ${type}`,
			risk: "high",
		}
	)
}

/**
 * True iff `type` matches a wallet-recognised capability discriminator.
 * The capabilities popup uses this to decide whether to default the
 * card's `selected` state to `false` — unknown caps require a deliberate
 * click before they can be persisted into the session grant list.
 */
export function isKnownCapability(type: string): boolean {
	return Object.hasOwn(CAPABILITY_LABELS, type)
}

/**
 * Defensive renderer-side sanitizer for any string that originated on the
 * wire (capability types, scope `contract`/`function` strings, etc.) or
 * in user-controlled local storage (contact-book names — the user typed
 * them but could have pasted a Unicode-attack payload).
 *
 * What `stripWireControl` strips:
 *
 *   1. Every Unicode "format" codepoint (`\p{Cf}`). This includes:
 *      - Bidi overrides (LRE/RLE/PDF/LRO/RLO + LRI/RLI/FSI/PDI).
 *      - Zero-width joiners and non-joiners (ZWSP / ZWNJ / ZWJ).
 *      - Left/right marks (LRM / RLM).
 *      - Soft hyphen (U+00AD).
 *      - Byte-order mark (U+FEFF).
 *      - Tag characters (U+E0000-U+E007F).
 *      Without this, a hostile dApp could embed an RLO and visually
 *      flip the displayed text direction, or a zero-width joiner to
 *      glue two different glyphs together. Codex post-impl §1 caught
 *      that the original narrower regex missed ZWSP / soft-hyphen /
 *      the full \p{Cf} range.
 *   2. Variation selectors (U+FE00..U+FE0F, U+E0100..U+E01EF). Single
 *      codepoints that change the visual rendering of the preceding
 *      character. Not in \p{Cf}; categorised \p{Mn}, so we list them
 *      explicitly.
 *   3. The C0 / DEL / C1 control codepoints (U+0000-U+001F, U+007F,
 *      U+0080-U+009F).
 *
 * `stripWireControl` does the strip step only — used for clipboard
 * payloads where length-clamping would be worse UX (a user verifies a
 * trimmed display and copies the full value; we don't want to silently
 * truncate the clipboard, but we also don't want the clipboard to
 * carry invisible-injected bytes either).
 *
 * `sanitizeWireString` runs the strip step AND a `maxLen`-codepoint
 * clamp with an ellipsis. Soft cap chosen per-callsite: 64 for function
 * selectors, 128 for addresses / class IDs, 32 for the unknown-
 * capability `type` and contact-name annotations.
 *
 * What is NOT stripped: legitimate combining marks (\p{Mn} minus the
 * variation-selector ranges) and unusual-but-printable spaces (NBSP,
 * etc.). Stripping those would over-mangle user-typed contact names
 * with diacritics. Combining-mark attacks (zalgo text) are out of
 * scope here; we'd want a UTS39-class normalization step for that.
 *
 * Vue template interpolation already HTML-escapes; we don't try to
 * handle angle brackets etc. here.
 */
// Ranges written as Unicode escapes so the source stays pure ASCII and
// git can diff this file as text. The `u` flag enables \p{...} and the
// supplementary-plane range U+E0100..U+E01EF below.
// biome-ignore lint/suspicious/noControlCharactersInRegex: defensive sanitizer; the regex MUST match control chars to strip them.
const SANITIZER_STRIP = /\p{Cf}|[\u{FE00}-\u{FE0F}]|[\u{E0100}-\u{E01EF}]|[\u0000-\u001F\u007F-\u009F]/gu

export function stripWireControl(input: string): string {
	return input.replace(SANITIZER_STRIP, "")
}

export function sanitizeWireString(input: string, maxLen: number): string {
	const stripped = stripWireControl(input)
	const codepoints = Array.from(stripped)
	if (codepoints.length <= maxLen) return stripped
	return `${codepoints.slice(0, maxLen).join("")}…`
}

/**
 * Look up the display-safe metadata for a capability type. For known
 * types, returns the canonical labels from `CAPABILITY_LABELS`. For
 * unknown types, returns CONSTANT user-safe strings ("Unknown
 * permission" / "Unknown" / the long warning) so the dApp-controlled
 * `cap.type` never lands as a visible label on any surface. The popup
 * card head, settings detail page, settings list summary, and grants
 * list all read through this helper — codex post-impl §5 caught that
 * direct `getCapabilityInfo(type).label` on the settings surfaces
 * still leaked the raw wire string.
 */
export function getSafeDisplay(type: string): {
	label: string
	shortLabel: string
	description: string
	isUnknown: boolean
} {
	if (isKnownCapability(type)) {
		const info = CAPABILITY_LABELS[type]
		return {
			label: info.label,
			shortLabel: info.shortLabel,
			description: info.description,
			isUnknown: false,
		}
	}
	return {
		label: "Unknown permission",
		shortLabel: "Unknown",
		description: "This wallet doesn't recognize this permission. Reject if you don't know what it does.",
		isUnknown: true,
	}
}
