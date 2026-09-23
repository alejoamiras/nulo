import type { ActivityRowModel } from "@/composables/useActivityFeed"

/** A needs-you CLAIM row; override what the case is about. */
export function rowModel(over: Partial<ActivityRowModel> = {}): ActivityRowModel {
	return {
		id: "rec-1",
		createdAt: 1,
		direction: "deposit",
		group: "needs-you",
		action: "claim",
		blocked: false,
		switchTarget: null,
		phase: "claim",
		amount: "0.5",
		symbol: "WETH",
		route: "ETH → Aztec",
		visibility: "public + gas",
		age: "26m ago",
		...over,
	}
}
