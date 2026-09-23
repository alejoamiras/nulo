/**
 * Q-06: the neutral, kind-less call payloads shared by `action.ts` (which adds a
 * `kind` discriminant to form `CallAction`/`EncodedCallAction`) and
 * `authwit-content.ts` (which adds authwit fields). Extracting them into this
 * leaf module — imported one-directionally by both — breaks the previous
 * two-file type cycle (`action.ts` ↔ `authwit-content.ts`) so either module can
 * be split as the `Action` union grows.
 */

export type CallPayload = {
	readonly contract: string
	readonly method: string
	readonly args: unknown[]
	readonly hideSender?: boolean
}

export type EncodedCallPayload = {
	readonly to: string
	readonly selector: string
	readonly args: string[]
	readonly hideMsgSender?: boolean
	name?: string
	type?: string
	isStatic?: boolean
	returnTypes?: unknown[]
}
