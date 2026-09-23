<script setup lang="ts">
import type { Scope, ScopePattern } from "@nulo/wallet-bridge"
import ScopeAddress from "@/components/ScopeAddress.vue"
import { getMethodLabel } from "@/utils/tx-enrichment"
import { sanitizeWireString } from "@/wallet/services/dapp-session/capability-meta"

const props = defineProps<{ scope: Scope }>()

function formatScope(scope: Scope): { isWildcard: boolean; patterns: ScopePattern[] } {
	if (scope === "*") return { isWildcard: true, patterns: [] }
	if (Array.isArray(scope)) return { isWildcard: false, patterns: scope }
	return { isWildcard: true, patterns: [] }
}

/** Friendly labels are lossy (several raw ids share one), so the sanitized raw id always renders and a label only annotates it; 64 covers every builtin name. */
function fnLabel(fn: string): string {
	return sanitizeWireString(fn, 64)
}

const formatted = computed(() => formatScope(props.scope))
</script>

<template>
	<Flex
		v-if="formatted.isWildcard"
		align="center"
		gap="6"
		:class="$style.detail_list"
	>
		<Text size="12" color="tertiary" :class="$style.bullet">&#x2022;</Text>
		<Text size="12" color="secondary">Any contract, any function</Text>
	</Flex>
	<Flex v-else direction="column" gap="10" :class="$style.detail_list">
		<Flex
			v-for="(p, pi) in formatted.patterns"
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
					<Text v-if="String(p.function) !== '*' && getMethodLabel(String(p.function), String(p.contract))" size="11" color="tertiary">
						· {{ getMethodLabel(String(p.function), String(p.contract)) }}
					</Text>
				</Flex>
			</Flex>
		</Flex>
	</Flex>
</template>

<style module>
.detail_list {
	composes: detail_list from "./capability-shared.module.css";
}

.bullet {
	composes: bullet from "./capability-shared.module.css";
}

.mono {
	composes: mono from "./capability-shared.module.css";
}
</style>
