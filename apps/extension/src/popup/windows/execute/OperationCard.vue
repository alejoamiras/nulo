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
import type { ProfileInfo } from "@/wallet/services/profile/client"
import type { FeeSettings } from "@/wallet/services/execution/client"
import type { DappMetadata } from "@/wallet/services/dapp-session/client"
import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"
import { humanizeOperationKind } from "./humanize"
import type { DraftAztecSendTxOperation, DraftSendTransactionOperation, DraftUIOperation } from "./types"
import { parseTransferIntent, type TransferIntent } from "@/utils/transfer-intent"
import { sanitizeWireString } from "@/wallet/services/dapp-session/capability-meta"

const safe = (s: string | undefined, max: number): string => (s ? sanitizeWireString(s, max) : "")

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
	feeEstimate?: unknown
	isEstimating?: boolean
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

const hasEmbeddedFee = (op: SendLikeUIOp): boolean => {
	if (op.kind === "send_transaction") return op.fee?.embeddedFeePayment !== undefined
	if (op.kind === "aztec_sendTx") return op.executionMode === "default_entrypoint" || op.exec?.feePayer !== undefined
	return false
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
						<Text
							v-for="(action, j) in op.actions"
							:key="`${index}:${j}`"
							data-testid="execute-op-payload-row"
							size="12"
							color="primary"
						>
							<template v-if="action.kind === 'call' || action.kind === 'encoded_call'">
								<Text weight="600">
									{{ humanizeMethodName(action.kind === "call" ? action.method : (action.name ?? action.selector)) }}
								</Text>
								<Text color="secondary"> on </Text>
								<AddressDisplay :address="action.kind === 'call' ? action.contract : action.to" />
							</template>
							<!-- add_public_authwit grants a PERSISTED on-chain spend
								authorization to a named caller. Surface the spender +
								method + contract + args so the user SEES who they are
								authorizing and to do what — not a generic label (audit F2). -->
							<template v-else-if="action.kind === 'add_public_authwit'">
								<Text weight="600">Authorize public spend</Text>
								<template v-if="action.content.kind === 'call'">
									<Text color="secondary"> — spender </Text>
									<AddressDisplay data-testid="execute-authwit-spender" :address="action.content.caller" />
									<Text color="secondary"> for </Text>
									<Text weight="600">{{ humanizeMethodName(action.content.method) }}</Text>
									<Text color="secondary"> on </Text>
									<AddressDisplay :address="action.content.contract" />
									<template v-if="action.content.args?.length">
										<Text color="secondary"> args </Text>
										<Text data-testid="execute-authwit-args">{{ action.content.args.map((a) => String(a)).join(", ") }}</Text>
									</template>
								</template>
								<!-- Non-`call` authwit content kinds: unreachable from the current
									grant producer (hardcodes `call`), but render their identifying
									fields defensively so a future producer can never hide a spend
									target behind an opaque label (verification-audit condition). -->
								<template v-else-if="action.content.kind === 'encoded_call'">
									<Text color="secondary"> — spender </Text>
									<AddressDisplay data-testid="execute-authwit-spender" :address="action.content.caller" />
									<Text color="secondary"> for </Text>
									<Text weight="600">{{ humanizeMethodName(action.content.name ?? action.content.selector) }}</Text>
									<Text color="secondary"> on </Text>
									<AddressDisplay :address="action.content.to" />
								</template>
								<template v-else-if="action.content.kind === 'intent'">
									<Text color="secondary"> — consumer </Text>
									<AddressDisplay data-testid="execute-authwit-spender" :address="action.content.consumer" />
								</template>
								<template v-else>
									<Text color="secondary"> — message hash </Text>
									<Text data-testid="execute-authwit-spender">{{ action.content.messageHash }}</Text>
								</template>
							</template>
							<template v-else>
								{{ action.kind.replace("_", " ") }}
							</template>
						</Text>
					</template>
					<template v-else-if="op.kind === 'aztec_sendTx'">
						<!-- F-008 / Phase 7: structured args on PRIMARY surface for
							known transfer/mint signatures. "Do not guess" semantics —
							parseTransferIntent only returns a typed intent for the
							documented method names + exact arity. For anything else
							it returns `unverified`, and we render the indexed-args
							fallback with an explicit marker. -->
						<template v-for="(call, j) in op.exec.calls" :key="`${index}:${j}`">
							<Text
								data-testid="execute-op-payload-row"
								:data-call-name="call.name ?? ''"
								:data-call-to="call.to?.toString() ?? ''"
								:data-intent-kind="parseTransferIntent(call).kind"
								size="12"
								color="primary"
							>
								<Text weight="600">{{ humanizeMethodName(call.name ?? call.selector) }}</Text>
								<Text color="secondary"> on </Text>
								<AddressDisplay :address="call.to" />
							</Text>
							<!-- Structured args block — only for recognized intents.
							     For transfers we explicitly render `from` because a
							     malicious dApp can craft transfer(other_account,
							     attacker, amount); hiding `from` would let the user
							     approve a different account's funds going out. -->
							<template v-if="parseTransferIntent(call).kind !== 'unverified'">
								<Flex
									data-testid="execute-op-structured-args"
									direction="column"
									gap="2"
									:class="$style.structured_args"
								>
									<Flex v-if="parseTransferIntent(call).kind === 'transfer'" gap="6">
										<Text size="11" color="secondary">From:</Text>
										<AddressDisplay :address="(parseTransferIntent(call) as { from: string }).from" />
									</Flex>
									<Flex gap="6">
										<Text size="11" color="secondary">To:</Text>
										<AddressDisplay :address="(parseTransferIntent(call) as { to: string }).to" />
									</Flex>
									<Flex gap="6">
										<Text size="11" color="secondary">Amount:</Text>
										<Text size="11" color="primary">{{ (parseTransferIntent(call) as { amount: string }).amount }}</Text>
									</Flex>
								</Flex>
							</template>
						</template>
					</template>
				</Flex>
			</Flex>
		</Flex>

		<div :class="$style.op_divider" />

		<Flex
			v-if="hasEmbeddedFee(op)"
			data-testid="execute-op-fee-set-badge"
			align="center"
			gap="8"
			wide
			:class="$style.op_fee_set"
		>
			<Icon name="check-circle" size="14" color="green" />
			<Text size="13" weight="500" color="secondary">
				Fee payment method set by
				<Text size="13" weight="600" color="primary">{{ safe(dapp?.name, 64) || 'the app' }}</Text>
			</Text>
		</Flex>

		<FeeSettingsCard
			v-else
			embedded
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
							{{ safe(tokenMetadata.symbol, 32) }}
						</Text>
						<Text
							v-if="tokenMetadata.name && tokenMetadata.name.toLowerCase() !== tokenMetadata.symbol.toLowerCase()"
							size="12"
							color="secondary"
							data-testid="register-token-name"
						>
							· {{ safe(tokenMetadata.name, 64) }}
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
					<Text
						v-for="(action, j) in op.actions"
						:key="`${index}:${j}`"
						data-testid="execute-op-payload-row"
						size="12"
						color="primary"
					>
						<template v-if="action.kind === 'call' || action.kind === 'encoded_call'">
							<Text weight="600">
								{{ humanizeMethodName(action.kind === "call" ? action.method : (action.name ?? action.selector)) }}
							</Text>
							<Text color="secondary"> on </Text>
							<AddressDisplay :address="action.kind === 'call' ? action.contract : action.to" />
						</template>
						<template v-else>
							{{ action.kind.replace("_", " ") }}
						</template>
					</Text>
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
				<Text size="12" weight="600" color="primary">{{ humanizeMethodName(op.method) }}</Text>
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
		<template v-else-if="op.kind === 'aztec_simulateTx'">
			<Flex :class="$style.prop">
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
						<Text weight="600">{{ humanizeMethodName(call.name ?? call.selector) }}</Text>
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
					{{ humanizeMethodName(op.call.name ?? op.call.selector.toString()) }}
				</Text>
			</Flex>
		</template>
		<template v-else-if="op.kind === 'aztec_profileTx'">
			<Flex :class="$style.prop">
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
						<Text weight="600">{{ humanizeMethodName(call.name ?? call.selector) }}</Text>
						<Text color="secondary"> on </Text>
						<AddressDisplay :address="call.to" />
					</Text>
				</Flex>
			</Flex>
		</template>
		<template v-else-if="op.kind === 'aztec_registerContract'">
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Contract address:</Text>
				<AddressDisplay :address="op.instance.address.toString()" />
			</Flex>
			<Flex v-if="op.artifact" :class="$style.prop">
				<Text size="12" color="secondary">Artifact:</Text>
				<Text size="12" color="primary">{{ safe(op.artifact.name, 64) || "(custom)" }}</Text>
			</Flex>
		</template>
		<template v-else-if="op.kind === 'aztec_createAuthWit'">
			<Flex :class="$style.prop">
				<Text size="12" color="secondary">Message type:</Text>
				<Text size="12" weight="600" color="primary">
					{{
						(op.messageHashOrIntent as { innerHash?: unknown }).innerHash !== undefined ? "Inner hash" : "Call intent"
					}}
				</Text>
			</Flex>
			<template v-if="(op.messageHashOrIntent as { call?: { to: unknown; name?: string; selector?: unknown } }).call">
				<Flex :class="$style.prop">
					<Text size="12" color="secondary">Target contract:</Text>
					<AddressDisplay
						:address="(op.messageHashOrIntent as { call: { to: { toString(): string } } }).call.to.toString()"
					/>
				</Flex>
				<Flex :class="$style.prop">
					<Text size="12" color="secondary">Function:</Text>
					<Text size="12" weight="600" color="primary">
						{{
							humanizeMethodName(
								(op.messageHashOrIntent as { call: { name?: string; selector?: { toString(): string } } }).call.name ??
									(op.messageHashOrIntent as { call: { selector?: { toString(): string } } }).call.selector?.toString() ??
									"",
							)
						}}
					</Text>
				</Flex>
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

/* F-008 / Phase 7: structured-args block under each call row when the
 * intent is a recognized transfer/mint. Visually grouped + indented so
 * it's clearly the call's own data, not a sibling row. */
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
