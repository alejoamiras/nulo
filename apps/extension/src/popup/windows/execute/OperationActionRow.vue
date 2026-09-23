<script setup lang="ts">
import type { Action } from "@nulo/wallet-bridge"
import { humanizeMethodName } from "@/utils/tx-enrichment"
import { safeWire } from "./humanize"

defineProps<{ action: Action }>()
</script>

<template>
	<Text data-testid="execute-op-payload-row" size="12" color="primary">
		<template v-if="action.kind === 'call' || action.kind === 'encoded_call'">
			<Text weight="600">
				{{ humanizeMethodName(safeWire(action.kind === "call" ? action.method : (action.name ?? action.selector), 64)) }}
			</Text>
			<Text color="secondary"> on </Text>
			<AddressDisplay :address="action.kind === 'call' ? action.contract : action.to" />
		</template>
		<!-- A public authwit is a persisted on-chain spend authorization: the spender, method, contract and args
			must be visible, never a generic label. -->
		<template v-else-if="action.kind === 'add_public_authwit'">
			<Text weight="600">Authorize public spend</Text>
			<template v-if="action.content.kind === 'call'">
				<Text color="secondary"> — spender </Text>
				<AddressDisplay data-testid="execute-authwit-spender" :address="action.content.caller" />
				<Text color="secondary"> for </Text>
				<Text weight="600">{{ humanizeMethodName(safeWire(action.content.method, 64)) }}</Text>
				<Text color="secondary"> on </Text>
				<AddressDisplay :address="action.content.contract" />
				<template v-if="action.content.args?.length">
					<Text color="secondary"> args </Text>
					<Text data-testid="execute-authwit-args">{{ action.content.args.map((a) => safeWire(String(a), 48)).join(", ") }}</Text>
				</template>
			</template>
			<!-- Unreachable from today's grant producer (it hardcodes `call`); rendered so a future producer can
				never hide a spend target behind an opaque label. -->
			<template v-else-if="action.content.kind === 'encoded_call'">
				<Text color="secondary"> — spender </Text>
				<AddressDisplay data-testid="execute-authwit-spender" :address="action.content.caller" />
				<Text color="secondary"> for </Text>
				<Text weight="600">{{ humanizeMethodName(safeWire(action.content.name ?? action.content.selector, 64)) }}</Text>
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
