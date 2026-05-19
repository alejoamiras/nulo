import type { Ref } from "vue"

export function useSyncedRef<T>(key: string, defaultValue: T): Ref<T>
