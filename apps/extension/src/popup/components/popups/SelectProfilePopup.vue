<script setup>
/** Composables */
import { useToast } from "@/composables/toast"

/** Utils */
import { ProfileServiceClient } from "@/wallet/services/profile/client"
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"
import { stringCompare } from "@/utils/string"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const { openToast } = useToast()

const router = useRouter()

const emit = defineEmits(["onSelectToken", "onClose"])
const props = defineProps({
	show: Boolean,
})

const profileService = new ProfileServiceClient()
profileService.onProfileAdded.add(onProfileAddedOrUpdated)
profileService.onProfileUpdated.add(onProfileAddedOrUpdated)
profileService.onProfileDeleted.add(onProfileDeleted)

const profiles = ref([])
const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.select_profile?.order
})

// B-09: serialize switches — two quick taps on different rows would otherwise
// both await `commitScopeChange` and race, with whichever's `refreshInFlight`
// resolved first winning rather than the last tap. Drop re-entry while a switch
// is in flight.
const isSwitching = ref(false)

const handleSelectProfile = async (profile) => {
	if (isSwitching.value) return
	isSwitching.value = true
	try {
		// A profile switch changes the active scope exactly like an account or
		// network switch, and a send in flight is still reading the current scope as
		// it builds and proves. Route through the same guard the other scope-mutating
		// call sites use (AccountsPopup, NewAccountPopup, …) instead of assigning
		// `appStore.profile` directly, and persist the last-active id only once the
		// switch is actually admitted.
		const switched = await appStore.commitScopeChange(() => {
			appStore.profile = profile
		})
		if (!switched) {
			openToast({ label: "Finish or cancel your pending transaction first", icon: "info" }, 3_000)
			return
		}
		await setLastActiveProfileId(profile.id)
		emit("onClose")
	} finally {
		isSwitching.value = false
	}
}

const handleImportProfile = () => {
	popupStore.closeAll()
	router.push("/popup/import?from=/popup/auth")
}

const handleCreateProfile = () => {
	popupStore.closeAll()
	router.push("/popup/profile/new?from=/popup/auth")
}

function onProfileAddedOrUpdated(profile) {
	const idx = profiles.value.findIndex((p) => p.id === profile.id)
	if (idx === -1) {
		profiles.value.push(profile)
	} else {
		profiles.value[idx] = profile
	}
}

function onProfileDeleted(profile) {
	const idx = profiles.value.findIndex((p) => p.id === profile.id)
	if (idx !== -1) {
		profiles.value.splice(idx, 1)
	}
}

watch(
	() => props.show,
	async () => {
		if (!props.show) {
			profileService?.disconnect()

			profiles.value = []
		} else {
			profiles.value = (await profileService.getProfiles())?.sort((a, b) => stringCompare(a.name, b.name))
		}
	},
)
</script>

<template>
	<Popup :show @onClose="emit('onClose')" :displaceIdx="popupStore.popups.select_profile?.order">
		<PopupCard :displaceIdx>
			<Flex wide direction="column" gap="16" :class="$style.wrapper">
				<Flex direction="column" gap="16">
					<Flex direction="column" align="center" gap="4" :class="$style.header">
						<h2 :class="$style.title">Select Profile</h2>
					</Flex>

					<ItemsContainer>
						<SettingItem
							v-for="profile in profiles"
							@click="handleSelectProfile(profile)"
							:title="profile.name"
							data-testid="select-profile-row"
							:data-profile-id="profile.id"
							:data-profile-name="profile.name"
						>
							<template #right>
								<Icon
									:name="
										profile?.id === appStore.profile?.id
											? 'check-circle'
											: 'circle'
									"
									size="16"
									:color="
										profile?.id === appStore.profile?.id
											? 'primary'
											: 'tertiary'
									"
								/>
							</template>
						</SettingItem>
					</ItemsContainer>

					<Flex wide direction="column" gap="8">
						<Button @click="handleCreateProfile" wide variant="primary" size="large" data-testid="select-profile-new-btn">
							New profile
						</Button>
						<Button @click="handleImportProfile" wide variant="primary_outline" size="large" data-testid="select-profile-import-btn">
							Import profile
						</Button>
					</Flex>
				</Flex>
			</Flex>
		</PopupCard>
	</Popup>
</template>

<style module>
.wrapper {
	padding: 0 20px 24px 20px;
}

.header {
	padding-top: 4px;
	padding-bottom: 4px;
}

.title {
	font-family: var(--font-headline);
	font-size: 16px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	text-align: center;

	color: var(--txt-primary);
	margin: 0;
}
</style>