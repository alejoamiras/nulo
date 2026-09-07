import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, test, vi } from "vitest"

const push = vi.hoisted(() => vi.fn())
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }))

import OnboardingBackLink from "./OnboardingBackLink.vue"
const MaterialIcon = { props: ["name", "size"], template: `<i :data-name="name" :data-size="size" />` }

beforeEach(() => push.mockClear())

describe("OnboardingBackLink", () => {
	test("renders the chevron and the Back label under the page's testid", () => {
		const w = mount(OnboardingBackLink, { props: { testid: "onboarding-create-back" }, global: { stubs: { MaterialIcon } } })
		expect(w.attributes("type")).toBe("button")
		expect(w.attributes("data-testid")).toBe("onboarding-create-back")
		expect(w.find("i").attributes("data-name")).toBe("chevron_left")
		expect(w.find("i").attributes("data-size")).toBe("14")
		expect(w.find("span").text()).toBe("Back")
	})

	test("a click routes back to the welcome step", async () => {
		const w = mount(OnboardingBackLink, { props: { testid: "onboarding-import-back" }, global: { stubs: { MaterialIcon } } })
		await w.trigger("click")
		expect(push).toHaveBeenCalledTimes(1)
		expect(push).toHaveBeenCalledWith("/onboarding/welcome")
	})
})
