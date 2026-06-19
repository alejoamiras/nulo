import { type ILogger, LogLevel } from "@nulo/wallet-core/logger"
import { getErrorMessage, jsonSanitize, jsonStringify } from "@nulo/wallet-core/utils"
import type { EventsMap, EventsSpec, IService, MethodsMap, ServiceCollection } from "@nulo/wallet-core/base"
import { buildErrorResponseContent } from "./error-response"
import { awaitInitialized } from "./initialization"
import type { ResponseContentLike } from "./base-client"
import { ValidationError } from "../errors"
import { unwrapParams } from "../utils"

/** The request envelope's `content` the dispatcher reads. `method` is a
 *  PropertyKey (the typed envelope's `keyof TRequests`); it is String()-ed
 *  before the registry check + invoke. */
export interface RequestContentLike {
	requestId: number
	method: string | number | symbol
	params: unknown
}

/**
 * Shared service-side core for both transports (Port server + offscreen
 * sendMessage server). Owns the request lifecycle that was duplicated and
 * drift-prone across the two forks:
 *
 *   - the EXPLICIT RPC-surface guard (`rpcMethods`) — only declared method
 *     names are callable; inherited/prototype/framework/helper methods are not
 *     (D10 security fix).
 *   - param unwrap + null-param clean-error reply.
 *   - method invocation + `WalletError`→`errorPayload` projection via the shared
 *     `buildErrorResponseContent` (so BOTH transports now emit the structured
 *     payload — for the offscreen transport this is wire-ADDITIVE; its client
 *     ignores `errorPayload` until the later flip, D9).
 *   - result sanitization + the 3-tier JSON-fallback send.
 *   - `ensureInitialized`.
 *
 * Transport seams stay in the subclass: how messages are subscribed/routed
 * (`subscribe`), how a response/event is wrapped + put on the wire
 * (`wrapResponse` / `rawSend` / `sendEvent`), the per-invocation keepalive
 * (`beforeInvoke`), and what to do when a send is ultimately dropped
 * (`onSendDropped`). `TCtx` is the per-request send context — a Port for the
 * background server, the requester's address for the offscreen server.
 */
export abstract class BaseService<TRequests extends MethodsMap, TEvents extends EventsMap, TCtx> implements IService {
	public readonly name: string
	protected readonly logger: ILogger
	private initialized = false

	protected constructor(name: string, logger: ILogger) {
		this.name = name
		this.logger = logger
		// NOTE: `subscribe()` is NOT called here. The transport subclass calls it
		// from its OWN constructor (after super()), because subscribe wires up
		// arrow-function listener fields that are only initialized once the
		// subclass's field initializers have run — which is after this base ctor.
		this.logDebug("Service created")
	}

	// ── Lifecycle ───────────────────────────────────────────────────────

	protected async init(_services: ServiceCollection): Promise<void> {
		// overridden in derived classes
	}

	public async start(services: ServiceCollection) {
		if (this.initialized) return
		await this.init(services)
		this.initialized = true
		this.logDebug("Service started")
	}

	protected async ensureInitialized() {
		await awaitInitialized(() => this.initialized)
	}

	// ── Request lifecycle (owned) ───────────────────────────────────────

	/**
	 * Validate, dispatch, and reply to one request. The subclass calls this
	 * after it has validated the transport envelope (type / routing) and
	 * extracted the `content` + send context.
	 */
	protected async handleRequest(content: RequestContentLike, ctx: TCtx): Promise<void> {
		const { requestId, method, params: wrappedParams } = content
		const methodName = String(method)
		// Strict envelope: requestId must be a positive number (hostile string /
		// object ids are dropped, not echoed). D10: only explicitly-registered
		// method names are callable — the service's own `rpcMethods` plus the
		// base-level framework RPCs (backup/restore). Everything else —
		// inherited/prototype/non-RPC framework/helper methods — is dropped.
		if (
			typeof requestId !== "number" ||
			requestId <= 0 ||
			(!this.rpcMethods.has(methodName) && !this.frameworkRpcMethods.has(methodName))
		) {
			this.logWarn("Invalid request received", content)
			return
		}
		if (typeof wrappedParams !== "object" || wrappedParams === null) {
			// Valid requestId + method but malformed params. Reply with a clean
			// error so the client rejects immediately instead of hanging.
			this.logWarn("Invalid request params", content)
			await this.sendResponse({ requestId, ...buildErrorResponseContent(new ValidationError("Invalid request params")) }, ctx)
			return
		}
		const params = unwrapParams(wrappedParams)
		this.logDebug("Request received", requestId, method)

		const endKeepalive = this.beforeInvoke(methodName)
		let responseContent: ResponseContentLike
		try {
			const result = await this.invoke(methodName, params as unknown[])
			responseContent = { requestId, result: jsonSanitize(result) }
		} catch (error) {
			this.logDebug("Request failed", requestId, getErrorMessage(error))
			responseContent = { requestId, ...buildErrorResponseContent(error) }
		} finally {
			endKeepalive?.()
		}
		await this.sendResponse(responseContent, ctx)
	}

	/** Invoke a registered RPC method. Safe — `handleRequest` already confirmed
	 *  `method` is in the explicit `rpcMethods` surface. */
	protected invoke(method: string, params: unknown[]): unknown {
		return (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method](...params)
	}

	protected emit<T extends keyof TEvents>(event: T, payload: TEvents[T]) {
		this.sendEvent({ event, payload: jsonSanitize(payload) })
		;(this as unknown as EventsSpec<TEvents>)[event].invoke(payload)
		this.logDebug("Event sent", event)
	}

	/**
	 * 3-tier send: structured-clone → jsonStringify fallback → error response →
	 * drop. Shared verbatim across both transports (only the raw send primitive
	 * + wrapper differ). `jsonSanitize` already runs upstream so tier-2/3 are
	 * defense-in-depth for circular-ref / unexpected-shape edge cases.
	 */
	private async sendResponse(content: ResponseContentLike, ctx: TCtx): Promise<void> {
		try {
			await this.rawSend(this.wrapResponse(content, ctx), ctx)
		} catch (error) {
			if (content.result === undefined) {
				this.onSendDropped(error, ctx)
				return
			}
			try {
				const stringified = jsonStringify(content.result)
				await this.rawSend(this.wrapResponse({ ...content, result: stringified as unknown, resultIsJson: true }, ctx), ctx)
				this.logWarn("send fell back to jsonStringify", `requestId=${content.requestId}`, `originalError=${getErrorMessage(error)}`)
			} catch (fallbackError) {
				try {
					const errContent: ResponseContentLike = {
						requestId: content.requestId,
						error: `Response not serializable: ${getErrorMessage(fallbackError)}`,
					}
					await this.rawSend(this.wrapResponse(errContent, ctx), ctx)
				} catch {
					this.onSendDropped(fallbackError, ctx)
				}
			}
		}
	}

	// ── Transport seams (subclass-owned) ────────────────────────────────

	/** The explicit set of callable RPC method names. Declare with
	 *  `defineRpcMethods<Methods>()(...)` on the concrete service. */
	protected abstract readonly rpcMethods: ReadonlySet<string>

	/** Base-level framework RPCs callable on every service of this transport,
	 *  independent of the per-service `Methods` type (e.g. the Port server's
	 *  backup/restore convenience RPCs). Default none. */
	protected readonly frameworkRpcMethods: ReadonlySet<string> = new Set()

	/** Wire up the transport's inbound message listener(s). Called from ctor. */
	protected abstract subscribe(): void

	/** Wrap response `content` in the transport's envelope. */
	protected abstract wrapResponse(content: ResponseContentLike, ctx: TCtx): unknown

	/** Put a wrapped message on the wire. May throw (sync Port) or reject
	 *  (async sendMessage); the 3-tier send handles both. */
	protected abstract rawSend(message: unknown, ctx: TCtx): void | Promise<void>

	/** Build + broadcast an event message. Fan-out differs per transport
	 *  (background: every connected client; offscreen: one runtime broadcast). */
	protected abstract sendEvent(content: { event: keyof TEvents; payload: TEvents[keyof TEvents] }): void

	/** Optional per-invocation hook (offscreen keepalive). Returns a cleanup
	 *  callback run in `finally`. Default no-op. */
	protected beforeInvoke(_method: string): (() => void) | void {
		// no-op by default
	}

	/** Called when a response could not be delivered after all tiers. Default
	 *  no-op; the background server logs if the client is still connected. */
	protected onSendDropped(_error: unknown, _ctx: TCtx): void {
		// no-op by default
	}

	// ── Logging ─────────────────────────────────────────────────────────

	protected logDebug(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Debug, ...data)
	}

	protected logInfo(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Info, ...data)
	}

	protected logWarn(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Warn, ...data)
	}

	protected logError(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Error, ...data)
	}
}
