import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import OnboardingExplainer from "./OnboardingExplainer.vue"
import OnboardingSkipLink from "./OnboardingSkipLink.vue"

const stubs = {
	OnboardingPage: { props: ["gap"], template: `<div data-testid="page" :data-gap="gap"><slot /></div>` },
	StepIndicator: { props: ["current"], template: `<i data-testid="step" :data-current="current" />` },
	BrutalistTitle: { props: ["main", "sub"], template: `<h1>{{ main }} · {{ sub }}</h1>` },
	Flex: { inheritAttrs: false, template: `<div v-bind="$attrs"><slot /></div>` },
	Text: { inheritAttrs: false, template: `<span v-bind="$attrs"><slot /></span>` },
	Button: { inheritAttrs: false, template: `<button v-bind="$attrs"><slot /></button>` },
}

const cards = [
	{ number: "01", title: "Public and private state", body: "You decide what's shared." },
	{ number: "02", title: "Proofs on your machine", body: "The network only ever sees the proof." },
	{ number: "03", title: "Proofs take time", body: "10 to 30 seconds in the browser." },
]

const mountExplainer = () =>
	mount(OnboardingExplainer, {
		props: {
			step: 2,
			titleMain: "Meet",
			titleSub: "Aztec",
			lede: "Three things to know before your first transaction.",
			cards,
			continueTestid: "onboarding-learn-continue",
			skipTestid: "onboarding-learn-skip",
		},
		global: { stubs, components: { OnboardingSkipLink } },
	})

describe("OnboardingExplainer", () => {
	test("renders the cards in order with their number, title and body", () => {
		const articles = mountExplainer().findAll("article")
		expect(articles).toHaveLength(3)
		articles.forEach((article, i) => {
			const spans = article.findAll("span")
			expect(spans[0]?.text()).toBe(cards[i]?.number)
			expect(spans[1]?.text()).toBe(cards[i]?.title)
			expect(spans[2]?.text()).toBe(cards[i]?.body)
		})
	})

	test("passes the step to the indicator and the wide gap to the page", () => {
		const w = mountExplainer()
		expect(w.find("[data-testid='step']").attributes("data-current")).toBe("2")
		expect(w.find("[data-testid='page']").attributes("data-gap")).toBe("40")
	})

	test("renders the title pair and the lede in the hero", () => {
		const w = mountExplainer()
		expect(w.find("h1").text()).toBe("Meet · Aztec")
		expect(w.text()).toContain("Three things to know before your first transaction.")
	})

	test("continue carries the page's testid and emits continue", async () => {
		const w = mountExplainer()
		const button = w.find("[data-testid='onboarding-learn-continue']")
		expect(button.text()).toBe("Continue")
		await button.trigger("click")
		expect(w.emitted("continue")).toHaveLength(1)
		expect(w.emitted("skip")).toBeUndefined()
	})

	test("the skip link says Skip intro, carries the page's testid and emits skip", async () => {
		const w = mountExplainer()
		const link = w.find("[data-testid='onboarding-learn-skip']")
		expect(link.text()).toBe("Skip intro")
		await link.trigger("click")
		expect(w.emitted("skip")).toHaveLength(1)
		expect(w.emitted("continue")).toBeUndefined()
	})
})
