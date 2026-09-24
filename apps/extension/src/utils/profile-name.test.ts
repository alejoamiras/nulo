import { describe, expect, test } from "vitest"
import { useProfileNameField } from "@/composables/useProfileNameField"
import { defaultProfileName, normalizeProfileName } from "./profile-name"

describe("defaultProfileName", () => {
	test.each([
		[[], "Main"],
		[["Main"], "Profile 2"],
		[["Main", "Work"], "Profile 3"],
		// Bumped past a variant that only differs by case or NFKC form.
		[["Main", "profile 2"], "Profile 3"],
		[["Main", "Ｐｒｏｆｉｌｅ 2", "PROFILE 3"], "Profile 4"],
	])("%j → %s", (existing, expected) => {
		expect(defaultProfileName(existing)).toBe(expected)
	})

	test("always passes the name field's validation against the same list", () => {
		const lists = [[], ["Main"], ["Main", "profile 2", "Profile 3"], Array.from({ length: 999 }, (_, i) => `Profile ${i + 2}`)]
		for (const existing of lists) {
			const field = useProfileNameField()
			field.profileName.value = defaultProfileName(existing)
			expect(field.validate({ existingNames: existing })).toBe(true)
		}
	})
})

describe("normalizeProfileName", () => {
	test("folds case and compatibility forms, not scripts", () => {
		expect(normalizeProfileName("ﬂow")).toBe(normalizeProfileName("FLOW"))
		expect(normalizeProfileName("Аlpha")).not.toBe(normalizeProfileName("Alpha"))
	})
})
