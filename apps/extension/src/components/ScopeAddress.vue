<script setup lang="ts">
/**
 * Trust-aware address renderer used inside the capability popup's
 * scope rows. Differs from `<AddressDisplay>` in three ways:
 *
 *   1. Raw trimmed address is ALWAYS primary. Contact-book names render
 *      as a parenthetical annotation, never as a replacement. The
 *      capabilities popup is the moment the user commits to a session
 *      grant — masking the underlying address behind a local label
 *      (which an attacker can socially engineer the user into setting)
 *      is unacceptable trust surface.
 *   2. Both the raw address and the contact name pass through
 *      `sanitizeWireString` (strips bidi-control + non-printables,
 *      length-clamps). The wire address SHOULD be clean hex, but a
 *      hostile dApp could send anything; the contact name is
 *      user-controlled but the user could have pasted an attack
 *      payload.
 *   3. Click writes the untrimmed address to the clipboard, passed
 *      through `stripWireControl` (strip-but-don't-clamp) first. The
 *      user gets the full verifiable on-chain value — not the cosmetic
 *      `0x1234…cdef` display, and never with attacker-injected bidi /
 *      zero-width bytes riding along.
 *
 * Lives in the flat `src/components/` tier (NOT `composite/`) because
 * the `managers.contact` lookup violates L3's `@/utils/core` ban. Tier
 * peer: `AddressDisplay.vue`.
 */
import { onMounted } from "vue"
import { managers } from "@/utils/core"
import { trimAddress } from "@/utils/string"
import { sanitizeWireString, stripWireControl } from "@/wallet/services/dapp-session/capability-meta"

const props = defineProps<{ address: string }>()

const { openToast } = useToast()

const contactName = ref<string>("")

onMounted(async () => {
	if (!props.address) return
	const contact = await managers.contact.getContactByAddress(props.address)
	if (contact?.name) {
		contactName.value = sanitizeWireString(contact.name, 32)
	}
})

function handleClick() {
	// Strip invisible / control chars before clipboard, but DO NOT truncate.
	// The user sees a trimmed display and expects to copy the full value; the
	// strip step keeps an attacker from injecting bidi-overrides etc. into
	// what the user pastes. (codex post-impl §3)
	window.navigator.clipboard.writeText(stripWireControl(props.address))
	openToast({ label: "Address is copied", icon: "copy" })
}
</script>

<template>
	<span
		data-testid="scope-address"
		:data-scope-addr="address"
		@click="handleClick"
		@keydown.enter="handleClick"
		role="button"
		tabindex="0"
		:class="$style.row"
	>
		<span :class="$style.addr">{{ sanitizeWireString(trimAddress(address), 128) }}</span>
		<span v-if="contactName" :class="$style.contact">(@{{ contactName }})</span>
	</span>
</template>

<style module>
.row {
	display: inline-flex;
	align-items: center;
	gap: 6px;

	cursor: pointer;
	outline: none;
	word-break: break-all;
	line-height: 1.4;

	transition: color 0.15s var(--bezier);

	&:hover .addr,
	&:focus-visible .addr {
		color: var(--txt-primary);
	}
}

.addr {
	font-family: var(--font-mono);
	font-size: 12px;
	color: var(--nulo-secondary);
}

.contact {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-secondary);
}
</style>
