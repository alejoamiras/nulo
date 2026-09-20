import type { LegalAcceptanceRecord, LegalStatus, LegalSurface } from "@nulo/legal"

export const LEGAL_ACCEPTANCE_SERVICE_NAME = "legal-acceptance"

export type { LegalAcceptanceRecord, LegalStatus, LegalSurface }

export type Methods = {
	getStatus(): LegalStatus
	getRecord(): LegalAcceptanceRecord | null
	accept(surface: LegalSurface): LegalAcceptanceRecord
}

export type Events = {
	onAcceptanceChanged: LegalStatus
}

/** What the broadcast wall and the dApp ingress need, and nothing more. */
export interface LegalAdmission {
	/** Rejects with `TermsAcceptanceRequiredError` unless the Terms acceptance is current. */
	assertCurrent(): Promise<void>
}
