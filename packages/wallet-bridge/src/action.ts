import type { AuthwitContent } from "./authwit-content"
import type { CallPayload, EncodedCallPayload } from "./call-shapes"

export type ActionKind = Action["kind"]

export type Action =
	| AddCapsuleAction
	| AddExtraArgsAction
	| AddPrivateAuthwitAction
	| AddPublicAuthwitAction
	| CallAction
	| EncodedCallAction

export type AddCapsuleAction = {
	readonly kind: "add_capsule"
	readonly contract: string
	readonly storageSlot: string
	readonly capsule: string[]
	readonly scope?: string
}

export type AddExtraArgsAction = {
	readonly kind: "add_extra_args"
	readonly args: string[]
}

export type AddPrivateAuthwitAction = {
	readonly kind: "add_private_authwit"
	readonly content: AuthwitContent
	readonly authwit?: string[]
}

export type AddPublicAuthwitAction = {
	readonly kind: "add_public_authwit"
	readonly content: AuthwitContent
}

export type CallAction = { readonly kind: "call" } & CallPayload

export type EncodedCallAction = { readonly kind: "encoded_call" } & EncodedCallPayload
