<route lang="json">
{ "meta": { "title": "Welcome" } }
</route>

<script setup lang="ts">
const router = useRouter()

const goCreate = () => router.push("/onboarding/create")
const goImport = () => router.push("/onboarding/import")
</script>

<template>
	<Flex direction="column" align="center" :class="$style.page">
		<header :class="$style.hero">
			<h1 :class="$style.title">Welcome to Nulo.</h1>
			<p :class="$style.subtitle">A private wallet for Aztec.</p>
		</header>

		<Flex direction="column" gap="16" :class="$style.choices">
			<button
				type="button"
				:class="[$style.choice, $style.primary]"
				data-testid="onboarding-welcome-create"
				@click="goCreate"
			>
				<span :class="$style.choiceTitle">Create a new wallet</span>
				<span :class="$style.choiceBody">Takes about a minute.</span>
			</button>

			<button
				type="button"
				:class="$style.choice"
				data-testid="onboarding-welcome-import"
				@click="goImport"
			>
				<span :class="$style.choiceTitle">Import an existing wallet</span>
				<span :class="$style.choiceBody">Restore from a seed, key, or backup.</span>
			</button>
		</Flex>
	</Flex>
</template>

<style module>
.page {
	max-width: 560px;
	width: 100%;
	margin: 64px auto 0;
	gap: 48px;
}

.hero {
	text-align: center;
}

.title {
	font-size: 36px;
	letter-spacing: -0.02em;
	font-weight: 600;
	margin: 0 0 8px;
	color: var(--app-text);
}

.subtitle {
	font-size: 17px;
	color: var(--text-secondary, #8a8a8a);
	margin: 0;
}

.choices {
	width: 100%;
}

.choice {
	display: flex;
	flex-direction: column;
	gap: 6px;
	width: 100%;
	padding: 24px 28px;
	border-radius: 12px;
	border: 1px solid var(--border-color, #2a2a2a);
	background: var(--surface, #121212);
	color: var(--app-text);
	text-align: left;
	cursor: pointer;
	transition: border-color 140ms ease, background 140ms ease, transform 80ms ease;
	font: inherit;
}
.choice:hover {
	border-color: var(--app-text);
}
.choice:active {
	transform: translateY(1px);
}
.primary {
	border-color: var(--app-text);
}

.choiceTitle {
	font-size: 17px;
	font-weight: 600;
}

.choiceBody {
	font-size: 14px;
	color: var(--text-secondary, #8a8a8a);
}
</style>
