<script setup lang="ts">
/**
 * Identity strip for the execute window — thin caller over the shared
 * `IdentityStrip` frame. Owns the execute-specific branching: the payload
 * may target multiple accounts / chains, in which case the strip shows
 * "{N} accounts · MIXED" (warn-colored) so the user knows the request will
 * be signed across more than one account before they hit Confirm.
 */
import IdentityStrip from "@/components/composite/IdentityStrip.vue"
import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"

const props = defineProps<{
	signerAccounts: Account[]
	signerNetworks: Network[]
	status: "ready" | "loading" | "cancelled"
}>()

const accountLabel = computed(() => {
	if (props.signerAccounts.length === 1) return props.signerAccounts[0].name
	if (props.signerAccounts.length > 1) return `${props.signerAccounts.length} accounts`
	return "No signer"
})

const networkLabel = computed(() => {
	if (props.signerAccounts.length === 1) return props.signerNetworks[0]?.name ?? ""
	if (props.signerAccounts.length > 1) return "MIXED"
	return undefined // no-signer branch renders the account label alone
})

const warn = computed(() => props.signerAccounts.length > 1)
</script>

<template>
	<IdentityStrip :accountLabel="accountLabel" :networkLabel="networkLabel" :status="status" :warn="warn" />
</template>
