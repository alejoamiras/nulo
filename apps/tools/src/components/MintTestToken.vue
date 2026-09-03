<script setup lang="ts">
/** Services */
import { awaitL1Receipt } from "@nulo/bridge-core"
import { Button, Card } from "@nulo/design"
import { computed, ref } from "vue"

/** Composables */
import { useL1Wallet } from "@/composables/useL1Wallet"

/** Utils */
import { MANIFEST_TOKENS } from "@/contracts/bridge-generation"
import { MINTABLE_ERC20_ABI } from "@/lib/erc20-abi"
import { NETWORK } from "@/lib/network"
import { TESTIDS } from "@/lib/testids"

/**
 * The Ethereum-side mint for a test token the manifest declares permissionless. It renders for
 * nothing else: only a token the generation itself lists can be trusted to expose `mint`, and the
 * amount is capped by the per-transaction limit that token was published with.
 */
const props = defineProps<{ erc20?: string }>()
const emit = defineEmits<{ minted: [] }>()

const WHOLE_PER_MINT = 100n

const l1 = useL1Wallet()
const minting = ref(false)
const error = ref<string | null>(null)

const token = computed(() => {
	const wanted = props.erc20?.toLowerCase()
	if (!wanted) return undefined
	const found = MANIFEST_TOKENS.find((t) => t.erc20.toLowerCase() === wanted)
	return found?.source === "permissionless-mint" ? found : undefined
})

const wholeAmount = computed(() => {
	const cap = token.value?.maxWholePerTx
	return cap !== undefined && BigInt(Math.floor(cap)) < WHOLE_PER_MINT ? BigInt(Math.floor(cap)) : WHOLE_PER_MINT
})

const status = computed(() => {
	if (error.value) return error.value
	return minting.value ? "Minting - confirm in your Ethereum wallet…" : null
})

async function mint(): Promise<void> {
	const t = token.value
	const wallet = l1.ensureWalletClient()
	const owner = l1.address.value
	if (!t) return
	if (!wallet || !owner) {
		error.value = "Connect your Ethereum wallet first."
		return
	}
	minting.value = true
	error.value = null
	try {
		const hash = await wallet.writeContract({
			address: t.erc20 as `0x${string}`,
			abi: MINTABLE_ERC20_ABI,
			functionName: "mint",
			args: [owner, wholeAmount.value * 10n ** BigInt(t.decimals)],
			chain: NETWORK.viemChain,
			account: owner,
		})
		// viem RESOLVES the receipt even on an on-chain revert - check status so a mined revert
		// surfaces as an error rather than a false "minted".
		const receipt = await awaitL1Receipt(l1.publicClient, hash)
		if (receipt.status !== "success") throw new Error("Mint transaction reverted on-chain.")
		emit("minted")
	} catch (e) {
		error.value = e instanceof Error ? e.message : "Mint failed"
	} finally {
		minting.value = false
	}
}
</script>

<template>
	<Card v-if="token" :data-testid="TESTIDS.mintL1Card">
		<header>
			<h3>GET TEST {{ token.displaySymbol }} ON {{ NETWORK.viemChain.name.toUpperCase() }}</h3>
			<p class="sub">
				Mints {{ wholeAmount }} test {{ token.displaySymbol }} to your Ethereum account - the asset this send moves.
				This is not the Faucet tab, which drips its own tokens directly on Aztec. No real value.
			</p>
		</header>

		<Button
			:loading="minting"
			:disabled="!l1.isConnected.value || minting"
			:data-testid="TESTIDS.mintL1"
			@click="mint"
		>
			{{ l1.isConnected.value ? `MINT ${wholeAmount} ${token.displaySymbol}` : "CONNECT YOUR ETHEREUM WALLET" }}
		</Button>

		<p v-if="status" class="status" :data-testid="TESTIDS.mintL1Status">{{ status }}</p>
	</Card>
</template>

<style scoped>
h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 16px;
	color: var(--txt-primary);
	margin: 0;
}

.sub {
	color: var(--txt-secondary);
	font-size: 13px;
	line-height: 1.55;
	margin: 4px 0 0;
	max-width: 70ch;
}

.status {
	margin: 0;
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}
</style>
