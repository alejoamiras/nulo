<script setup>
/**
 * Renders the full-backup-restore form: file picker, error/warning
 * banners, decryption-password section (when the backup is encrypted),
 * and the new-profile-password section (when restoring a password
 * profile). Visibility toggles for the password fields are local.
 */
const props = defineProps({
	selectedBackup: { type: Object, default: null },
	restoreStatus: { type: [String, null], default: "" },
	isRestoreHasErrors: { type: Boolean, default: false },
	error: { type: Object, default: () => ({ type: "", title: "", tooltip: "" }) },
	isCopied: { type: Boolean, default: false },
	maxPasswordLength: { type: Number, default: 128 },
})

const emit = defineEmits(["pickFile", "copyError", "passwordInput"])

const decryptionPassword = defineModel("decryptionPassword", { default: "" })
const password = defineModel("password", { default: "" })
const repeatedPassword = defineModel("repeatedPassword", { default: "" })

const isPasswordType = ref(true)
const isDecryptionPasswordType = ref(true)

const passwordHint = computed(() => {
	if (!password.value || password.value?.length < 8) return "At least 8 characters"
	if (password.value !== repeatedPassword.value) return "Passwords don't match"
	if (password.value?.length > 24) return "Long enough. Don't forget it."
	return "Strong password"
})
</script>

<template>
	<div :class="$style.section">
		<span :class="$style.section_label">Backup File</span>
		<ItemsContainer flat>
			<SettingItem
				@click="emit('pickFile')"
				title="Choose a backup file"
				:description="selectedBackup ? selectedBackup.name : 'Select a .json or .txt file'"
				icon="package"
				:iconBgColor="error.type === 'full_backup' ? 'red' : selectedBackup ? 'blue' : 'gray'"
				chevron
				:disabled="restoreStatus === 'progress'"
				data-testid="import-full-backup-pick-file"
			/>
		</ItemsContainer>

		<Flex
			v-if="error.type === 'full_backup'"
			@click.stop="emit('copyError')"
			direction="column"
			gap="6"
			wide
			:class="$style.error_wrapper"
		>
			<Flex align="center" gap="8" :class="$style.error_title_wrapper">
				<span :class="$style.error_tag">Error</span>
				<Text size="12" weight="600" color="red" :class="$style.error_title">{{ error.title }}</Text>
				<Icon :name="isCopied ? 'check' : 'copy'" size="13" color="red" />
			</Flex>
			<Flex v-if="error.tooltip" align="start" :class="$style.error_description_wrapper" wide>
				<Text size="12" height="120" color="red" :class="$style.error_description">{{ error.tooltip }}</Text>
			</Flex>
		</Flex>

		<Flex
			v-if="restoreStatus === 'finished' && isRestoreHasErrors"
			direction="column"
			gap="4"
			:class="$style.warning_block"
			wide
		>
			<Flex align="center" gap="8">
				<span :class="[$style.error_tag, $style.error_tag_warning]">Warning</span>
				<Text size="12" weight="600" height="120" color="yellow">
					Profile import completed with some errors. You can review the details or continue.
				</Text>
			</Flex>
		</Flex>
	</div>

	<div v-if="selectedBackup?.type === 'encrypted' && !selectedBackup?.profileType" :class="$style.section">
		<span :class="$style.section_label">Decryption Password</span>
		<Input
			v-model="decryptionPassword"
			:type="isDecryptionPasswordType ? 'password' : 'text'"
			placeholder="Enter the password used to encrypt this backup"
			autofocus
		>
			<template #suffix>
				<button
					type="button"
					@click="isDecryptionPasswordType = !isDecryptionPasswordType"
					:class="$style.visibility_btn"
					:aria-label="isDecryptionPasswordType ? 'Show password' : 'Hide password'"
				>
					<MaterialIcon
						:name="isDecryptionPasswordType ? 'visibility' : 'visibility_off'"
						:size="18"
						color="secondary"
					/>
				</button>
			</template>
		</Input>
	</div>

	<div v-if="selectedBackup?.profileType === 'password' && !restoreStatus" :class="$style.section">
		<span :class="$style.section_label">New Password</span>
		<Flex direction="column" gap="12">
			<Input
				v-model="password"
				:type="isPasswordType ? 'password' : 'text'"
				@input="emit('passwordInput')"
				:maxLength="maxPasswordLength"
				placeholder="Enter new password"
				data-testid="import-full-backup-password-input"
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
						<Text size="12" weight="600" color="tertiary">{{ passwordHint }}</Text>
					</Flex>
				</template>
			</Input>
			<Input
				v-model="repeatedPassword"
				:type="isPasswordType ? 'password' : 'text'"
				@input="emit('passwordInput')"
				:maxLength="maxPasswordLength"
				placeholder="Repeat password"
				data-testid="import-full-backup-password-confirm-input"
			/>
			<Text size="12" weight="500" color="tertiary" height="150">
				Create a new password that will be used to log in to your profile in the future
			</Text>
		</Flex>
	</div>
</template>

<style module>
/* No section-level border-bottom: the SettingItem (file picker) and the
 * Input children already paint their own bottom borders, so the extra
 * divider stacked two 1px lines ~20px apart. */
.section {
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

.error_tag_warning {
	color: var(--yellow);
	border-color: var(--yellow);
}

.error_wrapper {
	margin-top: -4px;
	padding: 8px;
}

.warning_block {
	padding: 8px;
}

.error_title_wrapper {
	position: relative;

	.error_title {
		padding-right: 16px;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
		word-break: break-word;
		-webkit-line-clamp: 1;
	}

	& svg:last-child {
		position: absolute;
		top: 0;
		right: 0;
		opacity: 0.7;
	}
}

.error_description_wrapper {
	position: relative;

	.error_description {
		padding-right: 16px;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
		word-break: break-word;
		-webkit-line-clamp: 3;
	}
}
</style>
