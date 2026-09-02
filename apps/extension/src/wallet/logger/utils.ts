import { type ILogger, type Log, LogLevel } from "."
import { scrubUrls } from "@/utils/scrub-urls"

export class DummyLogger implements ILogger {
	log() {}
}

export class CircularBuffer<T> {
	protected buffer: T[]
	protected position = 0
	protected full = false

	public constructor(protected capacity: number) {
		this.buffer = new Array<T>(capacity)
	}

	public items(): T[] {
		if (this.full) {
			return [...this.buffer.slice(this.position), ...this.buffer.slice(0, this.position)]
		}
		return this.buffer.slice(0, this.position)
	}

	public add(item: T): void {
		this.buffer[this.position] = item
		this.position = (this.position + 1) % this.capacity
		if (this.position === 0) {
			this.full = true
		}
	}

	public resize(newCapacity: number): void {
		if (newCapacity === this.capacity) {
			return
		}
		const items = this.items().slice(-newCapacity)
		this.clear(newCapacity)
		for (const item of items) {
			this.add(item)
		}
	}

	public clear(newCapacity?: number): void {
		this.capacity = newCapacity ?? this.capacity
		this.buffer = new Array<T>(this.capacity)
		this.position = 0
		this.full = false
	}
}

export class CircularBufferIterable<T extends { id: number }> extends CircularBuffer<T> {
	public get(count: number, fromId: number): T[] {
		const res: T[] = []
		const size = this.full ? this.capacity : this.position
		const start = this.full ? this.position : 0
		for (let i = 0, j = start; i < size; i++, j = (j + 1) % this.capacity) {
			if (this.buffer[j].id > fromId) {
				res.push(this.buffer[j])
				if (res.length === count) {
					break
				}
			}
		}
		return res
	}
}

const MAX_LOG_DATA_DEPTH = 6
const MAX_ERROR_MESSAGE_CHARS = 200

/**
 * Keys whose value is a secret, or the ciphertext of one, and is never diagnostically useful.
 *
 * Both casings appear: the in-memory/RPC layer is camelCase, exported backup JSON is kebab-case,
 * and a backup blob walked by a logger would otherwise slip through under the other spelling.
 *
 * Deliberately ABSENT: the bare key `secret`. It names ciphertext on `Profile` and a plaintext
 * `Fr` on `ActiveSession`, and both of those are handled by shape below — blanket-banning the word
 * would blind ordinary diagnostics for no gain. Same reasoning for `token`, which in this wallet
 * almost always means a token contract.
 */
export const REDACTED_KEYS: ReadonlySet<string> = new Set([
	// Aztec proof material.
	"acir",
	"authWitnesses",
	"partialWitness",
	"publicInputs",
	"vk",
	// Wallet key material and its wrappers.
	"masterKey",
	"master-key",
	"importedKeysDek",
	"imported-keys-dek",
	"dek",
	"dekSealed",
	"imported-keys-dek-sealed",
	"encryptedSigningKey",
	"signingKey",
	"privateKey",
	"wrappedSecret",
	"envelopeMac",
	"bearer",
	// Seed / recovery material.
	"entropy",
	"mnemonic",
	"seedPhrase",
	// Authentication material.
	"password",
	"passhash",
	"passphrase",
	"prf",
	// Aztec-side secrets that reach us through the bridge/runtime types.
	"claimSecret",
	"claim-secret",
])

/**
 * Suffix rule for the `*SecretKey` family.
 *
 * Covers `secretKey` (a plaintext `Fr` on the register-contract operation, which the generic walk
 * would otherwise descend into and print as a raw bigint) and Aztec's
 * `masterNullifierSecretKey` / `masterIncomingViewingSecretKey` / … set, without enumerating
 * every upstream spelling. No benign field in this codebase ends in `SecretKey`.
 */
export const SECRET_KEY_SUFFIX = /secretkey$/i

/**
 * Keys holding an endpoint URL. Commercial RPC providers routinely embed the API key in the path
 * or query, so these are reduced to their origin rather than blanked — which endpoint failed is
 * the whole diagnostic value, and the origin carries it.
 */
export const URL_KEYS: ReadonlySet<string> = new Set(["rpcUrl", "submittedEndpointUrl", "endpointUrl"])

function toOrigin(value: unknown): unknown {
	if (typeof value !== "string") return `[${typeof value}]`
	try {
		return new URL(value).origin
	} catch {
		return "[url]"
	}
}

/**
 * Error-like brands whose `name`/`message` are non-enumerable, so the generic walk yields `{}`.
 *
 * `DOMException` carries a DISTINCT object tag rather than `[object Error]`, so a single-tag check
 * missed it. WebAuthn failures arrive as one and are logged verbatim during passkey ceremonies and
 * backup export, so omitting it silently discarded exactly the diagnosis those paths exist to
 * produce. Every other error brand reachable here — including `WalletError`, Aztec simulation
 * errors and `AggregateError` — reports `[object Error]` and is already covered.
 */
const ERROR_TAGS: ReadonlySet<string> = new Set(["[object Error]", "[object DOMException]"])

/**
 * Loggable projection of an error.
 *
 * `Object.entries(new Error("x"))` is `[]` — name/message/stack are non-enumerable — so the
 * generic walk below silently reduced every logged error to `{}`, losing the diagnosis entirely.
 * Restoring it naively would swap one bug for a worse one: messages routinely interpolate the
 * values that caused the failure, and stacks carry file paths, so the fix caps and scrubs the
 * message and drops the stack.
 *
 * Scrubbing covers credential-bearing URLs only. A generic "long high-entropy run" heuristic was
 * tried and removed: at any threshold low enough to catch a key it also redacted every Aztec
 * address, tx hash and class id — the identifiers that make an error message worth reading — while
 * still missing shorter or dotted secrets. Length is not an entropy test. Keeping a secret out of
 * a message is the CALL SITE's job; this only bounds and de-credentials what arrives.
 */
function projectError(error: Error): Record<string, unknown> {
	const scrubbed = scrubUrls(error.message ?? "")
	return {
		name: error.name,
		message: scrubbed.length > MAX_ERROR_MESSAGE_CHARS ? `${scrubbed.slice(0, MAX_ERROR_MESSAGE_CHARS - 1)}…` : scrubbed,
	}
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: accepted at score 45 — the ordered recursive shape walker IS the redaction policy; extraction would scatter security precedence
export const trim = (value: unknown, depth: number = 0): unknown => {
	if (Array.isArray(value)) {
		if (depth === MAX_LOG_DATA_DEPTH) {
			return "[Array]"
		}
		return value.map((x) => trim(x, depth + 1))
	}
	if (value && typeof value === "object") {
		if (depth === MAX_LOG_DATA_DEPTH) {
			return "[Object]"
		}

		// Non-plain objects first — the generic walk below mishandles every one of them. Typed
		// arrays are the dangerous case: `Object.entries` yields one entry PER BYTE, so a raw
		// 32-byte key would be EXPANDED into a 32-field object rather than hidden.
		if (ERROR_TAGS.has(Object.prototype.toString.call(value))) return projectError(value as Error)
		if (ArrayBuffer.isView(value)) return `[${value.constructor.name}(${value.byteLength})]`
		if (value instanceof ArrayBuffer) return `[ArrayBuffer(${value.byteLength})]`
		if (value instanceof Map) return `[Map(${value.size})]`
		if (value instanceof Set) return `[Set(${value.size})]`
		// `toISOString()` THROWS on an invalid date — turning a log call into an application
		// exception, which is the one thing a logger must never do.
		if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[Invalid Date]" : value.toISOString()

		const obj = value as Record<string, unknown>
		if ("nonDispatchPublicFunctions" in value) {
			// ContractArtifact
			return { name: obj.name }
		}
		if ("packedBytecode" in value) {
			// ContractInstanceWithAddress
			return { id: obj.id }
		}
		if ("originalContractClassId" in value) {
			// ContractInstance
			return {
				currentContractClassId: obj.currentContractClassId,
				originalContractClassId: obj.originalContractClassId,
			}
		}
		// Four required fields, not two: a two-field test collapsed unrelated diagnostics that
		// happened to carry a `rawContent`, destroying them for no gain. `Note` always has all four
		// (`note/spec.ts`), so this stays exact without becoming brittle.
		if (
			Array.isArray((value as Record<string, unknown>).rawContent) &&
			"storageSlot" in value &&
			"contract" in value &&
			"txHash" in value
		) {
			// Note — `rawContent`/`content` is the DECRYPTED private payload, the one thing this
			// wallet exists to keep private. Keep enough to identify which note failed and how big
			// it was; never what it holds.
			const rawContent = obj.rawContent
			const content = obj.content
			return {
				note: obj.type ?? "unknown",
				contract: obj.contract,
				storageSlot: obj.storageSlot,
				rawContentLen: Array.isArray(rawContent) ? rawContent.length : 0,
				contentKeys: content && typeof content === "object" ? Object.keys(content).length : 0,
			}
		}
		if ("secret" in value && "profile" in value && "session" in value) {
			// ActiveSession — `secret` here is the PLAINTEXT master key and `dek` the unsealed
			// imported-keys DEK. Collapsed by shape so the ambiguous key name stays usable elsewhere.
			const profile = obj.profile as Record<string, unknown> | undefined
			return { activeSession: true, profileId: profile?.id, degraded: obj.dek === undefined }
		}
		if ("dekSealed" in value && "type" in value && "id" in value) {
			// Profile — carries the sealed DEK plus the password arm's ciphertext (`guard`,
			// `secret`, `entropy`, `envelopeMac`). None of it aids diagnosis.
			return { profileId: obj.id, type: obj.type }
		}

		return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [k, v]) => {
			if (REDACTED_KEYS.has(k) || SECRET_KEY_SUFFIX.test(k)) {
				acc[k] = `[${k}]`
			} else if (URL_KEYS.has(k)) {
				acc[k] = toOrigin(v)
			} else {
				acc[k] = trim(v, depth + 1)
			}
			return acc
		}, {})
	}
	return value
}

export const print = (log: Log) => {
	const date = new Date(log.timestamp)
	const time = `${date.toTimeString().slice(0, 8)}.${date.getMilliseconds().toString().padStart(3, "0")}`
	const ctx = log.context ? `${log.context}:` : ""
	const header = `[${time}] [${ctx}${log.source}]`

	switch (log.level) {
		case LogLevel.Debug:
			console._debug(header, ...log.data)
			break
		case LogLevel.Info:
			console._log(header, ...log.data)
			break
		case LogLevel.Warn:
			console._warn(header, ...log.data)
			break
		case LogLevel.Error:
			console._error(header, ...log.data)
			break
	}
}
