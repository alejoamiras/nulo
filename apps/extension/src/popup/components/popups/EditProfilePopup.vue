<script setup>
/** Services */
import { ProfileServiceClient } from "@/wallet/services/profile/client"

/** Composables */
import { useToast } from "@/composables/toast"
import { usePopupEntity } from "@/composables/usePopupEntity"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.edit_profile?.order
})

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

let profileService = null
const nameTerm = ref("")
const isStartedEditing = ref(false)
// Names of OTHER profiles (excluding the one being edited), NFKC + lowercase
// normalized, populated when the popup opens. Used to block updates that
// would shadow another profile's name — same case-folded NFKC compare as
// the F4 duplicate hard-block on Create/Import.
const otherProfileNames = ref([])

const handleFillFieldsWithDefaultValues = () => {
	nameTerm.value = appStore.profile?.name

	isStartedEditing.value = false
}

const isUnchanged = computed(() => appStore.profile.name.toLowerCase() === nameTerm.value.toLowerCase() && isStartedEditing.value)
const isCollision = computed(() => {
	if (!nameTerm.value || !isStartedEditing.value) return false
	const normalized = nameTerm.value.normalize("NFKC").toLocaleLowerCase()
	return otherProfileNames.value.includes(normalized)
})
const isAvailableToUpdateProfile = computed(() => {
	// The single submit-validity source for BOTH the button and the Enter path.
	// isStartedEditing must gate here (not only on the button): isUnchanged and
	// isCollision both require it, so without this gate a pre-edit Enter would
	// submit the unchanged name.
	if (!isStartedEditing.value) return
	if (!nameTerm.value?.length) return
	if (isUnchanged.value) return
	if (isCollision.value) return

	return true
})

const isProfileUpdateInProgress = ref(false)
const handleUpdateProfile = async () => {
	if (!isAvailableToUpdateProfile.value) return

	isProfileUpdateInProgress.value = true
	try {
		// Re-validate collision against a fresh getProfiles() inside the
		// in-progress latch. Closes the race where `otherProfileNames` was
		// still loading when the user clicked Update (initial population is
		// async; without this re-check a fast click could submit before the
		// list arrived). Service has no server-side uniqueness check, so
		// this is the only defense-in-depth path.
		const currentId = appStore.profile?.id
		const freshList = await profileService.getProfiles()
		const normalized = nameTerm.value.normalize("NFKC").toLocaleLowerCase()
		const collidesNow = freshList.some((p) => p.id !== currentId && p.name.normalize("NFKC").toLocaleLowerCase() === normalized)
		if (collidesNow) {
			otherProfileNames.value = freshList.filter((p) => p.id !== currentId).map((p) => p.name.normalize("NFKC").toLocaleLowerCase())
			isProfileUpdateInProgress.value = false
			return
		}
		appStore.profile = await profileService.changeProfileName(appStore.profile.id, nameTerm.value)
		emit("onClose")

		openToast({ label: "Profile is updated" })
	} catch (err) {
	} finally {
		isProfileUpdateInProgress.value = false
	}
}

usePopupEntity(() => props.show, {
	submit: handleUpdateProfile,
	onShow: async () => {
		profileService = new ProfileServiceClient()
		nameTerm.value = appStore.profile?.name
		// Populate the cross-profile collision list. Excludes the
		// current profile by id so renaming to the same name doesn't
		// trigger a false-positive collision. An Enter during this await is
		// safe: handleUpdateProfile re-validates against a fresh getProfiles()
		// inside its in-progress latch.
		const currentId = appStore.profile?.id
		const profiles = await profileService.getProfiles()
		otherProfileNames.value = profiles.filter((p) => p.id !== currentId).map((p) => p.name.normalize("NFKC").toLocaleLowerCase())
	},
	onHide: () => {
		profileService.disconnect()
		profileService = null
		nameTerm.value = ""
		isStartedEditing.value = false
		otherProfileNames.value = []
	},
})
</script>

<template>
	<Popup :show @onClose="emit('onClose')" :displaceIdx="popupStore.popups.edit_profile?.order">
		<PopupCard :displaceIdx>
			<PopupHeader @onClose="emit('onClose')" closable>
				<template #title>
					<Text size="14" weight="600" color="primary">Edit profile</Text>
				</template>
			</PopupHeader>

			<Flex wide direction="column" gap="24" :class="$style.wrapper">
				<ItemsContainer>
					<SettingItem
						size="large"
						:title="appStore.profile?.name"
						description="Profile for editing"
						icon="user"
						raw
					/>
				</ItemsContainer>

				<Input
					label="New name"
					placeholder="My Profile"
					v-model="nameTerm"
					autofocus
					sanitize
					:maxLength="32"
					@input="isStartedEditing = true"
					data-testid="profile-name-input"
				>
					<template #right>
						<Transition name="fade">
							<Flex v-if="isCollision" align="center" gap="6">
								<Icon name="warning" size="12" color="red" />
								<Text size="12" weight="600" color="primary"> Name in use </Text>
							</Flex>
							<Flex v-else-if="isUnchanged" align="center" gap="6">
								<Icon name="warning" size="12" color="red" />
								<Text size="12" weight="600" color="primary"> Already exist </Text>
							</Flex>
						</Transition>
					</template>
				</Input>

				<Flex direction="column" gap="12">
					<Button
						@click="handleUpdateProfile"
						wide
						variant="primary"
						size="medium"
						:disabled="!isAvailableToUpdateProfile"
						:loading="isProfileUpdateInProgress"
						data-testid="edit-profile-submit"
					>
						Update
					</Button>
					<Button @click="handleFillFieldsWithDefaultValues" wide variant="primary_outline" size="medium" data-testid="edit-profile-cancel">
						Reset changes
					</Button>
				</Flex>
			</Flex>
		</PopupCard>
	</Popup>
</template>

<style module>
.wrapper {
	padding: 0 20px 24px 20px;
}
</style>
