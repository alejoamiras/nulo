<script setup lang="ts">
/**
 * Single operation row inside the execute window. Three rendering
 * shapes:
 *
 * - `send_transaction` + `aztec_sendTx` — header + From account +
 *   Payload list + fee settings (either the embedded "set by app"
 *   badge or a `<FeeSettingsCard>` v-modeled into the parent's
 *   `op.feeSettings`).
 * - All other read-only / register / simulate variants — header +
 *   from account (when present) + per-kind detail rows.
 *
 * A call's arguments render through `CallArguments` in the first shape
 * that applies: the wallet's transfer/mint vocabulary, the ABI decode the
 * parent fetched, or the raw fields behind a toggle.
 *
 * The parent owns the operation list + fee estimation map. The card
 * just emits `update:feeSettings` (forwarded from FeeSettingsCard) so
 * the parent can drive `op.feeSettings` and trigger the keyed fee
 * estimator.
 */
import FeeSettingsCard from "@/popup/components/modules/send/FeeSettingsCard.vue"
import { isSelfPay } from "@nulo/wallet-bridge"
import type { ProfileInfo } from "@/wallet/services/profile/client"
import type {
	DecodedCall,
	DiscoveredAuthwit,
	FeeSettings,
	OperationAuthwitPreview,
	TransferFeeEstimate,
} from "@/wallet/services/execution/client"
import type { DappMetadata } from "@/wallet/services/dapp-session/client"
import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"
import type { TokenInfo } from "@/wallet/services/token/client"
import CallArguments from "./CallArguments.vue"
import OperationActionRow from "./OperationActionRow.vue"
import { humanizeOperationKind, safeWire } from "./humanize"
import type { DraftAztecSendTxOperation, DraftSendTransactionOperation, DraftUIOperation } from "./types"
import { type CallSurface, type CallerContext, type WireCall, callName, callSurface, tokenAt, wire } from "./call-surface"
import { trimAddress } from "@/utils/string"
import { humanizeMethodName } from "@/utils/tx-enrichment"
import { isEmbeddedFeePayment } from "./operation-validation"

// `DraftUIOperation` is the shared honest type. Send-like `feeSettings` is optional during user
// editing — the card v-models it via the FeeSettingsCard emit, the parent's `requiresFeeSelection`
// gate validates before approve.
type UIOperation = DraftUIOperation

/** The send-like UI op subset (where feeSettings + fee + exec fields exist). */
type SendLikeUIOp = (DraftAztecSendTxOperation | DraftSendTransactionOperation) & {
	network: Network
	account?: Account
}

const props = defineProps<{
	op: UIOperation
	index: number
	profile?: ProfileInfo
	dapp?: DappMetadata & { logoBlobUrl?: string }
	feeEstimate?: TransferFeeEstimate
	isEstimating?: boolean
	/** The wallet-signed authorizations a `default_entrypoint` operation would
	 *  need at send, discovered without signing (no fee estimate exists for it). */
	authwitPreview?: OperationAuthwitPreview
	isPreviewing?: boolean
	/** Display-only ABI decodings of this operation's calls, index-aligned with
	 *  `exec.calls` (or the single `createAuthWit` intent call); `undefined`
	 *  while the wallet is still decoding. */
	decodedCalls?: readonly DecodedCall[]
	/** Display-only decodings of the discovered authorizations, by message hash. */
	decodedAuthwits?: ReadonlyMap<string, DecodedCall>
	/** The wallet's registered tokens, so an amount can carry its symbol and decimals. */
	tokens?: readonly TokenInfo[]
	/**
	 * Pre-fetched token metadata for `register_token` operations. Resolved by
	 * the parent before the card renders so the user can see name / symbol /
	 * decimals BEFORE pressing Allow. `undefined` while the parent is still
	 * fetching OR if the contract returned incomplete metadata.
	 *
	 * SECURITY: the strings here are attacker-controllable (a malicious token
	 * contract can return any value for getName / getSymbol). The template
	 * always renders the contract address alongside so the user can verify.
	 */
	tokenMetadata?: { name: string; symbol: string; decimals: number }
	tokenMetadataError?: string
	tokenMetadataLoading?: boolean
}>()

const emit = defineEmits<(e: "updateFeeSettings", index: number, value: FeeSettings | undefined) => void>()

// TS type predicate so the template's `v-if="isSendTx(op)"` narrows op
// to the send-like subtype downstream (lets us access `op.feeSettings`
// without TS complaining that non-send kinds don't carry that field).
const isSendTx = (op: UIOperation): op is SendLikeUIOp => op.kind === "send_transaction" || op.kind === "aztec_sendTx"

/** The method a dApp asked for by naming the account itself as payer with no fee call: the card
 *  locks to it, so the sponsored FPC is never on offer for a transaction the app expects the
 *  account's own Fee Juice to pay. */
const requestedMethod = (op: SendLikeUIOp): "fj" | null => (op.kind === "aztec_sendTx" && isSelfPay(op.exec, op.opts?.from) ? "fj" : null)

const isNoFrom = (op: SendLikeUIOp): boolean => op.kind === "aztec_sendTx" && op.executionMode === "default_entrypoint"

/** The decoding for call `j`, or `unavailable` when the parent's batch came back short. */
const decodedAt = (j: number): DecodedCall | undefined =>
	props.decodedCalls ? (props.decodedCalls[j] ?? { kind: "undecoded", reason: "unavailable" }) : undefined

const sendTxCalls = (op: DraftAztecSendTxOperation): { call: WireCall; surface: CallSurface }[] => {
	const ctx: CallerContext = { accountAddress: op.accountAddress, noFrom: isNoFrom(op as SendLikeUIOp) }
	return (op.exec.calls as WireCall[]).map((call, j) => ({ call, surface: callSurface(ctx, call, decodedAt(j), isToken(call.to)) }))
}

/** Only a contract the wallet registered as a token gets the transfer/mint vocabulary. */
const isToken = (contract: unknown): boolean => tokenAt(props.tokens, props.op.network?.chainId, contract) !== undefined

/** What an `aztec_createAuthWit` asks the wallet to sign: a call it can show, or a hash it cannot. */
type CreateAuthwitSurface =
	| { kind: "call"; caller: string; to: string; call: WireCall; args: CallSurface }
	| { kind: "hash"; consumer: string; innerHash: string }
const createAuthwitSurface = (m: unknown): CreateAuthwitSurface => {
	const intent = m as { innerHash?: unknown; consumer?: unknown; caller?: unknown; call?: WireCall }
	if (intent.call) {
		const call = intent.call
		return {
			kind: "call",
			caller: wire(intent.caller, 80),
			to: wire(call.to, 80),
			call,
			args: callSurface(undefined, call, decodedAt(0), isToken(call.to)),
		}
	}
	return { kind: "hash", consumer: wire(intent.consumer, 80), innerHash: wire(intent.innerHash, 80) }
}

/** Which surface lists what the wallet will sign for this operation: the preview for a
 *  NO_FROM operation, the fee estimate for a standard one; `send_transaction` adds none
 *  at confirm, and an embedded-fee standard operation skips discovery there too. Nothing is
 *  rendered when there is nothing to list: an absent row must not read as a claim of absence. */
type AuthwitSurface = { kind: "list"; authwits: readonly DiscoveredAuthwit[] } | { kind: "pending" } | { kind: "hidden" }
const authwitSurface = (op: UIOperation): AuthwitSurface => {
	if (op.kind !== "aztec_sendTx") return { kind: "hidden" }
	if (isNoFrom(op as SendLikeUIOp)) {
		if (props.authwitPreview) return { kind: "list", authwits: props.authwitPreview.discoveredAuthwits }
		return props.isPreviewing ? { kind: "pending" } : { kind: "hidden" }
	}
	if (isEmbeddedFeePayment(op)) return { kind: "hidden" }
	return props.feeEstimate?.discoveredAuthwits ? { kind: "list", authwits: props.feeEstimate.discoveredAuthwits } : { kind: "hidden" }
}
const authwits = computed(() => authwitSurface(props.op))

/** A discovered authorization decodes on its consumer; the selector stands in until it does. */
const authwitDecode = (a: DiscoveredAuthwit): DecodedCall | undefined => props.decodedAuthwits?.get(a.messageHash)
const authwitFunction = (a: DiscoveredAuthwit): string => {
	const decoded = authwitDecode(a)
	return decoded?.kind === "decoded" ? humanizeMethodName(safeWire(decoded.fn, 64), a.consumer) : safeWire(a.selector, 64)
}
// A discovered authorization is not in the request's JSON view, so its own row list is the whole disclosure.
const authwitArgs = (a: DiscoveredAuthwit): CallSurface =>
	callSurface(
		undefined,
		{ selector: a.selector, to: a.consumer, args: a.args },
		authwitDecode(a),
		isToken(a.consumer),
		Number.POSITIVE_INFINITY,
	)

/** Which discovered authorizations the user expanded; collapsed by default, the summary row is the review. */
const openAuthwits = ref(new Set<string>())
const isAuthwitOpen = (a: DiscoveredAuthwit): boolean => openAuthwits.value.has(a.messageHash)
const toggleAuthwit = (a: DiscoveredAuthwit): void => {
	const next = new Set(openAuthwits.value)
	if (next.has(a.messageHash)) next.delete(a.messageHash)
	else next.add(a.messageHash)
	openAuthwits.value = next
}
</script>

<template>
	<Flex
		v-if="isSendTx(op)"
		data-testid="execute-op-item"
		:data-op-id="index"
		:data-op-kind="op.kind"
		direction="column"
		:class="$style.op_card"
	>
		<Flex :class="$style.op_body" direction="column" wide>
			<Flex wide justify="between" align="center" gap="8">
				<Text size="14" color="primary">{{ humanizeOperationKind(op.kind) }}</Text>
			</Flex>
			<Flex
				data-testid="execute-op-from-account"
				:data-account-name="op.account!.name"
				:data-account-address="op.account!.address"
				:class="$style.prop"
			>
				<Text size="12" color="secondary">From account:</Text>
				<Text size="12" color="primary">
					{{ op.account!.name }}
					<Text color="secondary">({{ trimAddress(op.account!.address) }})</Text>
				</Text>
			</Flex>
			<!-- send_transaction has actions[]; aztec_sendTx has exec.calls[] -->
			<Flex v-if="op.kind === 'send_transaction'" :class="$style.prop">
				<Text size="12" color="secondary">Payload:</Text>
				<Flex direction="column" gap="4">
					<OperationActionRow v-for="(action, j) in op.actions" :key="`${index}:${j}`" :action="action" />
				</Flex>
			</Flex>
			<template v-else-if="op.kind === 'aztec_sendTx'">
				<Flex :class="$style.group"><Text size="12" color="secondary">Payload</Text></Flex>
				<Flex v-for="({ call, surface }, j) in sendTxCalls(op)" :key="`${index}:${j}`" direction="column" gap="4" :class="$style.call">
					<Flex
						data-testid="execute-op-payload-row"
						:data-call-name="call.name ?? ''"
						:data-call-to="call.to?.toString() ?? ''"
						:data-intent-kind="surface.kind"
						justify="between"
						align="center"
						:class="$style.row"
					>
						<Text size="12" weight="600" color="primary">{{ callName(call, surface) }}</Text>
						<Text size="11" color="secondary">on <AddressDisplay :address="call.to" size="11" /></Text>
					</Flex>
					<CallArguments :surface="surface" :contract="call.to" :chainId="op.network?.chainId" :tokens="tokens" prefix="execute-op" json-view />
				</Flex>
			</template>
			<Flex
				v-if="authwits.kind === 'list' && authwits.authwits.length"
				data-testid="execute-op-discovered-authwits"
				direction="column"
				gap="4"
				:class="$style.group"
			>
				<Text size="12" color="secondary">Authorizations the wallet will sign (found during estimation)</Text>
				<Flex
					v-for="(a, k) in authwits.authwits"
					:key="`${index}:authwit:${k}`"
					data-testid="execute-op-discovered-authwit"
					:data-message-hash="a.messageHash"
					direction="column"
					gap="2"
					:class="$style.structured_args"
				>
					<Flex justify="between" :class="$style.row">
						<Text size="11" color="secondary">Consumer:</Text>
						<AddressDisplay :address="a.consumer" size="11" />
					</Flex>
					<Flex justify="between" :class="$style.row">
						<Text size="11" color="secondary">Authorizes:</Text>
						<AddressDisplay :address="a.caller" size="11" />
					</Flex>
					<Flex justify="between" :class="$style.row">
						<Text size="11" color="secondary">Function:</Text>
						<Text size="11" color="primary" data-testid="execute-discovered-authwit-function">{{ authwitFunction(a) }}</Text>
					</Flex>
					<button
						type="button"
						data-testid="execute-discovered-authwit-toggle"
						:aria-expanded="isAuthwitOpen(a)"
						:class="$style.details_toggle"
						@click="toggleAuthwit(a)"
					>
						<Icon name="chevron-right" size="10" color="secondary" :class="[$style.chevron, isAuthwitOpen(a) && $style.chevron_open]" />
						<Text size="11" color="secondary">{{ isAuthwitOpen(a) ? "Hide details" : "Show details" }}</Text>
					</button>
					<Flex v-if="isAuthwitOpen(a)" data-testid="execute-discovered-authwit-details" direction="column" gap="2">
						<CallArguments :surface="authwitArgs(a)" :contract="a.consumer" :chainId="op.network?.chainId" :tokens="tokens" prefix="execute-discovered-authwit" />
						<Flex justify="between" :class="$style.row">
							<Text size="11" color="secondary">Inner hash:</Text>
							<Text size="11" color="primary" mono :title="safeWire(a.innerHash, 80)">{{ trimAddress(safeWire(a.innerHash, 80), 10, 6) }}</Text>
						</Flex>
					</Flex>
				</Flex>
			</Flex>
			<Flex v-else-if="authwits.kind === 'pending'" :class="$style.prop">
				<Text size="12" color="secondary" data-testid="execute-op-authwits-pending">Checking authorizations…</Text>
			</Flex>
		</Flex>

		<div :class="$style.op_divider" />

		<Flex
			v-if="isEmbeddedFeePayment(op)"
			data-testid="execute-op-fee-set-badge"
			align="center"
			gap="8"
			wide
			:class="$style.op_fee_set"
		>
			<Icon name="check-circle" size="14" color="green" />
			<Text size="13" weight="500" color="secondary">
				Fee payment method set by
				<Text size="13" weight="600" color="primary">{{ safeWire(dapp?.name, 64) || 'the app' }}</Text>
			</Text>
		</Flex>

		<FeeSettingsCard
			v-else
			embedded
			:lockedMethod="requestedMethod(op)"
			:profile="profile"
			:network="op.network"
			:account="op.account"
			:feeEstimate="feeEstimate"
			:isEstimating="isEstimating"
			:modelValue="op.feeSettings"
			@update:modelValue="(value: FeeSettings | undefined) => emit('updateFeeSettings', index, value)"
		/>
	</Flex>

	<Flex
		v-else
		data-testid="execute-op-item"
		:data-op-id="index"
		:data-op-kind="op.kind"
		:class="[$style.op_card, $style.op_card_simple]"
		direction="column"
		wide
	>
		<Flex wide justify="between">
			<Text size="14" color="primary">{{ humanizeOperationKind(op.kind) }}</Text>
		</Flex>

		<Flex v-if="op.account" :class="$style.prop">
			<Text size="12" color="secondary">From account:</Text>
			<Text size="12" color="primary">
				{{ op.account!.name }}
				<Text color="secondary">({{ trimAddress(op.account!.address) }})</Text>
			</Text>
		</Flex>

		<template v-if="op.kind === 'register_contract'">
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Contract address:</Text>
				<AddressDisplay :address="op.address" />
			</Flex>
		</template>
		<template v-else-if="op.kind === 'register_sender'">
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Sender address:</Text>
				<AddressDisplay :address="op.address" />
			</Flex>
		</template>
		<template v-else-if="op.kind === 'register_token'">
			<template v-if="tokenMetadataLoading">
				<Flex :class="$style.prop" align="center" gap="6">
					<Spinner size="14" color="--txt-inverse" />
					<Text size="12" color="secondary">Loading token metadata…</Text>
				</Flex>
			</template>
			<template v-else-if="tokenMetadata">
				<!-- Resolved symbol + name + decimals on one row. The contract
				     address renders below as a separate prop row so the user
				     can verify against a trusted source — the symbol/name come
				     straight from the on-chain contract and are
				     attacker-controllable. Name is hidden when it duplicates
				     the symbol (e.g. test USDC where both equal "USDC"). -->
				<Flex :class="$style.prop">
					<Flex justify="between" :class="$style.row">
						<Text size="14" weight="600" color="primary" data-testid="register-token-symbol">
							{{ safeWire(tokenMetadata.symbol, 32) }}
						</Text>
						<Text
							v-if="tokenMetadata.name && tokenMetadata.name.toLowerCase() !== tokenMetadata.symbol.toLowerCase()"
							size="12"
							color="secondary"
							data-testid="register-token-name"
						>
							· {{ safeWire(tokenMetadata.name, 64) }}
						</Text>
					</Flex>
					<Text size="12" color="tertiary" data-testid="register-token-decimals">
						{{ tokenMetadata.decimals }} decimals
					</Text>
				</Flex>
			</template>
			<template v-else-if="tokenMetadataError">
				<Flex :class="$style.prop" direction="column" gap="2">
					<Text size="12" color="orange" data-testid="register-token-meta-error">
						Couldn't resolve token metadata
					</Text>
					<Text size="11" color="tertiary">Verify the contract address before approving.</Text>
				</Flex>
			</template>

			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Contract address:</Text>
				<AddressDisplay :address="op.address" data-testid="register-token-address" />
			</Flex>
		</template>
		<template v-else-if="op.kind === 'simulate_transaction'">
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Payload:</Text>
				<Flex direction="column" gap="4">
					<OperationActionRow v-for="(action, j) in op.actions" :key="`${index}:${j}`" :action="action" />
				</Flex>
			</Flex>
		</template>
		<template v-else-if="op.kind === 'simulate_utility'">
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Contract address:</Text>
				<AddressDisplay :address="op.contract" />
			</Flex>
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Function:</Text>
				<Text size="12" weight="600" color="primary">{{ humanizeMethodName(safeWire(op.method, 64)) }}</Text>
			</Flex>
		</template>
		<template v-else-if="op.kind === 'aztec_getContractClassMetadata'">
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Class id:</Text>
				<Text size="12" color="primary">{{ trimAddress(op.id.toString()) }}</Text>
			</Flex>
		</template>
		<template v-else-if="op.kind === 'aztec_getContractMetadata'">
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Contract address:</Text>
				<AddressDisplay :address="op.address.toString()" />
			</Flex>
		</template>
		<template v-else-if="op.kind === 'aztec_getPrivateEvents'">
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Contract address:</Text>
				<AddressDisplay :address="op.eventFilter.contractAddress.toString()" />
			</Flex>
		</template>
		<template v-else-if="op.kind === 'aztec_registerSender'">
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Sender address:</Text>
				<AddressDisplay :address="op.address.toString()" />
			</Flex>
		</template>
		<template v-else-if="op.kind === 'aztec_simulateTx' || op.kind === 'aztec_profileTx'">
			<Flex :key="op.kind" :class="$style.prop">
				<Text size="12" color="secondary">Payload:</Text>
				<Flex direction="column" gap="4">
					<Text
						v-for="(call, j) in op.exec.calls"
						:key="`${index}:${j}`"
						data-testid="execute-op-payload-row"
						:data-call-name="call.name ?? ''"
						:data-call-to="call.to?.toString() ?? ''"
						size="12"
						color="primary"
					>
						<Text weight="600">{{ humanizeMethodName(safeWire(call.name ?? call.selector, 64), wire(call.to, 80)) }}</Text>
						<Text color="secondary"> on </Text>
						<AddressDisplay :address="call.to" />
					</Text>
				</Flex>
			</Flex>
		</template>
		<template v-else-if="op.kind === 'aztec_executeUtility'">
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Contract address:</Text>
				<AddressDisplay :address="op.call.to.toString()" />
			</Flex>
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Function:</Text>
				<Text size="12" weight="600" color="primary">
					{{ humanizeMethodName(safeWire(op.call.name ?? op.call.selector.toString(), 64)) }}
				</Text>
			</Flex>
		</template>
		<template v-else-if="op.kind === 'aztec_registerContract'">
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Contract address:</Text>
				<AddressDisplay :address="op.instance.address.toString()" />
			</Flex>
			<Flex v-if="op.artifact" :class="$style.prop">
				<Text size="12" color="secondary">Artifact:</Text>
				<Text size="12" color="primary">{{ safeWire(op.artifact.name, 64) || "(custom)" }}</Text>
			</Flex>
		</template>
		<template v-else-if="op.kind === 'aztec_createAuthWit'">
			<template v-for="s in [createAuthwitSurface(op.messageHashOrIntent)]" :key="op.kind">
				<Flex :class="$style.prop">
					<Text size="12" color="secondary">Message type:</Text>
					<Text size="12" weight="600" color="primary">{{ s.kind === "hash" ? "Inner hash" : "Call intent" }}</Text>
				</Flex>
				<template v-if="s.kind === 'call'">
					<!-- The delegate is the party this signature lets act as the account; it is the
					     field a phishing intent hides. -->
					<Flex data-testid="execute-authwit-caller" :class="$style.prop">
						<Text size="12" color="secondary">Authorizes:</Text>
						<AddressDisplay :address="s.caller" />
					</Flex>
					<Flex :class="$style.prop">
						<Text size="12" color="secondary">Target contract:</Text>
						<AddressDisplay :address="s.to" />
					</Flex>
					<Flex :class="$style.prop">
						<Text size="12" color="secondary">Function:</Text>
						<Text size="12" weight="600" color="primary" data-testid="execute-authwit-function">{{ callName(s.call, s.args) }}</Text>
					</Flex>
					<Flex data-testid="execute-authwit-args" direction="column" gap="4" :class="$style.group">
						<Text size="12" color="secondary">Arguments</Text>
						<CallArguments :surface="s.args" :contract="s.to" :chainId="op.network?.chainId" :tokens="tokens" prefix="execute-authwit" json-view />
					</Flex>
				</template>
				<template v-else>
					<Flex :class="$style.prop">
						<Text size="12" color="secondary">Consumer contract:</Text>
						<AddressDisplay :address="s.consumer" />
					</Flex>
					<Flex data-testid="execute-authwit-inner-hash" :class="$style.prop">
						<Text size="12" color="secondary">Inner hash:</Text>
						<Text size="11" color="primary" mono :title="s.innerHash">{{ trimAddress(s.innerHash, 10, 6) }}</Text>
					</Flex>
					<Flex :class="$style.prop">
						<Text size="11" color="orange" data-testid="execute-authwit-opaque-warning">
							Opaque authorization — the wallet cannot show what this hash authorizes
						</Text>
					</Flex>
				</template>
			</template>
		</template>
	</Flex>
</template>

<style module>
.op_card {
	width: 100%;

	border: 1px solid var(--nulo-border);
	background: transparent;
	overflow: hidden;
}

.op_card_simple {
	padding: 12px;
}

.op_body {
	padding: 12px;
}

.op_divider {
	height: 1px;
	background: var(--nulo-border);
}

.op_fee_set {
	padding: 12px;
	background: var(--nulo-surface-low);
}

/* A label on its own line above a full-width stack, so nothing hangs off the right-aligned value column. */
.group {
	width: 100%;
	padding-top: 12px;
}

.call {
	width: 100%;
	padding-top: 8px;
}

.call + .call {
	margin-top: 8px;
	border-top: 1px solid var(--nulo-border);
}

.row {
	width: 100%;
	gap: 12px;

	> :last-child {
		min-width: 0;
		text-align: right;
	}
}

.structured_args {
	width: 100%;
}

.details_toggle {
	display: inline-flex;
	align-items: center;
	align-self: flex-start;
	gap: 4px;
	padding: 2px 0;
	border: 0;
	background: none;
	cursor: pointer;
	font: inherit;
}

.chevron {
	transition: transform 120ms ease;
}

.chevron_open {
	transform: rotate(90deg);
}

.prop {
	width: 100%;
	justify-content: space-between;
	padding-top: 12px;

	:last-child {
		text-align: right;
	}
}
</style>
