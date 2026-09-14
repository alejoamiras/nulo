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
 * The parent owns the operation list + fee estimation map. The card
 * just emits `update:feeSettings` (forwarded from FeeSettingsCard) so
 * the parent can drive `op.feeSettings` and trigger the keyed fee
 * estimator.
 */
import FeeSettingsCard from "@/popup/components/modules/send/FeeSettingsCard.vue"
import { isSelfPay } from "@nulo/wallet-bridge"
import type { ProfileInfo } from "@/wallet/services/profile/client"
import type { DiscoveredAuthwit, FeeSettings, OperationAuthwitPreview, TransferFeeEstimate } from "@/wallet/services/execution/client"
import type { DappMetadata } from "@/wallet/services/dapp-session/client"
import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"
import OperationActionRow from "./OperationActionRow.vue"
import { humanizeOperationKind, safeWire } from "./humanize"
import type { DraftAztecSendTxOperation, DraftSendTransactionOperation, DraftUIOperation } from "./types"
import { parseTransferIntent, projectArgument, type ProjectedArgument, type TransferIntent } from "@/utils/transfer-intent"
import { isEmbeddedFeePayment } from "./operation-validation"

// `DraftUIOperation` is the shared honest type (Phase 2 follow-up). Send-like
// `feeSettings` is optional during user editing — the card v-models it via
// the FeeSettingsCard emit, the parent's `requiresFeeSelection` gate
// validates before approve.
type UIOperation = DraftUIOperation

/** The send-like UI op subset (where feeSettings + fee + exec fields exist). */
type SendLikeUIOp = (DraftAztecSendTxOperation | DraftSendTransactionOperation) & {
	network: Network
	account?: Account
}

defineProps<{
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

/** Raw-argument rows are capped: past this the JSON view is the disclosure, not a 200-row card. */
const MAX_ARG_ROWS = 32
type ArgumentRows = { rows: ProjectedArgument[]; hidden: number }
const argumentRows = (args: unknown): ArgumentRows => {
	const list = Array.isArray(args) ? args : []
	return { rows: list.slice(0, MAX_ARG_ROWS).map(projectArgument), hidden: Math.max(0, list.length - MAX_ARG_ROWS) }
}

/** Who spends in a transfer: the explicit `from` argument, the account contract as `msg_sender` when
 *  the wallet executes from the account, or nobody when the transaction runs through the entrypoint
 *  with no sender at all. */
type TransferSender = { kind: "explicit" | "account"; address: string } | { kind: "none" }
type CallSurface =
	| { kind: "transfer"; intent: Extract<TransferIntent, { kind: "transfer" }>; sender: TransferSender; nonce?: string }
	| ({ kind: "unverified" } & ArgumentRows)
type WireCall = { name?: string; to?: unknown; selector?: unknown; args?: unknown }
const isZero = (n: string): boolean => /^(0x0+|0)$/.test(n)
const callSurface = (op: SendLikeUIOp, call: WireCall): CallSurface => {
	const intent = parseTransferIntent(call as { name?: string; args?: unknown[] })
	if (intent.kind !== "transfer") return { kind: "unverified", ...argumentRows(call.args) }
	const sender: TransferSender =
		intent.from !== undefined
			? { kind: "explicit", address: intent.from }
			: isNoFrom(op)
				? { kind: "none" }
				: { kind: "account", address: op.accountAddress }
	return { kind: "transfer", intent, sender, ...(intent.nonce !== undefined && !isZero(intent.nonce) ? { nonce: intent.nonce } : {}) }
}
const sendTxCalls = (op: DraftAztecSendTxOperation): { call: WireCall; surface: CallSurface }[] =>
	(op.exec.calls as WireCall[]).map((call) => ({ call, surface: callSurface(op as SendLikeUIOp, call) }))

/** What an `aztec_createAuthWit` asks the wallet to sign: a call it can show, or a hash it cannot. */
type CreateAuthwitSurface =
	| ({ kind: "call"; caller: string; to: string; fn: string } & ArgumentRows)
	| { kind: "hash"; consumer: string; innerHash: string }
const wire = (v: unknown, max: number): string => safeWire(v === undefined || v === null ? "" : String(v), max)
const createAuthwitSurface = (m: unknown): CreateAuthwitSurface => {
	const intent = m as { innerHash?: unknown; consumer?: unknown; caller?: unknown; call?: WireCall }
	if (intent.call) {
		const call = intent.call
		return {
			kind: "call",
			caller: wire(intent.caller, 80),
			to: wire(call.to, 80),
			fn: wire(call.name ?? call.selector, 64),
			...argumentRows(call.args),
		}
	}
	return { kind: "hash", consumer: wire(intent.consumer, 80), innerHash: wire(intent.innerHash, 80) }
}

/** Which surface lists what the wallet will sign for this operation: the preview for a
 *  NO_FROM operation, the fee estimate for a standard one; `send_transaction` adds none
 *  at confirm, and an embedded-fee standard operation skips discovery there too. */
type AuthwitSurface =
	| { kind: "list"; authwits: readonly DiscoveredAuthwit[] }
	| { kind: "none-added" }
	| { kind: "pending" }
	| { kind: "hidden" }
const authwitSurface = (
	op: SendLikeUIOp,
	estimate: TransferFeeEstimate | undefined,
	preview: OperationAuthwitPreview | undefined,
	previewing: boolean | undefined,
): AuthwitSurface => {
	if (op.kind !== "aztec_sendTx") return { kind: "hidden" }
	if (isNoFrom(op)) {
		if (preview) return { kind: "list", authwits: preview.discoveredAuthwits }
		return previewing ? { kind: "pending" } : { kind: "hidden" }
	}
	if (isEmbeddedFeePayment(op)) return { kind: "none-added" }
	return estimate?.discoveredAuthwits ? { kind: "list", authwits: estimate.discoveredAuthwits } : { kind: "hidden" }
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
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Payload:</Text>
				<Flex direction="column" gap="4">
					<!-- send_transaction has actions[]; aztec_sendTx has exec.calls[] -->
					<template v-if="op.kind === 'send_transaction'">
						<OperationActionRow v-for="(action, j) in op.actions" :key="`${index}:${j}`" :action="action" />
					</template>
					<template v-else-if="op.kind === 'aztec_sendTx'">
						<!-- A call is a transfer only when its name AND arity match the wallet's own
						     vocabulary; anything else shows its raw arguments under a warning, so no
						     call is ever summarized by a guess. -->
						<template v-for="({ call, surface }, j) in sendTxCalls(op)" :key="`${index}:${j}`">
							<Text
								data-testid="execute-op-payload-row"
								:data-call-name="call.name ?? ''"
								:data-call-to="call.to?.toString() ?? ''"
								:data-intent-kind="surface.kind"
								size="12"
								color="primary"
							>
								<Text weight="600">{{ humanizeMethodName(wire(call.name ?? call.selector, 64)) }}</Text>
								<Text color="secondary"> on </Text>
								<AddressDisplay :address="call.to" />
							</Text>
							<Flex
								v-if="surface.kind === 'transfer'"
								data-testid="execute-op-structured-args"
								direction="column"
								gap="2"
								:class="$style.structured_args"
							>
								<!-- The sender is rendered even when the call carries none: a dApp can
								     spend from another account it names, and the entrypoint spends from
								     nobody. -->
								<Flex data-testid="execute-op-transfer-sender" :data-sender-kind="surface.sender.kind" gap="6">
									<template v-if="surface.sender.kind === 'none'">
										<Text size="11" color="secondary">Caller:</Text>
										<Text size="11" color="primary">none</Text>
									</template>
									<template v-else-if="surface.sender.kind === 'account'">
										<Text size="11" color="secondary">From:</Text>
										<Text size="11" color="primary">this account <Text color="secondary">(<AddressDisplay :address="surface.sender.address" size="11" />)</Text></Text>
									</template>
									<template v-else>
										<Text size="11" color="secondary">From:</Text>
										<AddressDisplay :address="surface.sender.address" />
									</template>
								</Flex>
								<Flex gap="6">
									<Text size="11" color="secondary">To:</Text>
									<AddressDisplay :address="surface.intent.to" />
								</Flex>
								<Flex gap="6">
									<Text size="11" color="secondary">Amount:</Text>
									<Text size="11" color="primary">{{ surface.intent.amount }}</Text>
								</Flex>
								<Flex v-if="surface.nonce !== undefined" data-testid="execute-op-transfer-nonce" gap="6">
									<Text size="11" color="secondary">Authwit nonce:</Text>
									<Text size="11" color="primary">{{ safeWire(surface.nonce, 80) }}</Text>
								</Flex>
							</Flex>
							<Flex v-else data-testid="execute-op-unverified-args" direction="column" gap="2" :class="$style.structured_args">
								<Text size="11" color="orange" data-testid="execute-op-unverified-warning">Unverified call — review the arguments</Text>
								<Flex v-for="(row, m) in surface.rows" :key="`${index}:${j}:arg:${m}`" data-testid="execute-op-arg" :data-arg-kind="row.kind" gap="6">
									<Text size="11" color="secondary">#{{ m }}:</Text>
									<AddressDisplay v-if="row.kind === 'address'" :address="row.value" full size="11" />
									<Text v-else-if="row.kind === 'text'" size="11" color="primary">{{ safeWire(row.value, 128) }}</Text>
									<Text v-else size="11" color="tertiary">(opaque value)</Text>
								</Flex>
								<Text v-if="surface.hidden" size="11" color="tertiary" data-testid="execute-op-args-more">+{{ surface.hidden }} more (see JSON)</Text>
							</Flex>
						</template>
					</template>
				</Flex>
			</Flex>
			<template v-if="authwitSurface(op, feeEstimate, authwitPreview, isPreviewing).kind === 'list'">
				<Flex
					v-if="(authwitSurface(op, feeEstimate, authwitPreview, isPreviewing) as { authwits: readonly DiscoveredAuthwit[] }).authwits.length"
					data-testid="execute-op-discovered-authwits"
					direction="column"
					gap="4"
					:class="$style.prop"
				>
					<Text size="12" color="secondary">Authorizations the wallet will sign (found during estimation):</Text>
					<Flex
						v-for="(a, k) in (authwitSurface(op, feeEstimate, authwitPreview, isPreviewing) as { authwits: readonly DiscoveredAuthwit[] }).authwits"
						:key="`${index}:authwit:${k}`"
						data-testid="execute-op-discovered-authwit"
						:data-message-hash="a.messageHash"
						direction="column"
						gap="2"
						:class="$style.structured_args"
					>
						<Flex gap="6">
							<Text size="11" color="secondary">Consumer:</Text>
							<AddressDisplay :address="a.consumer" />
						</Flex>
						<Flex gap="6">
							<Text size="11" color="secondary">Authorizes:</Text>
							<AddressDisplay :address="a.caller" />
						</Flex>
						<Flex gap="6">
							<Text size="11" color="secondary">Function:</Text>
							<Text size="11" color="primary">{{ safeWire(a.selector, 64) }}</Text>
						</Flex>
						<Flex v-for="(arg, m) in a.args" :key="`${index}:authwit:${k}:${m}`" gap="6">
							<Text size="11" color="secondary">#{{ m }}:</Text>
							<Text size="11" color="primary">{{ safeWire(arg, 128) }}</Text>
						</Flex>
						<Flex gap="6">
							<Text size="11" color="secondary">Inner hash:</Text>
							<Text size="11" color="primary">{{ trimAddress(safeWire(a.innerHash, 80)) }}</Text>
						</Flex>
					</Flex>
				</Flex>
			</template>
			<Flex v-else-if="authwitSurface(op, feeEstimate, authwitPreview, isPreviewing).kind === 'none-added'" :class="$style.prop">
				<Text size="12" color="secondary" data-testid="execute-op-no-wallet-authwits">No wallet-added authorizations</Text>
			</Flex>
			<Flex v-else-if="authwitSurface(op, feeEstimate, authwitPreview, isPreviewing).kind === 'pending'" :class="$style.prop">
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
					<Flex gap="6">
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
						<Text weight="600">{{ humanizeMethodName(safeWire(call.name ?? call.selector, 64)) }}</Text>
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
						<Text size="12" weight="600" color="primary">{{ humanizeMethodName(s.fn) }}</Text>
					</Flex>
					<Flex data-testid="execute-authwit-args" direction="column" gap="2" :class="[$style.prop, $style.args_block]">
						<Text size="12" color="secondary">Arguments:</Text>
						<Flex v-for="(row, m) in s.rows" :key="`${index}:authwit-arg:${m}`" data-testid="execute-authwit-arg" :data-arg-kind="row.kind" gap="6">
							<Text size="11" color="secondary">#{{ m }}:</Text>
							<AddressDisplay v-if="row.kind === 'address'" :address="row.value" full size="11" />
							<Text v-else-if="row.kind === 'text'" size="11" color="primary">{{ safeWire(row.value, 128) }}</Text>
							<Text v-else size="11" color="tertiary">(opaque value)</Text>
						</Flex>
						<Text v-if="s.hidden" size="11" color="tertiary">+{{ s.hidden }} more (see JSON)</Text>
					</Flex>
				</template>
				<template v-else>
					<Flex :class="$style.prop">
						<Text size="12" color="secondary">Consumer contract:</Text>
						<AddressDisplay :address="s.consumer" />
					</Flex>
					<Flex data-testid="execute-authwit-inner-hash" :class="$style.prop">
						<Text size="12" color="secondary">Inner hash:</Text>
						<Text size="11" color="primary">{{ s.innerHash }}</Text>
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

.args_block {
	justify-content: flex-start;

	:last-child {
		text-align: left;
	}
}

/* The per-call detail block: indented under its call row so it reads as that call's own data. */
.structured_args {
	padding: 4px 0 4px 12px;
	border-left: 2px solid var(--nulo-border);
	margin-left: 4px;
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
