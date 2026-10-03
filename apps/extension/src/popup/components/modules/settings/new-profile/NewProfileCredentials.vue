<script setup>
import PasswordVisibilityToggle from "@/components/composite/PasswordVisibilityToggle.vue"
/**
 * Credentials section for the create-profile page in `password` mode:
 * a new-password input + repeat input + a small strength hint. Owns
 * the visibility toggle internally.
 */
const props = defineProps({
	maxPasswordLength: { type: Number, default: 128 },
	strengthHint: { type: String, default: "" },
})

const password = defineModel("password", { type: String, default: "" })
const repeatedPassword = defineModel("repeatedPassword", { type: String, default: "" })

const isPasswordType = ref(true)
</script>

<template>
	<div :class="$style.section_last">
		<span :class="$style.section_label">Password</span>
		<Flex direction="column" gap="12">
			<Input
				v-model="password"
				:type="isPasswordType ? 'password' : 'text'"
				:maxLength="maxPasswordLength"
				placeholder="Strong password"
				autofocus
				data-testid="register-password-input"
			>
				<template #suffix>
					<PasswordVisibilityToggle
						:hidden="isPasswordType"
						data-testid="register-password-input-visibility-toggle"
						@toggle="isPasswordType = !isPasswordType"
					/>
				</template>
				<template #bottom>
					<Flex align="center" gap="6" :class="$style.hint_row">
						<MaterialIcon name="lock" :size="12" color="tertiary" />
						<Text size="12" weight="600" color="tertiary">{{ strengthHint }}</Text>
					</Flex>
				</template>
			</Input>
			<Input
				v-model="repeatedPassword"
				:type="isPasswordType ? 'password' : 'text'"
				:maxLength="maxPasswordLength"
				placeholder="Repeat password"
				data-testid="register-password-confirm-input"
			/>
		</Flex>
	</div>
</template>

<style module>
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

.hint_row {
	margin-top: 4px;
}
</style>
