import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import type { PrestoCopy } from "@/utils/presto-ui-state"
import PrestoStatusCard from "./PrestoStatusCard.vue"

const connected: PrestoCopy = { tone: "go", title: "Presto connected", detail: "Proving natively · Presto 1.1.1", retry: "Re-test" }
const blocked: PrestoCopy = {
	tone: "warn",
	title: "Your browser blocked local access",
	detail: "Allow local network access for Nulo, then retry.",
	steps: ["Click the icon.", "Set Local network to Allow.", "Press Retry."],
	retry: "Retry",
}
const looking: PrestoCopy = { tone: "pending", title: "Looking…", detail: "" }

type Props = InstanceType<typeof PrestoStatusCard>["$props"]
const factory = (props: Props) => mount(PrestoStatusCard, { props })

describe("PrestoStatusCard", () => {
	test("renders the title and detail", () => {
		const w = factory({ copy: connected, status: "available" })
		expect(w.text()).toContain("Presto connected")
		expect(w.text()).toContain("Proving natively · Presto 1.1.1")
	})

	test("exposes the state kind and diagnosis as data attributes on the testid root", () => {
		const w = factory({ copy: blocked, status: "secure-connection-unavailable", diagnosis: "https-disabled", testid: "card" })
		const root = w.find('[data-testid="card"]')
		expect(root.attributes("data-status")).toBe("secure-connection-unavailable")
		expect(root.attributes("data-diagnosis")).toBe("https-disabled")
	})

	test("the tone drives the card class", () => {
		expect(
			factory({ copy: connected, status: "available" })
				.classes()
				.some((c) => c.includes("tone_go")),
		).toBe(true)
		expect(
			factory({ copy: blocked, status: "permission-blocked" })
				.classes()
				.some((c) => c.includes("tone_warn")),
		).toBe(true)
	})

	test("the retry button carries the copy's label and testid and emits retry", async () => {
		const w = factory({ copy: connected, status: "available", retryTestid: "retry" })
		const button = w.find('[data-testid="retry"]')
		expect(button.text()).toBe("Re-test")
		await button.trigger("click")
		expect(w.emitted("retry")).toHaveLength(1)
	})

	test("no retry button while the copy names none (pending)", () => {
		const w = factory({ copy: looking, status: "detecting", retryTestid: "retry" })
		expect(w.find('[data-testid="retry"]').exists()).toBe(false)
		expect(w.find("button").exists()).toBe(false)
	})

	test("the pending dot pulses; a settled dot does not", () => {
		expect(
			factory({ copy: looking, status: "detecting" })
				.find("span")
				.classes()
				.some((c) => c.includes("pulse")),
		).toBe(true)
		expect(
			factory({ copy: connected, status: "available" })
				.find("span")
				.classes()
				.some((c) => c.includes("pulse")),
		).toBe(false)
	})

	test("an empty detail renders no detail line", () => {
		const w = factory({ copy: looking, status: "detecting" })
		expect(w.findAll("span").map((s) => s.text())).toEqual(["", "Looking…"])
	})

	test("steps render numbered 01…, in order", () => {
		const w = factory({ copy: blocked, status: "permission-blocked" })
		const items = w.findAll("li")
		expect(items).toHaveLength(3)
		expect(items[0].text()).toBe("01Click the icon.")
		expect(items[2].text()).toBe("03Press Retry.")
	})

	test("no steps list without steps", () => {
		expect(factory({ copy: connected, status: "available" }).find("ol").exists()).toBe(false)
	})

	test("compact moves the retry button under the text and still emits", async () => {
		const w = factory({ copy: connected, status: "available", compact: true, retryTestid: "retry" })
		expect(w.classes().some((c) => c.includes("compact"))).toBe(true)
		const buttons = w.findAll("button")
		expect(buttons).toHaveLength(1)
		expect(buttons[0].classes().some((c) => c.includes("retry_inline"))).toBe(true)
		await buttons[0].trigger("click")
		expect(w.emitted("retry")).toHaveLength(1)
	})

	test("omitted testids leave the attributes off the DOM", () => {
		const w = factory({ copy: connected, status: "available" })
		expect(w.attributes("data-testid")).toBeUndefined()
		expect(w.find("button").attributes("data-testid")).toBeUndefined()
	})
})
