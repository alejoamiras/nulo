import { Flex, Input, MaterialIcon, Text } from "@nulo/design"
import { mount, type VueWrapper } from "@vue/test-utils"
import { afterEach, describe, expect, test } from "vitest"
import { enterOn, expectMaskToggle, expectNativeAttrs, nativeInput, typeNow } from "../../../../../../tests/helpers/credential-pins"
import NewProfileCredentials from "./NewProfileCredentials.vue"

const PAIR = ["register-password-input", "register-password-confirm-input"]
const mounted: VueWrapper[] = []
afterEach(() => {
	for (const w of mounted.splice(0)) w.unmount()
})

function mountCredentials(props: Record<string, unknown> = {}) {
	const w = mount(NewProfileCredentials, {
		props: { maxPasswordLength: 128, strengthHint: "At least 8 characters", ...props },
		attachTo: document.body,
		global: { components: { Flex, Input, MaterialIcon, Text } },
	})
	mounted.push(w)
	return w
}

describe("NewProfileCredentials", () => {
	test("one toggle masks both fields", async () => {
		await expectMaskToggle(mountCredentials(), { toggle: "register-password-input-visibility-toggle", field: PAIR[0], drives: PAIR })
	})

	test("the first field is focused on mount; neither field names an autocomplete", () => {
		const w = mountCredentials()
		expect(document.activeElement).toBe(nativeInput(w, PAIR[0]))
		for (const id of PAIR) expectNativeAttrs(w, id, { autocomplete: null, autocapitalize: null, autocorrect: null })
	})

	test("typing updates each model and emits nothing else", () => {
		const w = mountCredentials()
		typeNow(nativeInput(w, PAIR[0]), "first-password")
		typeNow(nativeInput(w, PAIR[1]), "second-password")
		expect(w.emitted("update:password")?.at(-1)).toEqual(["first-password"])
		expect(w.emitted("update:repeatedPassword")?.at(-1)).toEqual(["second-password"])
		expect(
			Object.keys(w.emitted())
				.filter((k) => k.startsWith("update:"))
				.sort(),
		).toEqual(["update:password", "update:repeatedPassword"])
		// VTU also records the two native `input` events bubbling through the root; nothing is re-emitted on top.
		const inputs = w.emitted("input") ?? []
		expect(inputs).toHaveLength(2)
		for (const [ev] of inputs) expect((ev as Event).target).toBeInstanceOf(HTMLInputElement)
	})

	test("the hint under the first field is the strengthHint prop", () => {
		const w = mountCredentials({ strengthHint: "Passwords don't match" })
		expect(w.get(`[data-testid="${PAIR[0]}"]`).text()).toContain("Passwords don't match")
	})

	test("Enter in the repeat field reaches the page's root uncancelled", () => {
		const w = mountCredentials()
		const seen: boolean[] = []
		w.element.addEventListener("keydown", (e: Event) => seen.push(e.defaultPrevented))
		enterOn(nativeInput(w, PAIR[1]))
		expect(seen).toEqual([false])
	})
})
