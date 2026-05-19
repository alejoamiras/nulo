<script setup>
/** Services */
import { FpcServiceClient, FpcType } from "@/wallet/services/fpc/client"

/** Utils */
import { stringCompare } from "@/utils/string"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
	payload: Object,
})

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.select_fpc?.order
})

let fpcService = null
const selectedFpc = ref()
const allFpcs = ref([])
const fpcs = computed(() => {
	const order = (type) => (type === "sponsored" ? 0 : 1)
	return allFpcs.value
		?.filter((f) => f.type === FpcType.DefaultSponsoredFpc || f.type === FpcType.PrivateFpc)
		.map((f) => prepareFpc(f))
		.sort((a, b) => {
			const typeOrder = order(a.typeName) - order(b.typeName)
			return typeOrder ? typeOrder : stringCompare(a.name, b.name)
		})
})

const isLoading = ref(false)
const error = ref()
const init = async () => {
	isLoading.value = true
	error.value = ""

	try {
		fpcService = new FpcServiceClient()
		fpcService.onFpcAdded.add(onFpcAdded)
		fpcService.onFpcDeleted.add(onFpcDeleted)
		fpcService.onFpcUpdated.add(onFpcUpdated)
		allFpcs.value = await fpcService.getFpcs(appStore.network.chainId)
	} catch (err) {
		error.value = err
	} finally {
		isLoading.value = false
	}
}

const handleSelectFpc = (fpc) => {
	const methodIx = cacheStore.feePaymentMethods.findIndex((m) => m.id === props.payload?.id)
	if (methodIx === -1) {
		cacheStore.feePaymentMethods.push({
			id: props.payload?.id,
			fpc: fpc,
		})
	} else {
		cacheStore.feePaymentMethods[methodIx].fpc = fpc
	}
	emit("onClose")
}

const prepareFpc = (fpc) => {
	if (fpc.type === FpcType.DefaultSponsoredFpc) return { ...fpc, typeName: "sponsored" }
	if (fpc.type === FpcType.PrivateFpc) return { ...fpc, typeName: "private" }
	return { ...fpc, typeName: "fpc" }
}
const onFpcAdded = (fpc) => {
	allFpcs.value.push(prepareFpc(fpc))
}
const onFpcUpdated = (fpc) => {
	const idx = allFpcs.value?.findIndex((f) => f.id === fpc.id)
	if (idx === -1) return
	allFpcs.value[idx] = prepareFpc(fpc)
}
const onFpcDeleted = (fpc) => {
	allFpcs.value = allFpcs.value?.filter((f) => f.id !== fpc.id)
}
watch(
	() => props.show,
	async () => {
		if (props.show) {
			selectedFpc.value = cacheStore.feePaymentMethods.find((m) => m.id === props.payload?.id)?.fpc
			await init()
		}
	},
)
</script>

<template>
	<Popup :show @onClose="emit('onClose')" :displaceIdx=popupStore.popups.select_fpc?.order>
		<PopupCard :displaceIdx>
			<Flex
				wide
				direction="column"
				justify="between"
				gap="16"
				:class="$style.wrapper"
			>
				<Flex align="center" justify="between" gap="16">
					<Text size="14" weight="600" color="primary">
						Select FPC
					</Text>
				</Flex>

				<LoadingState v-if="isLoading" label="FETCHING FPCS" />

				<Banner v-else-if="!fpcs?.length" wide>
					No FPC found, get started by adding new Fee Payment Contract
				</Banner>

				<Tooltip v-else-if="error" wide>
					<Banner :action="{ name: 'Try again', callback: () => init() }" variant="error" wide>
						Something went wrong
					</Banner>

					<template #content>
						{{ error }}
					</template>
				</Tooltip>

				<Flex v-else direction="column" gap="6">
					<Flex
						v-for="fpc in fpcs"
						:key="fpc.id"
						@click="handleSelectFpc(fpc)"
						align="center"
						justify="between"
						gap="12"
						:class="$style.fpc"
					>
						<Flex align="center" gap="10" wide>
							<Icon
								:name="
									selectedFpc?.id === fpc.id
										? 'check-circle'
										: 'circle'
								"
								size="16"
								:color="
									selectedFpc?.id === fpc.id
										? 'green'
										: 'tertiary'
								"
							/>

							<Flex direction="column" gap="4" wide>
								<Text size="14" weight="600" color="primary" :class="$style.title">
									{{ fpc.name || fpc.address }}
								</Text>
								<Text v-if="fpc.name" size="13" weight="600" color="tertiary" :class="$style.description">
									{{ fpc.address }}
								</Text>
							</Flex>
						</Flex>
					</Flex>
				</Flex>

				<Button
					@click="popupStore.open('new_fpc')"
					wide
					variant="primary_outline"
					size="medium"
					leftIcon="plus-circle"
					leftIconColor="primary"
				>
					New FPC
				</Button>
			</Flex>
		</PopupCard>
	</Popup>
</template>

<style module>
.wrapper {
	flex: 1;

	padding: 0 20px 24px 20px;
}

.fpc {
	border-radius: 0;
	cursor: pointer;
	border: 1px solid var(--nulo-border);

	min-height: 58px;

	padding: 12px;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-low);
		border: 1px solid var(--nulo-outline);
		& .icons {
			opacity: 1;
		}
	}

	&:active {
		background: var(--nulo-surface-high);
	}
}

.title {
	min-width: 100%;
	width: 0;

	line-height: 16px !important;

	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;
}

.description {
	min-width: 100%;
	width: 0;

	line-height: 14px !important;

	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;
}
</style>
