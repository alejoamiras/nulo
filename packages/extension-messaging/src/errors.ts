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

	public constructor(code: string, message: string, details?: unknown) {
		super(message)
		this.name = "WalletError"
		this.code = code
		this.details = details
		// Ensure `instanceof` works when errors are reconstructed across
		// workers/JSON boundaries. Subclasses repeat this in their ctors.
		Object.setPrototypeOf(this, WalletError.prototype)
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
		super(RpcTimeoutError.CODE, message, details)
		this.name = "RpcTimeoutError"
		Object.setPrototypeOf(this, RpcTimeoutError.prototype)
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
		super(RpcDisconnectedError.CODE, message, details)
		this.name = "RpcDisconnectedError"
		Object.setPrototypeOf(this, RpcDisconnectedError.prototype)
	}
}

/** User explicitly rejected a prompt (approval, passkey, etc). */
export class UserRejectedError extends WalletError {
	public static readonly CODE = "USER_REJECTED"

	public constructor(message = "User rejected the request", details?: unknown) {
		super(UserRejectedError.CODE, message, details)
		this.name = "UserRejectedError"
		Object.setPrototypeOf(this, UserRejectedError.prototype)
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
		super(JobCancelledError.CODE, message, details)
		this.name = "JobCancelledError"
		Object.setPrototypeOf(this, JobCancelledError.prototype)
	}
}

/** Request payload failed validation at the RPC boundary. */
export class ValidationError extends WalletError {
	public static readonly CODE = "VALIDATION"

	public constructor(message: string, details?: unknown) {
		super(ValidationError.CODE, message, details)
		this.name = "ValidationError"
		Object.setPrototypeOf(this, ValidationError.prototype)
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
		super(InvalidPasswordError.CODE, message, details)
		this.name = "InvalidPasswordError"
		Object.setPrototypeOf(this, InvalidPasswordError.prototype)
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
		super(ProfileIdConflictError.CODE, message, details)
		this.name = "ProfileIdConflictError"
		Object.setPrototypeOf(this, ProfileIdConflictError.prototype)
	}
}

/**
 * Reconstruct a WalletError (concrete subclass if the code is recognised)
 * from a wire payload. Unknown codes produce a plain `WalletError` with
 * the code preserved so telemetry / log analysis can still group them.
 */
export function walletErrorFromPayload(payload: WalletErrorPayload): WalletError {
	switch (payload.code) {
		case RpcTimeoutError.CODE:
			return new RpcTimeoutError(payload.message, payload.details)
		case RpcDisconnectedError.CODE:
			return new RpcDisconnectedError(payload.message, payload.details)
		case UserRejectedError.CODE:
			return new UserRejectedError(payload.message, payload.details)
		case JobCancelledError.CODE:
			return new JobCancelledError(payload.message, payload.details as { jobId?: string } | undefined)
		case ValidationError.CODE:
			return new ValidationError(payload.message, payload.details)
		case InvalidPasswordError.CODE:
			return new InvalidPasswordError(payload.message, payload.details)
		case ProfileIdConflictError.CODE:
			return new ProfileIdConflictError(payload.message, payload.details)
		default:
			return new WalletError(payload.code, payload.message, payload.details)
	}
}
