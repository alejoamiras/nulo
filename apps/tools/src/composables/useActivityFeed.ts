import { computed } from "vue"
import {
	type ActivityAction,
	type ActivityGroup,
	ageWords,
	classify,
	groupRecords,
	needsYouCount,
	phaseWord,
	routeWords,
	rowStrings,
	visibilityWords,
} from "@/lib/activity"
import { useNow } from "@/lib/clock"
import { recordState } from "@/lib/record-policy"
import { useBridgeJournal } from "./useBridgeJournal"
import { useBridgeWallet } from "./useBridgeWallet"

export interface ActivityRowModel {
	id: string
	createdAt: number
	direction: "deposit" | "withdraw"
	group: ActivityGroup
	action: ActivityAction
	/** True for a needs-you row the card alone can resolve (blocked, terminal, stuck before send). */
	blocked: boolean
	/** The canonical account a SWITCH row switches to; null unless the action is `switch`. */
	switchTarget: string | null
	phase: string
	amount: string
	symbol: string
	route: string
	visibility: string
	age: string
}

/**
 * The dock's one data source: every record the wizard is NOT showing, read through the shared
 * policy. `visibleRecords` already omits the foregrounded record — its stepper is that record's one
 * surface. Everything reactive is read inside the computed, the clock included, so a row's age
 * ticks and an engine patch re-derives its row.
 */
export function useActivityFeed() {
	const journal = useBridgeJournal()
	const wallet = useBridgeWallet()
	const now = useNow()

	const rows = computed<ActivityRowModel[]>(() => {
		const view = { status: wallet.status.value, selectedAccount: wallet.selectedAccount.value, accounts: wallet.accounts.value }
		return journal.visibleRecords.value.map((rec) => {
			const rt = journal.runtime.value[rec.id] ?? {}
			const state = recordState(rec, rt, view)
			const { group, action } = classify(rec, state)
			const strings = rowStrings(rec)
			return {
				id: rec.id,
				createdAt: rec.createdAt,
				direction: rec.direction,
				group,
				action,
				blocked: group === "needs-you" && action === null,
				switchTarget: action === "switch" ? state.switchTarget : null,
				phase: phaseWord(rec, rt),
				amount: strings.amount,
				symbol: strings.symbol,
				route: routeWords(rec),
				visibility: visibilityWords(rec),
				age: ageWords(rec.createdAt, now.value),
			}
		})
	})

	const grouped = computed(() => groupRecords(rows.value))
	const count = computed(() => needsYouCount(rows.value))
	/** Ids the dock may open itself for: needs-you rows with something the dock can offer. */
	const autoOpenIds = computed(() => rows.value.filter((r) => r.group === "needs-you" && !r.blocked).map((r) => r.id))
	const liveIds = computed(() => new Set(journal.records.value.map((r) => r.id)))

	return { rows, grouped, count, autoOpenIds, liveIds }
}

export type ActivityFeed = ReturnType<typeof useActivityFeed>
