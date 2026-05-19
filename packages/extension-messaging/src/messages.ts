import type { EventsMap, MethodsMap } from "@nulo/wallet-core/base"
import type { WalletErrorPayload } from "./errors"

export enum MessageType {
	Event = 1,
	Request = 2,
	Response = 3,
}
export type EventMessage<T extends EventsMap> = {
	type: MessageType.Event
	content: EventContent<T>
}

export type EventContent<T extends EventsMap> = {
	[E in keyof T]: {
		event: E
		payload: T[E]
	}
}[keyof T]

export type RequestMessage<T extends MethodsMap> = {
	type: MessageType.Request
	content: RequestContent<T>
}

export type RequestContent<T extends MethodsMap> = {
	[M in keyof T]: {
		requestId: number
		method: M
		params: Parameters<T[M]>
	}
}[keyof T]

export type ResponseMessage<T extends MethodsMap> = {
	type: MessageType.Response
	content: ResponseContent<T>
}

export type ResponseContent<T extends MethodsMap> = {
	[M in keyof T]: {
		requestId: number
		result?: ReturnType<T[M]>
		/** Flat error message. Present on any failure — kept for logging + for
		 *  older clients that read only this field. */
		error?: string
		/** Structured WalletError payload. Present only when the service threw
		 *  a WalletError subclass; absent for plain Error / string throws. */
		errorPayload?: WalletErrorPayload
		/** Set when `result` was JSON-stringified by the service-side
		 *  `jsonStringify` fallback because structured clone refused the
		 *  payload (rare — `jsonSanitize` already runs before postMessage,
		 *  so this is defense-in-depth for circular-ref / unexpected-shape
		 *  edge cases). When true, the client `JSON.parse`s `result` before
		 *  resolving the request. Pattern adapted from Grego's port-server. */
		resultIsJson?: boolean
	}
}[keyof T]
