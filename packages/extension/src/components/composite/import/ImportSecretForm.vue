<script setup>
/**
 * Renders the seed-phrase / plain-key / encrypted-key input plus the
 * matching password section (new+confirm for seed/private_key, single
 * existing password for public_key). The visibility toggles for both
 * the secret field and the password field are local state.
 *
 * Section labels carry the visual heading; individual Inputs run
 * label-less to avoid duplicating the heading text. Hints (strength,
 * "Correct" indicator) move under each input via the #bottom slot so
 * they share the same below-input rail the wrong-password error uses.
 */
const props = defineProps({
	method: { type: String, required: true }, // 'seed' | 'private_key' | 'public_key'
	error: { type: Object, default: () => ({ type: "", title: "", tooltip: "" }) },
	maxPasswordLength: { type: Number, default: 128 },
})

const emit = defineEmits(["secretInput", "passwordInput"])

const seedPhrase = defineModel("seedPhrase", { default: undefined })
const privateKey = defineModel("privateKey", { default: undefined })
const publicKey = defineModel("publicKey", { default: undefined })
const password = defineModel("password", { default: "" })
const repeatedPassword = defineModel("repeatedPassword", { default: "" })

const isPasswordType = ref(true)
const hideCredentials = ref(true)

const sectionLabel = computed(() => {
	if (props.method === "seed") return "Seed Phrase"
	if (props.method === "private_key") return "Plain Key"
	return "Encrypted Key"
})

const passwordSectionLabel = computed(() => (props.method === "public_key" ? "Password" : "New Password"))

const passwordHint = computed(() => {
	if (!password.value || password.value?.length < 8) return "At least 8 characters"
	if (password.value !== repeatedPassword.value) return "Passwords don't match"
	if (password.value?.length > 24) return "Long enough. Don't forget it."
	return "Strong password"
})
</script>

<template>
	<div :class="$style.section">
		<Flex align="center" gap="6">
			<span :class="$style.section_label">{{ sectionLabel }}</span>
			<Tooltip v-if="method === 'seed'" position="start">
				<Icon name="info" size="11" color="tertiary" hoverColor="primary" />
				<template #content>Words should be separated by spaces</template>
			</Tooltip>
		</Flex>

		<Input
			v-if="method === 'seed'"
			v-model="seedPhrase"
			data-testid="import-seed-input"
			@input="emit('secretInput')"
			:type="hideCredentials ? 'password' : 'text'"
			placeholder="Enter seed phrase"
		>
			<template #suffix>
				<button
					type="button"
					@click="hideCredentials = !hideCredentials"
					tabindex="-1" :class="$style.visibility_btn"
					:aria-label="hideCredentials ? 'Show seed phrase' : 'Hide seed phrase'"
				>
					<MaterialIcon
						:name="hideCredentials ? 'visibility' : 'visibility_off'"
						:size="18"
						color="secondary"
					/>
				</button>
			</template>
			<template v-if="seedPhrase?.split(' ').length === 24" #bottom>
				<Flex align="center" gap="4" :class="$style.hint_row">
					<Icon name="check-circle" size="12" color="green" />
					<Text size="12" weight="600" color="primary">Correct</Text>
				</Flex>
			</template>
		</Input>

		<template v-if="method === 'private_key'">
			<div :class="[error.type === 'secret' && $style.shake]">
				<Input
					v-model="privateKey"
					data-testid="import-private-key-input"
					:error="error.type === 'secret'"
					:ariaInvalid="error.type === 'secret'"
					@input="emit('secretInput')"
					:type="hideCredentials ? 'password' : 'text'"
					placeholder="Enter plain key"
				>
					<template #suffix>
						<button
							type="button"
							@click="hideCredentials = !hideCredentials"
							tabindex="-1" :class="$style.visibility_btn"
							:aria-label="hideCredentials ? 'Show key' : 'Hide key'"
						>
							<MaterialIcon
								:name="hideCredentials ? 'visibility' : 'visibility_off'"
								:size="18"
								color="secondary"
							/>
						</button>
					</template>
				</Input>
			</div>
			<Transition name="fade">
				<span
					v-if="error.type === 'secret'"
					:class="$style.error_text"
					role="alert"
					data-testid="import-private-key-error"
				>
					{{ error.title }}
				</span>
			</Transition>
		</template>

		<template v-if="method === 'public_key'">
			<div :class="[error.type === 'secret' && $style.shake]">
				<Input
					v-model="publicKey"
					data-testid="import-public-key-input"
					:error="error.type === 'secret'"
					:ariaInvalid="error.type === 'secret'"
					@input="emit('secretInput')"
					:type="hideCredentials ? 'password' : 'text'"
					placeholder="Enter encrypted key"
				>
					<template #suffix>
						<button
							type="button"
							@click="hideCredentials = !hideCredentials"
							tabindex="-1" :class="$style.visibility_btn"
							:aria-label="hideCredentials ? 'Show key' : 'Hide key'"
						>
							<MaterialIcon
								:name="hideCredentials ? 'visibility' : 'visibility_off'"
								:size="18"
								color="secondary"
							/>
						</button>
					</template>
				</Input>
			</div>
			<Transition name="fade">
				<span
					v-if="error.type === 'secret'"
					:class="$style.error_text"
					role="alert"
					data-testid="import-public-key-error"
				>
					{{ error.title }}
				</span>
			</Transition>
		</template>
	</div>

	<div :class="$style.section_last">
		<span :class="$style.section_label">{{ passwordSectionLabel }}</span>
		<Flex direction="column" gap="12">
			<template v-if="method === 'seed' || method === 'private_key'">
				<Input
					v-model="password"
					data-testid="import-password-input"
					:type="isPasswordType ? 'password' : 'text'"
					@input="emit('passwordInput')"
					:maxLength="maxPasswordLength"
					placeholder="Enter new password"
				>
					<template #suffix>
						<button
							type="button"
							@click="isPasswordType = !isPasswordType"
							tabindex="-1" :class="$style.visibility_btn"
							:aria-label="isPasswordType ? 'Show password' : 'Hide password'"
						>
							<MaterialIcon
								:name="isPasswordType ? 'visibility' : 'visibility_off'"
								:size="18"
								color="secondary"
							/>
						</button>
					</template>
					<template #bottom>
						<Flex align="center" gap="6" :class="$style.hint_row">
							<MaterialIcon name="lock" :size="12" color="tertiary" />
							<Text size="12" weight="600" color="tertiary">{{ passwordHint }}</Text>
						</Flex>
					</template>
				</Input>
				<Input
					v-model="repeatedPassword"
					data-testid="import-password-confirm-input"
					:type="isPasswordType ? 'password' : 'text'"
					@input="emit('passwordInput')"
					:maxLength="maxPasswordLength"
					placeholder="Repeat password"
				/>
			</template>

			<template v-else>
				<div :class="[error.type === 'password' && $style.shake]">
					<Input
						v-model="password"
						data-testid="import-password-input"
						:error="error.type === 'password'"
						:ariaInvalid="error.type === 'password'"
						:type="isPasswordType ? 'password' : 'text'"
						@input="emit('passwordInput')"
						:maxLength="maxPasswordLength"
						placeholder="Enter profile password"
					>
						<template #suffix>
							<button
								type="button"
								@click="isPasswordType = !isPasswordType"
								tabindex="-1" :class="$style.visibility_btn"
								:aria-label="isPasswordType ? 'Show password' : 'Hide password'"
							>
								<MaterialIcon
									:name="isPasswordType ? 'visibility' : 'visibility_off'"
									:size="18"
									color="secondary"
								/>
							</button>
						</template>
						<template v-if="!error.type && (!password || password?.length < 8)" #bottom>
							<Flex align="center" gap="6" :class="$style.hint_row">
								<MaterialIcon name="lock" :size="12" color="tertiary" />
								<Text size="12" weight="600" color="tertiary">At least 8 characters</Text>
							</Flex>
						</template>
					</Input>
				</div>
				<Transition name="fade">
					<span
						v-if="error.type === 'password'"
						:class="$style.error_text"
						role="alert"
						data-testid="import-password-error"
					>
						Wrong password
					</span>
				</Transition>
			</template>
		</Flex>

		<Flex v-if="error.type === 'unknown'" align="center" gap="8" :class="$style.unknown_error">
			<span :class="$style.error_tag">Error</span>
			<Text size="12" weight="600" color="secondary">{{ error.title }}</Text>
		</Flex>
	</div>
</template>

<style module>
/* No section-level border-bottom: each section's last child is an Input
 * whose `.base { border-bottom }` already underlines the section. The
 * extra divider produced two 1px lines stacked ~20px apart. */
.section {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 20px 0;
}

.section_last {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 20px 0;
}

.section_label {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.18em;
	color: var(--nulo-secondary);
}

.visibility_btn {
	display: flex;
	align-items: center;
	justify-content: center;
	background: transparent;
	border: none;
	cursor: pointer;
	padding: 4px 0 4px 8px;
}

.error_text {
	font-family: var(--font-body);
	font-size: 12px;
	color: var(--red);
	margin-top: 4px;
	display: block;
}

/* Below-input hint rail (strength meter, "Correct" indicator). Subtle
 * left margin keeps the row visually anchored to the input below it,
 * separate from the input's content edge. */
.hint_row {
	margin-top: 4px;
}

@keyframes shakeInput {
	0% { transform: translateX(0); }
	20% { transform: translateX(-4px); }
	40% { transform: translateX(4px); }
	60% { transform: translateX(-3px); }
	80% { transform: translateX(2px); }
	100% { transform: translateX(0); }
}

.shake { animation: shakeInput 0.3s ease; }

.unknown_error {
	margin-top: 12px;
}

.error_tag {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: var(--red);
	border: 1px solid var(--red);
	padding: 2px 6px;
	flex-shrink: 0;
}
</style>
