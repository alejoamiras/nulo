import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { NoteStatus, type NoteDao } from "@aztec/stdlib/note"
import { canonicalSlotHex, type NoteFieldType, type NoteSchema } from "@nulo/aztec-runtime/pxe"
import type { ILogger } from "@/wallet/logger"
import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { NetworkService, networkInfoFrom, type Network } from "@/wallet/services/network/service"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { type Methods, type Note, type RawNote, NOTE_SERVICE_NAME } from "./spec"

export * from "./spec"

/**
 * Decode a single packed note field. UintNote/NFTNote shapes only need
 * one Fr per field at the current lockfile (`u128 = 1 Fr`); future
 * shapes that pack multiple Frs into one field will need work here.
 */
function decodeField(value: { toString: () => string }, type: NoteFieldType): string {
	const raw = value.toString()
	switch (type) {
		case "u128":
			return BigInt(raw).toString()
		case "field":
			return raw
		case "address":
			try {
				return AztecAddress.fromField({ toString: () => raw } as never).toString()
			} catch {
				return raw
			}
	}
}

export class NoteService extends Service<Methods> implements ServiceSpec<Methods> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()("getNotes", "getNotesRaw", "getBlockTimestamp")
	public static name = NOTE_SERVICE_NAME

	private pxeService: PxeServiceClient = null!
	private networkService: NetworkService = null!

	public constructor(logger: ILogger) {
		super(NOTE_SERVICE_NAME, logger)
	}

	protected async init(services: ServiceCollection) {
		this.pxeService = new PxeServiceClient(this.logger)
		this.networkService = services.get(NetworkService.name)
	}

	public async getNotes(networkId: string, account: string, contract?: string): Promise<Note[]> {
		const raws = await this.getNotesRaw(networkId, account, contract)
		// Project to popup-friendly shape: strip raw fields the popup
		// doesn't consume. Keeping the projection here means `getNotes`
		// and `getNotesRaw` always agree on parse + error handling.
		return raws.map(
			({ siloedNullifier: _sn, noteHash: _nh, l2BlockNumber: _bn, txIndexInBlock: _ti, noteIndexInTx: _ni, ...note }) => note,
		)
	}

	/**
	 * Chain-derived UTC seconds for an L2 block. Returns `undefined` when
	 * the node can't resolve it. Activity-feed consumers use this so their
	 * sort/render survives token remove + re-add (re-indexed records get
	 * the same chain timestamp; without this, they'd jump to `Date.now()`).
	 */
	public async getBlockTimestamp(networkId: string, blockNumber: number): Promise<number | undefined> {
		await this.ensureInitialized()
		try {
			const network = await this.networkService.getNetwork(networkId)
			return await this.pxeService.getBlockTimestamp(networkInfoFrom(network), blockNumber)
		} catch (error) {
			this.logWarn(`getBlockTimestamp failed for block ${blockNumber}: ${getErrorMessage(error)}`)
			return undefined
		}
	}

	public async getNotesRaw(networkId: string, account: string, contract?: string): Promise<RawNote[]> {
		await this.ensureInitialized()
		const network = await this.networkService.getNetwork(networkId)
		let notes: NoteDao[]
		try {
			notes = contract
				? await this.fetchContractNotes(network, account, AztecAddress.fromString(contract))
				: await this.fetchKnownContractsNotes(network, account)
		} catch (error) {
			this.logError("Failed to fetch incoming notes", getErrorMessage(error))
			throw new Error("PXE request failed")
		}

		// Resolve contract → classId once per unique address; needed to look
		// up the matching note schema. PXE caches contract instances, but
		// each call still crosses to offscreen — a per-batch cache cuts
		// round-trips when many notes share a contract.
		const classIdByContract = new Map<string, string | undefined>()
		const noteSchemas = await this.loadNoteSchemasSafe()

		// Parse each note in isolation so a single malformed note can't blank
		// out the entire page. Failed entries surface as a renderError card on
		// the UI instead of an unrecoverable list.
		const res: RawNote[] = []
		for (const note of notes) {
			try {
				const parsed = await this.parseNote(network, note, classIdByContract, noteSchemas)
				res.push({
					...parsed,
					siloedNullifier: this.safeSiloedNullifier(note),
					noteHash: this.safeNoteHash(note),
					l2BlockNumber: this.safeBlockNumber(note),
					txIndexInBlock: this.safeTxIndex(note),
					noteIndexInTx: this.safeNoteIndex(note),
				})
			} catch (error) {
				const message = getErrorMessage(error)
				this.logError("Failed to parse note", message)
				res.push({
					contract: this.safeContractAddress(note),
					storageSlot: this.safeStorageSlot(note),
					txHash: this.safeTxHash(note),
					rawContent: [],
					renderError: message,
					siloedNullifier: this.safeSiloedNullifier(note),
					noteHash: this.safeNoteHash(note),
					l2BlockNumber: this.safeBlockNumber(note),
					txIndexInBlock: this.safeTxIndex(note),
					noteIndexInTx: this.safeNoteIndex(note),
				})
			}
		}
		return res
	}

	/** Schema fetch is best-effort: a failed lookup just leaves notes with
	 *  raw rendering. We don't want a transient PXE blip blanking the list. */
	private async loadNoteSchemasSafe(): Promise<Record<string, Record<string, NoteSchema>>> {
		try {
			return await this.pxeService.getNoteSchemas()
		} catch (error) {
			this.logWarn("Failed to load note schemas; falling back to raw rendering", getErrorMessage(error))
			return {}
		}
	}

	private safeContractAddress(note: NoteDao): string {
		try {
			return note.contractAddress.toString()
		} catch {
			return ""
		}
	}

	private safeStorageSlot(note: NoteDao): string {
		try {
			return note.storageSlot.toString()
		} catch {
			return ""
		}
	}

	private safeTxHash(note: NoteDao): string {
		try {
			return note.txHash.toString()
		} catch {
			return ""
		}
	}

	private safeSiloedNullifier(note: NoteDao): string {
		try {
			return note.siloedNullifier.toString()
		} catch {
			return ""
		}
	}

	private safeNoteHash(note: NoteDao): string {
		try {
			return note.noteHash.toString()
		} catch {
			return ""
		}
	}

	private safeBlockNumber(note: NoteDao): number {
		try {
			return Number(note.l2BlockNumber)
		} catch {
			return 0
		}
	}

	private safeTxIndex(note: NoteDao): number {
		try {
			return Number(note.txIndexInBlock)
		} catch {
			return 0
		}
	}

	private safeNoteIndex(note: NoteDao): number {
		try {
			return Number(note.noteIndexInTx)
		} catch {
			return 0
		}
	}

	private async fetchKnownContractsNotes(network: Network, account: string): Promise<NoteDao[]> {
		const res = []
		const knownContracts = await this.pxeService.getContracts(networkInfoFrom(network))
		for (const contract of knownContracts.filter((x) => x.toBigInt() > 6n)) {
			res.push(...(await this.fetchContractNotes(network, account, contract)))
		}
		return res
	}

	private async fetchContractNotes(network: Network, account: string, contract: AztecAddress): Promise<NoteDao[]> {
		return await this.pxeService.getNotes(networkInfoFrom(network), {
			contractAddress: contract,
			status: NoteStatus.ACTIVE,
			scopes: [AztecAddress.fromString(account)],
		})
	}

	private async parseNote(
		network: Network,
		note: NoteDao,
		classIdByContract: Map<string, string | undefined>,
		noteSchemas: Record<string, Record<string, NoteSchema>>,
	): Promise<Note> {
		const contract = note.contractAddress.toString()
		const storageSlot = note.storageSlot.toString()
		const txHash = note.txHash.toString()
		const rawContent = note.note.items.map((x) => x.toString())

		const schema = await this.lookupSchema(network, note, classIdByContract, noteSchemas)
		const content = this.buildContent(note, schema)

		return {
			contract,
			storageSlot,
			txHash,
			rawContent,
			...(schema ? { type: schema.noteName, contractName: schema.contractName } : {}),
			...(content ? { content } : {}),
		}
	}

	/** Look up `(classId, slotHex)` in the static schema map. Returns
	 *  `undefined` for any unknown class or slot — caller falls back to
	 *  raw items rendering. */
	private async lookupSchema(
		network: Network,
		note: NoteDao,
		classIdByContract: Map<string, string | undefined>,
		noteSchemas: Record<string, Record<string, NoteSchema>>,
	): Promise<NoteSchema | undefined> {
		const contract = note.contractAddress.toString()
		if (!classIdByContract.has(contract)) {
			classIdByContract.set(contract, await this.fetchClassId(network, note.contractAddress))
		}
		const classId = classIdByContract.get(contract)
		if (!classId) return undefined
		const slotHex = canonicalSlotHex(note.storageSlot.toString())
		return noteSchemas[classId]?.[slotHex]
	}

	private async fetchClassId(network: Network, address: AztecAddress): Promise<string | undefined> {
		try {
			const instance = await this.pxeService.getContractInstance(networkInfoFrom(network), address)
			return instance?.currentContractClassId.toString()
		} catch (error) {
			this.logWarn("Failed to load contract instance for note schema lookup", address.toString(), getErrorMessage(error))
			return undefined
		}
	}

	/** Build the named-fields `content` map. Always includes `owner` and
	 *  `randomness` (side-channel from NoteDao). Schema-decoded fields
	 *  fill in front; absence of a schema returns `undefined` (caller
	 *  renders raw items). */
	private buildContent(note: NoteDao, schema: NoteSchema | undefined): Record<string, string> | undefined {
		if (!schema) return undefined
		const items = note.note.items
		const out: Record<string, string> = {}
		for (let i = 0; i < schema.fields.length; i++) {
			const field = schema.fields[i]
			const item = items[i]
			if (!item) continue
			out[field.name] = decodeField(item, field.type)
		}
		try {
			out.owner = note.owner.toString()
		} catch {
			// owner missing on malformed daos — skip
		}
		try {
			out.randomness = note.randomness.toString()
		} catch {
			// randomness missing — skip
		}
		return out
	}
}
