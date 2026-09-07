<script setup lang="ts">
/** Components */
import EmojiGrid from "@/components/composite/general/EmojiGrid.vue"

/** Vendor */
import { onMounted, onUnmounted } from "vue"
import { hashToEmoji } from "@aztec/wallet-sdk/crypto"

/** Services */
import { DappSessionServiceClient, type DappSession, type DappMetadata } from "@/wallet/services/dapp-session/client"
import { type Account, AccountServiceClient } from "@/wallet/services/account/client"
import { NetworkServiceClient, type Network } from "@/wallet/services/network/client"
import { parseCaipAccount, resolveNetworkByChainId } from "@/wallet/utils/caip"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { trimAddress } from "@/utils/string"
const appStore = useAppStore()

type UIDappMetadata = DappMetadata & {
	loadingLogo?: boolean
	logoBlobUrl?: string
}

const router = useRouter()

const session = ref<DappSession>()
const dapp = ref<UIDappMetadata>()
const emojis = ref("")
const isReconnect = ref(false)
const alwaysTrust = ref(false)

/** Signer resolution for the identity strip. */
const signerAccounts = ref<Account[]>([])
const signerDisplay = computed(() => {
	if (signerAccounts.value.length === 1) return signerAccounts.value[0].name
	if (signerAccounts.value.length > 1) return `${signerAccounts.value.length} accounts`
	// Fallback: trimmed address from first CAIP string
	const first = session.value?.accounts?.[0]
	if (!first) return "No account"
	const addr = first.split(":")[2] ?? ""
	return trimAddress(addr, 6, 4, "...")
})
const signerNetwork = computed(() => {
	if (signerAccounts.value.length === 1) {
		const acc = signerAccounts.value[0]
		return typeof acc.chainId === "number" ? `chain ${acc.chainId}` : String(acc.chainId ?? "")
	}
	if (signerAccounts.value.length > 1) return "MIXED"
	return ""
})

/** Anti-phishing: normalized hostname + IDN / punycode flag. */
const dappHostname = computed(() => {
	if (!dapp.value?.url) return ""
	try {
		return new URL(dapp.value.url).hostname
	} catch {
		return dapp.value.url
	}
})
const hostnameHasNonAscii = computed(() => {
	const h = dappHostname.value
	for (const ch of h) {
		if (ch.charCodeAt(0) > 127) return true
	}
	return h.split(".").some((label) => label.startsWith("xn--"))
})

const dappSessionService = new DappSessionServiceClient()

const handleConfirm = async () => {
	if (alwaysTrust.value && session.value) {
		await dappSessionService.setTrustedVerification(session.value.id, true)
	}
	closeWindow()
}

const closeWindow = () => {
	chrome.windows.getCurrent(undefined, (window) => {
		if (window.id) {
			chrome.windows.remove(window.id)
		}
	})
}

async function resolveSigners() {
	if (!session.value?.accounts?.length || !appStore.profile) return
	const networkService = new NetworkServiceClient()
	const accountService = new AccountServiceClient()
	try {
		const resolved: Account[] = []
		for (const caip of session.value.accounts) {
			let parsed: { chainId: number; address: string }
			try {
				parsed = parseCaipAccount(caip)
			} catch {
				continue
			}
			let network: Network
			try {
				network = await resolveNetworkByChainId(networkService, parsed.chainId)
			} catch {
				continue
			}
			const account = await accountService.getAccount(appStore.profile.id, network.chainId, parsed.address)
			if (account) resolved.push(account)
		}
		signerAccounts.value = resolved
	} finally {
		networkService.disconnect()
		accountService.disconnect()
	}
}

onMounted(async () => {
	dappSessionService.connect()

	// Wait for app to establish session before resolving signer names.
	if (!appStore.isSessionChecked) {
		await new Promise<void>((resolve) => {
			const stop = watch(
				() => appStore.isSessionChecked,
				(checked) => {
					if (checked) {
						stop()
						resolve()
					}
				},
				{ immediate: true },
			)
		})
	}

	const sessionId = router.currentRoute.value.query.sessionId as string
	// Per-session snapshot the SW passes when opening this window (B-06). A concurrent
	// session for the same (origin,chain) can overwrite the shared DappSession row's
	// hash, so the trust-decision emojis MUST derive from THIS session's own hash, not
	// the row's. The row hash is only a legacy fallback for opens without the param.
	const snapshotHash = router.currentRoute.value.query.verificationHash as string | undefined
	isReconnect.value = router.currentRoute.value.query.isReconnect === "true"

	if (!sessionId) {
		closeWindow()
		return
	}

	try {
		session.value = await dappSessionService.getDappSession(sessionId)
		if (!session.value) {
			closeWindow()
			return
		}

		const displayHash = snapshotHash || session.value.verificationHash
		if (displayHash) {
			emojis.value = hashToEmoji(displayHash)
		}

		// Hydrate dApp logo
		dapp.value = session.value.dappMetadata
		if (dapp.value?.logo) {
			dapp.value.logoBlobUrl = dapp.value.logo
		}

		// Resolve wallet-local signer name(s) for the identity strip
		await resolveSigners()
	} catch {
		closeWindow()
	}
})

onUnmounted(() => {
	dappSessionService.disconnect()
})
</script>

<template>
	<Flex v-if="session" direction="column" :class="$style.wrapper">
		<!-- Identity strip: anti-phishing trust anchor. Status is always ready on verify. -->
		<IdentityStrip
			:accountLabel="signerDisplay"
			:networkLabel="signerNetwork || undefined"
			:warn="signerAccounts.length > 1"
		/>

		<Flex direction="column" :class="$style.scroll_area">
			<!-- dApp identity block -->
			<DappIdentityBlock
				:dapp="dapp"
				:hostname="dappHostname"
				:hostnameSuspicious="hostnameHasNonAscii"
				:actionLabel="isReconnect ? 'Reconnected' : 'Connection established'"
			/>
			<!-- Verification section -->
			<Flex v-if="emojis" direction="column" gap="12" :class="$style.verification">
				<SectionLabel label="Connection verification" />

				<Flex direction="column" align="center" gap="12">
					<div data-testid="verify-emoji-grid"><EmojiGrid :emojis="emojis" /></div>
					<Text size="12" color="secondary" :style="{ textAlign: 'center', lineHeight: '1.4' }">
						Verify these emojis match what the app displays to confirm a secure connection
					</Text>
				</Flex>
			</Flex>
		</Flex>

		<!-- Footer: trust toggle + OK -->
		<Flex direction="column" gap="12" :class="$style.footer">
			<Flex align="center" justify="between" gap="12" wide>
				<Flex direction="column" gap="4">
					<Text size="13" weight="600" color="primary">Always trust</Text>
					<Text size="12" weight="500" color="tertiary">Skip verification on reconnect</Text>
				</Flex>
				<div data-testid="verify-always-trust-toggle"><Toggle :modelValue="alwaysTrust" @update:modelValue="(v: boolean) => (alwaysTrust = v)" /></div>
			</Flex>

			<Button data-testid="verify-confirm-btn" @click="handleConfirm" wide variant="primary" size="medium" :disabled="!session">
				<Text size="13" color="inverse">OK</Text>
			</Button>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	composes: approval_wrapper from "../window-shell.module.css";
}

.scroll_area {
	composes: scroll_area from "../window-shell.module.css";
}

/* ── Verification section ──────────────────────────────────────── */

.verification {
	padding: 16px;
}

/* ── Footer ────────────────────────────────────────────────────── */

.footer {
	flex-shrink: 0;

	padding: 16px;
	border-top: 1px solid var(--nulo-border);
	background: var(--nulo-surface);
}
</style>
