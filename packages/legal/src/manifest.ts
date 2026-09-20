export type LegalDocument = "terms" | "privacy"

export interface LegalVersion {
	/** `major.minor` or `major.minor.patch`. A material version always bumps minor or major. */
	readonly version: string
	/** The effective date exactly as the document prints it, or `null` while it is still a placeholder. */
	readonly effective: string | null
	/** Material versions require re-acceptance; the rest take effect on publication. */
	readonly material: boolean
	/** What a user who accepted the previous version needs to know. Hand-written, never derived. */
	readonly changes: readonly string[]
}

/** Oldest first. The last entry of each list is what `legal/<doc>.md` currently says. */
export const LEGAL_MANIFEST: Readonly<Record<LegalDocument, readonly LegalVersion[]>> = {
	terms: [{ version: "1.0", effective: null, material: true, changes: ["First published version."] }],
	privacy: [{ version: "1.0", effective: null, material: true, changes: ["First published version."] }],
}

export interface RiskPoint {
	readonly lead: string
	readonly body: string
}

export const RISK_POINTS: readonly RiskPoint[] = [
	{ lead: "You hold the keys.", body: "Nobody else has them: not the developer, not a server, not anyone." },
	{
		lead: "Lose what protects your wallet and your money is gone.",
		body: "Permanently. There is no reset and no support ticket. A passkey wallet has no recovery phrase to fall back on.",
	},
	{ lead: "Sent is sent.", body: "A transaction cannot be cancelled, reversed or refunded by anyone." },
	{ lead: "Nulo has not been audited, and Aztec is young.", body: "Use what you can afford to lose entirely." },
]

/** The control labels Terms § 3 names verbatim; a test pins them against the document. */
export const CONSENT_LABEL = "I agree to the Terms of Use"
export const CONTINUE_LABEL = "Continue"

export const LEGAL_SITE_ORIGIN = "https://nulo.sh"
