<script setup>
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
			>
				<template #suffix>
					<button
						type="button"
						@click="isPasswordType = !isPasswordType"
						:class="$style.visibility_btn"
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
						<Text size="12" weight="600" color="tertiary">{{ strengthHint }}</Text>
					</Flex>
				</template>
			</Input>
			<Input
				v-model="repeatedPassword"
				:type="isPasswordType ? 'password' : 'text'"
				:maxLength="maxPasswordLength"
				placeholder="Repeat password"
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

.visibility_btn {
	display: flex;
	align-items: center;
	justify-content: center;
	background: transparent;
	border: none;
	cursor: pointer;
	padding: 4px 0 4px 8px;
}

.hint_row {
	margin-top: 4px;
}
</style>
