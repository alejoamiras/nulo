<script setup lang="ts">
/**
 * Expanded details for one capability card. Renders the per-flag rows
 * and the scope contents in the brutalist family style: raw wire strings
 * are primary, friendly annotations are secondary. The helpers here are
 * shared with `<ScopeAddress>` / `<ScopeClassId>` (clipboard wiring +
 * contact-name annotation) — those components own the trust-aware
 * rendering for addresses and class ids.
 */
import type { Capability, Scope, ScopePattern } from "@nulo/wallet-bridge"
import ScopeAddress from "@/components/ScopeAddress.vue"
import ScopeClassId from "@/components/ScopeClassId.vue"
import { getMethodLabel } from "@/utils/tx-enrichment"
import { sanitizeWireString } from "@/wallet/services/dapp-session/capability-meta"

defineProps<{
	capability: Capability
	granted: boolean
}>()

function formatScope(scope: Scope): { isWildcard: boolean; patterns: ScopePattern[] } {
	if (scope === "*") return { isWildcard: true, patterns: [] }
	if (Array.isArray(scope)) return { isWildcard: false, patterns: scope }
	return { isWildcard: true, patterns: [] }
}

/**
 * Render-time function-id sanitizer. `humanizeMethodName` is many-to-one
 * lossy (transfer, transfer_in_private, and transfer_private_to_private
 * all collapse to "Transfer (private)"), so we always show the RAW
 * sanitized method id and only attach the friendly label when
 * `METHOD_LABELS` knows it. Length cap of 64 handles legitimate Aztec
 * method names (the longest builtins are < 40 chars) while clamping
 * pathological wire values.
 */
function fnLabel(fn: string): string {
	return sanitizeWireString(fn, 64)
}
</script>

<template>
	<Flex direction="column" gap="8" :class="[$style.panel, granted && $style.granted]">
		<!-- accounts -->
		<template v-if="capability.type === 'accounts'">
			<Text size="12" weight="600" color="secondary">Permissions:</Text>
			<Flex direction="column" gap="4" :class="$style.detail_list">
				<Flex v-if="capability.canGet !== false" align="center" gap="6">
					<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
					<Text size="12" color="secondary">Read your account addresses</Text>
				</Flex>
				<Flex v-if="capability.canCreateAuthWit" align="center" gap="6">
					<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
					<Text size="12" color="secondary">
						Sign auth witnesses for actions on your accounts (scope-checked against your other granted permissions before signing)
					</Text>
				</Flex>
				<Flex align="center" gap="6">
					<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
					<Text size="12" color="secondary">Register tokens (adds an entry to your wallet's local registry)</Text>
				</Flex>
			</Flex>
		</template>

		<!-- contracts -->
		<template v-else-if="capability.type === 'contracts'">
			<Flex direction="column" gap="4">
				<Text size="12" weight="600" color="secondary">Scope:</Text>
				<Flex v-if="capability.contracts === '*'" align="center" gap="6" :class="$style.detail_list">
					<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
					<Text size="12" color="secondary">Any contract</Text>
				</Flex>
				<Flex
					v-else-if="Array.isArray(capability.contracts)"
					direction="column"
					gap="8"
					:class="$style.detail_list"
				>
					<Flex
						v-for="(addr, ai) in capability.contracts"
						:key="ai"
						align="start"
						gap="6"
					>
						<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
						<ScopeAddress :address="String(addr)" />
					</Flex>
				</Flex>
			</Flex>
			<Flex direction="column" gap="4">
				<Text size="12" weight="600" color="secondary">Permissions:</Text>
				<Flex direction="column" gap="4" :class="$style.detail_list">
					<Flex v-if="capability.canRegister" align="center" gap="6">
						<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
						<Text size="12" color="secondary">Register contracts</Text>
					</Flex>
					<Flex v-if="capability.canGetMetadata" align="center" gap="6">
						<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
						<Text size="12" color="secondary">Read contract metadata and token-registration state</Text>
					</Flex>
				</Flex>
			</Flex>
		</template>

		<!-- contractClasses -->
		<template v-else-if="capability.type === 'contractClasses'">
			<Flex direction="column" gap="4">
				<Text size="12" weight="600" color="secondary">Scope:</Text>
				<Flex v-if="capability.classes === '*'" align="center" gap="6" :class="$style.detail_list">
					<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
					<Text size="12" color="secondary">Any contract class</Text>
				</Flex>
				<Flex
					v-else-if="Array.isArray(capability.classes)"
					direction="column"
					gap="8"
					:class="$style.detail_list"
				>
					<Flex
						v-for="(cls, ci) in capability.classes"
						:key="ci"
						align="start"
						gap="6"
					>
						<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
						<ScopeClassId :id="String(cls)" />
					</Flex>
				</Flex>
			</Flex>
			<Flex v-if="capability.canGetMetadata" direction="column" gap="4">
				<Text size="12" weight="600" color="secondary">Permissions:</Text>
				<Flex align="center" gap="6" :class="$style.detail_list">
					<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
					<Text size="12" color="secondary">Read class metadata</Text>
				</Flex>
			</Flex>
		</template>

		<!-- simulation -->
		<template v-else-if="capability.type === 'simulation'">
			<Flex v-if="capability.transactions" direction="column" gap="4">
				<Text size="12" weight="600" color="secondary">Simulate transactions (and view-calls) in scope:</Text>
				<Flex
					v-if="formatScope(capability.transactions.scope).isWildcard"
					align="center"
					gap="6"
					:class="$style.detail_list"
				>
					<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
					<Text size="12" color="secondary">Any contract, any function</Text>
				</Flex>
				<Flex v-else direction="column" gap="10" :class="$style.detail_list">
					<Flex
						v-for="(p, pi) in formatScope(capability.transactions.scope).patterns"
						:key="pi"
						align="start"
						gap="6"
					>
						<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
						<Flex direction="column" gap="3">
							<Text v-if="String(p.contract) === '*'" size="12" color="secondary">Any contract</Text>
							<ScopeAddress v-else :address="String(p.contract)" />
							<Flex align="center" gap="6">
								<Text size="11" color="tertiary">fn:</Text>
								<Text size="11" weight="600" color="secondary" :class="$style.mono">
									{{ String(p.function) === "*" ? "*" : fnLabel(String(p.function)) }}
								</Text>
								<Text v-if="String(p.function) !== '*' && getMethodLabel(String(p.function))" size="11" color="tertiary">
									· {{ getMethodLabel(String(p.function)) }}
								</Text>
							</Flex>
						</Flex>
					</Flex>
				</Flex>
			</Flex>
			<Flex v-if="capability.utilities" direction="column" gap="4">
				<Text size="12" weight="600" color="secondary">Simulate utilities in scope:</Text>
				<Flex
					v-if="formatScope(capability.utilities.scope).isWildcard"
					align="center"
					gap="6"
					:class="$style.detail_list"
				>
					<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
					<Text size="12" color="secondary">Any contract, any function</Text>
				</Flex>
				<Flex v-else direction="column" gap="10" :class="$style.detail_list">
					<Flex
						v-for="(p, pi) in formatScope(capability.utilities.scope).patterns"
						:key="pi"
						align="start"
						gap="6"
					>
						<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
						<Flex direction="column" gap="3">
							<Text v-if="String(p.contract) === '*'" size="12" color="secondary">Any contract</Text>
							<ScopeAddress v-else :address="String(p.contract)" />
							<Flex align="center" gap="6">
								<Text size="11" color="tertiary">fn:</Text>
								<Text size="11" weight="600" color="secondary" :class="$style.mono">
									{{ String(p.function) === "*" ? "*" : fnLabel(String(p.function)) }}
								</Text>
								<Text v-if="String(p.function) !== '*' && getMethodLabel(String(p.function))" size="11" color="tertiary">
									· {{ getMethodLabel(String(p.function)) }}
								</Text>
							</Flex>
						</Flex>
					</Flex>
				</Flex>
			</Flex>
			<Text v-if="!capability.transactions && !capability.utilities" size="12" color="tertiary">
				No scopes specified
			</Text>
		</template>

		<!-- transaction -->
		<template v-else-if="capability.type === 'transaction'">
			<Flex direction="column" gap="4">
				<Text size="12" weight="600" color="secondary">Allowed transactions:</Text>
				<Flex
					v-if="formatScope(capability.scope).isWildcard"
					align="center"
					gap="6"
					:class="$style.detail_list"
				>
					<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
					<Text size="12" color="secondary">Any contract, any function</Text>
				</Flex>
				<Flex v-else direction="column" gap="10" :class="$style.detail_list">
					<Flex
						v-for="(p, pi) in formatScope(capability.scope).patterns"
						:key="pi"
						align="start"
						gap="6"
					>
						<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
						<Flex direction="column" gap="3">
							<Text v-if="String(p.contract) === '*'" size="12" color="secondary">Any contract</Text>
							<ScopeAddress v-else :address="String(p.contract)" />
							<Flex align="center" gap="6">
								<Text size="11" color="tertiary">fn:</Text>
								<Text size="11" weight="600" color="secondary" :class="$style.mono">
									{{ String(p.function) === "*" ? "*" : fnLabel(String(p.function)) }}
								</Text>
								<Text v-if="String(p.function) !== '*' && getMethodLabel(String(p.function))" size="11" color="tertiary">
									· {{ getMethodLabel(String(p.function)) }}
								</Text>
							</Flex>
						</Flex>
					</Flex>
				</Flex>
			</Flex>
			<!-- Load-bearing invariant: dapp-interaction/service.ts:354-362 forces -->
			<!-- the execute popup for every sendTx under default policy. Editing -->
			<!-- this line is a security-relevant change; the capability-meta test -->
			<!-- pins the equivalent description copy too. -->
			<Text size="11" color="tertiary" :style="{ lineHeight: '1.3' }">
				Each transaction still requires your approval
			</Text>
		</template>

		<!-- data -->
		<template v-else-if="capability.type === 'data'">
			<Flex direction="column" gap="4" :class="$style.detail_list">
				<Flex v-if="capability.addressBook" align="center" gap="6">
					<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
					<Text size="12" color="secondary">Read address book</Text>
				</Flex>
				<Flex align="center" gap="6">
					<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
					<Text size="12" color="secondary">
						Register senders (adds an entry to your wallet's local registry for event decryption)
					</Text>
				</Flex>
			</Flex>
			<Flex v-if="capability.privateEvents" direction="column" gap="4">
				<Text size="12" weight="600" color="secondary">Read private events from:</Text>
				<Flex
					v-if="capability.privateEvents.contracts === '*'"
					align="center"
					gap="6"
					:class="$style.detail_list"
				>
					<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
					<Text size="12" color="secondary">Any contract</Text>
				</Flex>
				<Flex
					v-else-if="Array.isArray(capability.privateEvents.contracts)"
					direction="column"
					gap="8"
					:class="$style.detail_list"
				>
					<Flex
						v-for="(addr, ai) in capability.privateEvents.contracts"
						:key="ai"
						align="start"
						gap="6"
					>
						<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
						<ScopeAddress :address="String(addr)" />
					</Flex>
				</Flex>
			</Flex>
		</template>

		<!-- unknown -->
		<template v-else>
			<Flex direction="column" gap="6">
				<Text size="12" color="secondary">
					This wallet doesn't recognize this permission. Reject if you don't know what it does.
				</Text>
				<Flex align="center" gap="6">
					<Text size="11" color="tertiary">type:</Text>
					<Text size="11" weight="600" color="secondary" :class="$style.mono">
						{{ sanitizeWireString(String((capability as { type: string }).type), 32) }}
					</Text>
				</Flex>
			</Flex>
		</template>
	</Flex>
</template>

<style module>
.panel {
	background: var(--nulo-surface-low);
	padding: 12px;
	line-height: 1.5;
}

.granted {
	opacity: 0.7;
}

.detail_list {
	padding-left: 4px;
}

.bullet {
	flex-shrink: 0;
	line-height: 1.5;
}

.mono {
	font-family: var(--font-mono);
	letter-spacing: 0.04em;
}
</style>
