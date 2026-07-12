/** Persisted preference for which profile to surface on the lock screen and
 *  in the router fallback. Written whenever a profile becomes active
 *  (create / unlock / switch / import); read in app.vue's loadProfile,
 *  auth.vue's onMounted, and the router's guard. */
import { storageLocalGet, storageLocalSet } from "@/utils/storage"

const LAST_ACTIVE_PROFILE_KEY = "nulo:ui:lastActiveProfile"

export async function getLastActiveProfileId(): Promise<string | undefined> {
	const result = await storageLocalGet(LAST_ACTIVE_PROFILE_KEY)
	return result[LAST_ACTIVE_PROFILE_KEY] as string | undefined
}

export async function setLastActiveProfileId(id: string): Promise<void> {
	await storageLocalSet({ [LAST_ACTIVE_PROFILE_KEY]: id })
}
