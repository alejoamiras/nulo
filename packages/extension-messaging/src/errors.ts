/**
 * Structured errors for the RPC boundary.
 *
 * Historically services caught any thrown value and serialized it via
 * `getErrorMessage(e)` — a flat string on the wire. The client rejected
 * with that string, so consumers lost the error class, the error code, and
 * any contextual details.
 *
 * `WalletError` replaces that. Thrown on the service side, serialized via
 * `toPayload()`, reconstructed on the client via `walletErrorFromPayload()`
 * so `instanceof` checks survive the JSON boundary. Non-WalletError throws
 * still flatten to a message string (backward-compatible fall-through); the
 * client then rejects with `new Error(message)` instead of a raw string.
 */

export interface WalletErrorPayload {
	/** Stable machine-readable code. Subclasses declare their own. */
	code: string
	message: string
	details?: unknown
}

/** Base class for structured errors that cross the RPC boundary. */
export class WalletError extends Error {
	public readonly code: string
	public readonly details?: unknown

	public constructor(code: string, message: string, details?: unknown, name = "WalletError") {
		super(message)
		this.name = name
		this.code = code
		this.details = details
		// Prototype identity is owned HERE, once: `new.target.prototype` resolves to
		// the most-derived class, so `instanceof` survives reconstruction across
		// workers/JSON boundaries without any per-subclass fixup. Subclasses pass
		// their frozen literal name through `super` — never derive it from
		// `new.target.name`; the production minifier mangles class names.
		Object.setPrototypeOf(this, new.target.prototype)
	}

	public toPayload(): WalletErrorPayload {
		return { code: this.code, message: this.message, details: this.details }
	}
}

/**
 * Raised client-side when an RPC request exceeds its timeout. The service
 * side never throws this — it originates in `BackgroundServiceClient`.
 */
export class RpcTimeoutError extends WalletError {
	public static readonly CODE = "RPC_TIMEOUT"

	public constructor(message: string, details?: unknown) {
		super(RpcTimeoutError.CODE, message, details, "RpcTimeoutError")
	}
}

/**
 * Raised client-side when an RPC request cannot be sent because the
 * underlying chrome.runtime.Port is unavailable — either it disconnected
 * between the connect-loop exit and the postMessage, or postMessage itself
 * threw because the port was already torn down. Distinct from
 * `RpcTimeoutError`: the request never made it onto the wire.
 *
 * Closes AUDIT A5 ("port!.postMessage non-null assertion race"). Callers
 * can `instanceof` this to retry without confusing it with a service-side
 * failure.
 */
export class RpcDisconnectedError extends WalletError {
	public static readonly CODE = "RPC_DISCONNECTED"

	public constructor(message: string, details?: unknown) {
		super(RpcDisconnectedError.CODE, message, details, "RpcDisconnectedError")
	}
}

/**
 * The exact message both transports use when rejecting every in-flight
 * request on channel teardown (`makeDisconnectError` in the Port and
 * offscreen clients). Deliberately a plain `Error`, not a `WalletError` —
 * part of the string-shaped disconnect contract; the constant keeps the
 * constructors and `isClientDisconnectRejection` from drifting apart.
 */
export const CLIENT_DISCONNECTED_MESSAGE = "Client disconnected"

/**
 * True for the expected teardown rejection a client emits for each in-flight
 * request when its channel drops (SW restart, page close). The Port transport
 * reconnects immediately after, so for a global rejection handler these are
 * transient churn to log quietly, not actionable errors — a SW restart under
 * an open page used to spam one error-level line per pending request.
 */
export function isClientDisconnectRejection(reason: unknown): boolean {
	return reason instanceof Error && reason.message === CLIENT_DISCONNECTED_MESSAGE
}

/** User explicitly rejected a prompt (approval, passkey, etc). */
export class UserRejectedError extends WalletError {
	public static readonly CODE = "USER_REJECTED"

	public constructor(message = "User rejected the request", details?: unknown) {
		super(UserRejectedError.CODE, message, details, "UserRejectedError")
	}
}

/**
 * User cancelled an in-flight job (transfer / dApp send / authwit revoke /
 * registry toggle) AFTER approval, mid-prove. Sibling to `UserRejectedError`
 * which covers the pre-approval reject path.
 *
 * Internal control-flow uses `JobCancelledSentinel` from `@nulo/wallet-core/jobs`.
 * The execution-service catch at the RPC boundary converts the sentinel into
 * THIS class, which round-trips via `toPayload()` / `walletErrorFromPayload()`
 * so the popup's catch block sees `err instanceof JobCancelledError` cleanly.
 *
 * Maps to EIP-1193 code 4001 ("User rejected the request") when surfaced to
 * dApps. The wallet-sdk handler writes a structured `response.error` with
 * `data.walletErrorCode = "JOB_CANCELLED"` so dApps can distinguish from
 * `USER_REJECTED` for telemetry; both should be treated as "user said no"
 * from a UX perspective.
 */
export class JobCancelledError extends WalletError {
	public static readonly CODE = "JOB_CANCELLED"

	public constructor(message = "Transaction cancelled by user", details?: { jobId?: string }) {
		super(JobCancelledError.CODE, message, details, "JobCancelledError")
	}
}

/**
 * Raised when a dApp invokes a wallet method that requires a capability it has
 * not yet been granted. Today the dispatcher throws this from
 * `handleGetAccounts` when no `accounts` grant exists, so that dApps which call
 * `getAccounts()` before `requestCapabilities()` fall into their existing
 * fallback path instead of silently receiving `[]`.
 *
 * Maps to EIP-1193 code 4100 ("Unauthorized — the requested method and/or
 * account has not been authorized by the user") when surfaced to dApps. The
 * wallet-sdk background handler writes a structured `response.error` with
 * `data.walletErrorCode = "CAPABILITY_NOT_GRANTED"` and `data.capabilityType`
 * so dApps that JSON.parse the wrapped error message can discriminate.
 *
 * Message text is a public contract — substring-matching dApps lock it in.
 * Keep the literal stable across versions; never interpolate user input
 * (origin, session, address) because the wallet-sdk wraps the envelope in
 * `new Error(JSON.stringify(error))` and unescaped input would break the JSON.
 */
export class CapabilityNotGrantedError extends WalletError {
	public static readonly CODE = "CAPABILITY_NOT_GRANTED"

	public constructor(capabilityType: string, message = `${capabilityType} capability not granted. Call requestCapabilities() first.`) {
		super(CapabilityNotGrantedError.CODE, message, { capabilityType }, "CapabilityNotGrantedError")
	}
}

/**
 * Raised when a dApp's sendTx is refused because the per-(profileId, chainId)
 * execution lane is at capacity — either the dApp's own per-origin pending cap
 * or the coarse total-lane cap (see `ExecutionMutex`). Backpressure, NOT a
 * permanent failure: the dApp should retry once its in-flight sendTx settle.
 *
 * Maps to JSON-RPC code -32005 ("Limit exceeded") when surfaced to dApps, with
 * `data.walletErrorCode = "TOO_MANY_PENDING"`. The message is a stable public
 * contract — never interpolate origin/profile/account: the wallet-sdk wraps the
 * envelope in `new Error(JSON.stringify(error))` (unescaped input breaks the
 * JSON), and naming the full lane would leak it to the calling dApp.
 */
export class TooManyPendingError extends WalletError {
	public static readonly CODE = "TOO_MANY_PENDING"

	public constructor(message = "Too many pending transactions; retry after the in-flight ones settle.") {
		super(TooManyPendingError.CODE, message, undefined, "TooManyPendingError")
	}
}

/**
 * A first (account-initializing) transaction lost the initialization race:
 * the node rejected it with an existing-nullifier error while the wallet
 * KNOWS it wrapped the account constructor (another device, or a re-send
 * against a node that lagged behind the earlier init). Classification is
 * provenance-gated — a bare existing-nullifier rejection on a
 * NON-initializing tx is an ordinary double-spend and must stay generic.
 */
export class DuplicateInitializationError extends WalletError {
	public static readonly CODE = "DUPLICATE_INITIALIZATION"

	public constructor(
		message = "Another first transaction initialized this account — wait for network sync, then retry.",
		details?: unknown,
	) {
		super(DuplicateInitializationError.CODE, message, details, "DuplicateInitializationError")
	}
}

/**
 * A dApp asked for an RPC method this wallet does not implement.
 *
 * Typed rather than a bare `Error` because it is dApp-ACTIONABLE — the caller's whole response is
 * to fall back to another route, and the tools app already distinguishes it from a network failure —
 * so it must survive the dApp-facing envelope's unclassified fall-through, which by design
 * replaces an unrecognised error's text with a constant.
 *
 * The method name is echoed back because the dApp supplied it, but bounded: it arrives off the
 * wire, and nothing upstream constrains its length.
 */
export class UnsupportedMethodError extends WalletError {
	public static readonly CODE = "UNSUPPORTED_METHOD"

	/** Longest echoed method name. Real ones are short; anything longer is not a method name. */
	public static readonly MAX_NAME_CHARS = 64

	/** Takes the composed message, like every sibling here, so a payload round-trips unchanged. */
	public constructor(message: string, details?: unknown) {
		super(UnsupportedMethodError.CODE, message, details, "UnsupportedMethodError")
	}

	/** Compose the frozen string for a wire-supplied name. */
	public static forMethod(methodName: string): UnsupportedMethodError {
		const shown =
			methodName.length <= UnsupportedMethodError.MAX_NAME_CHARS
				? methodName
				: `${methodName.slice(0, UnsupportedMethodError.MAX_NAME_CHARS)}…`
		return new UnsupportedMethodError(`Unsupported wallet method: ${shown}`)
	}
}

/** Request payload failed validation at the RPC boundary. */
export class ValidationError extends WalletError {
	public static readonly CODE = "VALIDATION"

	public constructor(message: string, details?: unknown) {
		super(ValidationError.CODE, message, details, "ValidationError")
	}
}

/**
 * Wrong password supplied to an unlock / reauth flow. Clients can `instanceof`
 * this to render a "wrong password" state without string-matching on the
 * message. Matched alongside a legacy-message fallback for older wire formats.
 */
export class InvalidPasswordError extends WalletError {
	public static readonly CODE = "INVALID_PASSWORD"
	public static readonly LEGACY_MESSAGE = "Invalid profile password"

	public constructor(message: string = InvalidPasswordError.LEGACY_MESSAGE, details?: unknown) {
		super(InvalidPasswordError.CODE, message, details, "InvalidPasswordError")
	}
}

/**
 * A stored account address no longer matches what this wallet build re-derives from the profile
 * secret — the address-freeze invariant is broken (wrong build for this profile's regime, or
 * tampered storage). The background integrity coordinator persists a blocking record and withholds
 * the session; consumers `instanceof` this to route to the blocking state instead of a generic
 * failure. NEVER surfaced verbatim to dApps — the dApp-facing projection stays generic.
 */
export class AccountAddressInconsistencyError extends WalletError {
	public static readonly CODE = "ACCOUNT_ADDRESS_INCONSISTENCY"

	public constructor(message = "Account address inconsistency", details?: unknown) {
		super(AccountAddressInconsistencyError.CODE, message, details, "AccountAddressInconsistencyError")
	}
}

/**
 * A profile's backup restore never finished its storage-slice phase: the
 * durable restore-pending marker (written before the profile row, cleared at
 * `finalizeRestore` entry) is still present — the popup/SW died mid-restore
 * and the profile's slices may be incomplete. Opening a session would let the
 * bootstrap silently re-seed missing data (e.g. mint a fresh default account),
 * so unlock is refused; consumers `instanceof` this to explain and point at
 * delete + re-import. NEVER surfaced verbatim to dApps.
 */
export class RestoreTornError extends WalletError {
	public static readonly CODE = "RESTORE_TORN"

	public constructor(message = "This profile's import didn't finish", details?: unknown) {
		super(RestoreTornError.CODE, message, details, "RestoreTornError")
	}
}

/**
 * Raised by `createPasskeyProfile` / `importPasskey` when the profile id
 * the caller pre-reserved was claimed by another writer between the
 * unlocked WebAuthn ceremony and the locked persistence step. Callers
 * should retry the entire flow with a freshly-generated id.
 *
 * Background — the previous behavior silently regenerated the id under
 * the lock without re-running WebAuthn, which left the WebAuthn
 * credential's `userHandle` (= the OLD id) out of sync with the
 * persisted profile id. Surfacing the conflict puts the retry decision
 * back in the caller's hands so the userHandle ↔ profile-id binding
 * stays consistent across the WebAuthn boundary.
 */
export class ProfileIdConflictError extends WalletError {
	public static readonly CODE = "PROFILE_ID_CONFLICT"

	public constructor(message = "Profile id was claimed during WebAuthn prompt; retry with a new id.", details?: unknown) {
		super(ProfileIdConflictError.CODE, message, details, "ProfileIdConflictError")
	}
}

/**
 * A profile with the same wallet fingerprint (same recovery phrase → same master) already exists
 * on this device. Thrown by `importMnemonic` / `importPasskey` / `restore` unless the caller
 * passes `allowDuplicate: true` — the UI catches this, shows the warn-and-confirm dialog, and
 * retries with the override (duplicates are a warned choice, never a hard block — owner policy).
 * `details.existingProfileName` names the colliding profile for the dialog copy; the error NEVER
 * carries key material.
 */
export class DuplicateWalletError extends WalletError {
	public static readonly CODE = "DUPLICATE_WALLET"

	public constructor(message = "A profile with this recovery phrase already exists", details?: { existingProfileName?: string }) {
		super(DuplicateWalletError.CODE, message, details, "DuplicateWalletError")
	}
}

/**
 * Closed, code-keyed view of {@link WalletErrorPayload} for the reconstruction
 * switch below. The WIRE type stays the permissive `WalletErrorPayload` (so
 * `toPayload`, `messages.ts`, and the `errorPayload?: unknown` transport boundary
 * are untouched); this union only types `details` per code so each case reads it
 * without a per-case cast. The two structured codes carry their detail shape; the
 * rest keep `details?: unknown`. (A later boundary-decode parser — Q-01 — will
 * VALIDATE the wire into this shape; today it is one documented cast.)
 */
type KnownWalletErrorPayload =
	| { code: typeof RpcTimeoutError.CODE; message: string; details?: unknown }
	| { code: typeof RpcDisconnectedError.CODE; message: string; details?: unknown }
	| { code: typeof UserRejectedError.CODE; message: string; details?: unknown }
	| { code: typeof JobCancelledError.CODE; message: string; details?: { jobId?: string } }
	| { code: typeof CapabilityNotGrantedError.CODE; message: string; details?: { capabilityType?: string } }
	| { code: typeof ValidationError.CODE; message: string; details?: unknown }
	| { code: typeof InvalidPasswordError.CODE; message: string; details?: unknown }
	| { code: typeof AccountAddressInconsistencyError.CODE; message: string; details?: unknown }
	| { code: typeof RestoreTornError.CODE; message: string; details?: unknown }
	| { code: typeof ProfileIdConflictError.CODE; message: string; details?: unknown }
	| { code: typeof DuplicateWalletError.CODE; message: string; details?: { existingProfileName?: string } }
	| { code: typeof DuplicateInitializationError.CODE; message: string; details?: unknown }
	| { code: typeof UnsupportedMethodError.CODE; message: string; details?: unknown }

/**
 * Reconstruct a WalletError (concrete subclass if the code is recognised)
 * from a wire payload. Unknown codes produce a plain `WalletError` with
 * the code preserved so telemetry / log analysis can still group them.
 */
export function walletErrorFromPayload(payload: WalletErrorPayload): WalletError {
	// One documented boundary cast (the wire `details` is unvalidated). The closed
	// union then lets each case read `details` with no per-case cast; an unknown
	// runtime code falls to the permissive `payload` in `default`.
	const known = payload as KnownWalletErrorPayload
	switch (known.code) {
		case RpcTimeoutError.CODE:
			return new RpcTimeoutError(known.message, known.details)
		case RpcDisconnectedError.CODE:
			return new RpcDisconnectedError(known.message, known.details)
		case UserRejectedError.CODE:
			return new UserRejectedError(known.message, known.details)
		case JobCancelledError.CODE:
			return new JobCancelledError(known.message, known.details)
		case CapabilityNotGrantedError.CODE:
			// Reconstruct preserves both the capabilityType discriminator and the
			// stable message wording so the popup-side / dApp-side instanceof check
			// and substring-match contracts both survive the JSON boundary.
			return new CapabilityNotGrantedError(known.details?.capabilityType ?? "unknown", known.message)
		case ValidationError.CODE:
			return new ValidationError(known.message, known.details)
		case InvalidPasswordError.CODE:
			return new InvalidPasswordError(known.message, known.details)
		case AccountAddressInconsistencyError.CODE:
			return new AccountAddressInconsistencyError(known.message, known.details)
		case RestoreTornError.CODE:
			return new RestoreTornError(known.message, known.details)
		case ProfileIdConflictError.CODE:
			return new ProfileIdConflictError(known.message, known.details)
		case DuplicateWalletError.CODE:
			return new DuplicateWalletError(known.message, known.details)
		case DuplicateInitializationError.CODE:
			return new DuplicateInitializationError(known.message, known.details)
		case UnsupportedMethodError.CODE:
			return new UnsupportedMethodError(known.message, known.details)
		default:
			return new WalletError(payload.code, payload.message, payload.details)
	}
}

/**
 * Reconstruct the client-side error from a response envelope's content.
 *
 * A structured `errorPayload` is rebuilt into its typed `WalletError` subclass
 * (so `instanceof` survives the JSON boundary); otherwise the flat `error`
 * string becomes a plain `Error`. Shared verbatim by the background (Port) and
 * offscreen (sendMessage) transport clients — the structural param keeps this
 * decoupled from each client's `ResponseContentLike`.
 */
export function remoteErrorFromResponseContent(content: { errorPayload?: unknown; error?: string }): Error {
	return content.errorPayload
		? walletErrorFromPayload(content.errorPayload as WalletErrorPayload)
		: new Error(content.error ?? "Unknown error")
}
