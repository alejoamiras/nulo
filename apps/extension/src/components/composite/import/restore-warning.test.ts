import { describe, expect, test } from "vitest"
import { restoreWarningText } from "./restore-warning"

describe("restoreWarningText", () => {
	test.each([
		[
			"one network",
			["Alpha V5"],
			false,
			"Alpha V5 didn't answer in time, so what was saved for it may not be restored. You can retry or continue.",
		],
		[
			"two networks",
			["Alpha V5", "Testnet"],
			false,
			"Alpha V5 and Testnet didn't answer in time, so what was saved for them may not be restored. You can retry or continue.",
		],
		[
			"three networks",
			["Alpha V5", "Testnet", "Local Network"],
			false,
			"Alpha V5, Testnet, and Local Network didn't answer in time, so what was saved for them may not be restored. You can retry or continue.",
		],
		[
			"a network and another error",
			["Alpha V5"],
			true,
			"Alpha V5 didn't answer in time, so what was saved for it may not be restored. You can retry, review the details, or continue.",
		],
		["other errors only", [], true, "Profile import completed with some errors. You can review the details or continue."],
	])("%s", (_, names, hasOtherErrors, sentence) => {
		expect(restoreWarningText(names, hasOtherErrors)).toBe(sentence)
	})
})
