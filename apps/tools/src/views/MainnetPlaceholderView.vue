<script setup lang="ts">
/** Utils */
import { TESTIDS } from "@/lib/testids"

/**
 * The whole mainnet app. It mounts no wallet session, reaches no node and reads no manifest — the
 * build's CSP allows no remote origin at all, so anything beyond these three links would silently
 * fail rather than degrade.
 */
const LINKS = [
	{ label: "nulo.sh", href: "https://nulo.sh" },
	{ label: "Get the extension", href: import.meta.env.VITE_NULO_INSTALL_URL ?? "https://nulo.sh" },
	{ label: "Docs", href: "https://github.com/alejoamiras/nulo" },
] as const
</script>

<template>
	<main class="placeholder" :data-testid="TESTIDS.mainnetPlaceholder">
		<h1>BRIDGING IS BEING UPGRADED</h1>
		<p class="sub">Back with the next mainnet generation.</p>
		<p class="links">
			<a
				v-for="link in LINKS"
				:key="link.href"
				:href="link.href"
				target="_blank"
				rel="noopener noreferrer"
				:data-testid="TESTIDS.mainnetPlaceholderLink"
			>{{ link.label }}</a>
		</p>
	</main>
</template>

<style scoped>
.placeholder {
	max-width: 760px;
	margin: 0 auto;
	padding: 120px 32px 96px;
	display: flex;
	flex-direction: column;
	gap: 16px;
	color: var(--txt-primary);
}

.placeholder h1 {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 44px;
	letter-spacing: -0.02em;
	line-height: 1.04;
	margin: 0;
}

.sub {
	margin: 0;
	max-width: 52ch;
	color: var(--txt-secondary);
	font-size: 16px;
	line-height: 1.55;
}

.links {
	display: flex;
	flex-wrap: wrap;
	gap: 20px;
	margin: 8px 0 0;
	font: 500 13px/1 var(--font-mono);
}

.links a {
	color: var(--nulo-accent);
	text-decoration: underline;
	text-underline-offset: 3px;
}

.links a:hover {
	color: var(--txt-primary);
}
</style>
