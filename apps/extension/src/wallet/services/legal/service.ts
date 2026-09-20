import { ValidationError, TermsAcceptanceRequiredError } from "@nulo/extension-messaging/errors"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { LEGAL_ACCEPTANCE_KEY, acceptanceStatus, applyAcceptance, parseAcceptanceRecord } from "@nulo/legal"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { ServiceSpec } from "@/wallet/base"
import type { ILogger } from "@/wallet/logger"
import { Lock } from "@/wallet/utils"
import {
	LEGAL_ACCEPTANCE_SERVICE_NAME,
	type Events,
	type LegalAcceptanceRecord,
	type LegalAdmission,
	type LegalStatus,
	type LegalSurface,
	type Methods,
} from "./spec"

export * from "./spec"

/**
 * The only writer of the Terms-acceptance record, and the answer to "may this install broadcast?".
 *
 * The record lives in one device-local key: it survives a profile reset and is never part of a
 * backup. Nothing is cached — every question re-reads storage, so an acceptance made a moment ago in
 * another page is seen and there is no invalidation to get wrong. Every failure (unreadable storage,
 * a record that does not parse) answers "not accepted": that direction refuses a send and never
 * touches the session, so viewing and exporting are out of this service's reach by construction.
 */
export class LegalAcceptanceService extends Service<Methods, Events> implements ServiceSpec<Methods, Events>, LegalAdmission {
	protected readonly rpcMethods = defineRpcMethods<Methods>()("getStatus", "getRecord", "accept")
	public static name = LEGAL_ACCEPTANCE_SERVICE_NAME

	public readonly onAcceptanceChanged = new EventHandler<LegalStatus>()

	private readonly lock = new Lock()

	public constructor(
		logger: ILogger,
		private readonly browserApi: BrowserApi,
		private readonly now: () => number = Date.now,
	) {
		super(LEGAL_ACCEPTANCE_SERVICE_NAME, logger)
	}

	public async getStatus(): Promise<LegalStatus> {
		return acceptanceStatus(await this.readRaw())
	}

	public async getRecord(): Promise<LegalAcceptanceRecord | null> {
		return parseAcceptanceRecord(await this.readRaw())
	}

	/** Serialized read-modify-write; resolves only once the record is durably stored. */
	public async accept(surface: LegalSurface): Promise<LegalAcceptanceRecord> {
		if (surface !== "onboarding" && surface !== "popup") throw new ValidationError("Unknown acceptance surface")
		const record = await this.lock.withLock(async () => {
			const next = applyAcceptance(await this.readRaw(), surface, this.now())
			await this.browserApi.storage.local.set({ [LEGAL_ACCEPTANCE_KEY]: next })
			return next
		})
		const status = acceptanceStatus(record)
		this.logDebug("Terms acceptance recorded", { surface, status })
		this.onAcceptanceChanged.invoke(status)
		this.emit("onAcceptanceChanged", status)
		return record
	}

	public async assertCurrent(): Promise<void> {
		const status = await this.getStatus().catch((): LegalStatus => "missing")
		if (status === "current") return
		this.logDebug("Refused: Terms acceptance is not current", { status })
		throw new TermsAcceptanceRequiredError()
	}

	private async readRaw(): Promise<unknown> {
		const entries = await this.browserApi.storage.local.get(LEGAL_ACCEPTANCE_KEY)
		return entries[LEGAL_ACCEPTANCE_KEY]
	}
}
