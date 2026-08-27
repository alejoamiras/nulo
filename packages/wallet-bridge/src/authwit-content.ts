// Q-06: import the neutral call payloads (not `CallAction`/`EncodedCallAction`
// from `action.ts`) so this module no longer forms a cycle with `action.ts`.
import type { CallPayload, EncodedCallPayload } from "./call-shapes"

export type AuthwitContent = CallAuthwitContent | EncodedCallAuthwitContent | IntentAuthwitContent | MessageHashAuthwitContent

export type CallAuthwitContent = CallPayload & {
	readonly kind: "call"
	readonly caller: string
}

export type EncodedCallAuthwitContent = EncodedCallPayload & {
	readonly kind: "encoded_call"
	readonly caller: string
}

export type IntentAuthwitContent = {
	readonly kind: "intent"
	readonly consumer: string
	readonly intent: string[]
}

export type MessageHashAuthwitContent = {
	readonly kind: "message_hash"
	readonly messageHash: string
}
