import { createField, type Field, renderFrame, subjectAt } from "./feed"

const MAX_COLS = 240
const MAX_ROWS = 80
const FRAME_MS = 33
const RECORD_ROWS = 16
const FONT_WAIT_MS = 2500
const BOX_LABELS = ["SUBJECT · NOTHING TO SEE", "ENHANCING…", "STILL NOTHING", "SUBJECT · NOTHING TO SEE"]

type Cell = { width: number; height: number }

type Feed = {
	pre: HTMLPreElement
	host: HTMLElement
	gain: number
	subject: boolean
	drift: number
	cols: number
	rows: number
	cell: Cell
	visible: boolean
}

/** Shared by the frame loop, the record stream and the clock, so Pause and a hidden tab stop all three. */
type Run = { paused: boolean }

const halted = (run: Run): boolean => run.paused || document.hidden

const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches

/** Wrong until the mono face has loaded, hence the re-measure on `fonts.ready`. */
function measureCell(pre: HTMLPreElement): Cell {
	const probe = document.createElement("span")
	probe.textContent = "M".repeat(50)
	probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:inherit"
	pre.appendChild(probe)
	const width = probe.getBoundingClientRect().width / 50 || 7.2
	probe.remove()
	const height = Number.parseFloat(getComputedStyle(pre).lineHeight) || 14
	return { width, height }
}

function sizeFeed(feed: Feed): void {
	feed.cell = measureCell(feed.pre)
	feed.cols = Math.min(MAX_COLS, Math.ceil(feed.host.clientWidth / feed.cell.width) + 1)
	feed.rows = Math.min(MAX_ROWS, Math.ceil(feed.host.clientHeight / feed.cell.height) + 1)
}

/** The box follows the subject across the rendered grid, which the column cap can leave narrower than the host. */
function placeBox(box: HTMLElement | null, feed: Feed | undefined, time: number): void {
	if (!box || !feed) return
	const p = subjectAt(time)
	const left = p.x * feed.cols * feed.cell.width
	const top = p.y * feed.rows * feed.cell.height
	box.style.cssText = `left:${left.toFixed(0)}px;top:${top.toFixed(0)}px`
}

function drawFeed(feed: Feed, field: Field, time: number, pan: { x: number; y: number }): void {
	feed.pre.textContent = renderFrame(field, {
		cols: feed.cols,
		rows: feed.rows,
		time,
		offsetX: pan.x + time * feed.drift,
		offsetY: pan.y + time * feed.drift * 0.35,
		gain: feed.gain,
		subject: feed.subject,
	})
}

function hex4(): string {
	return Math.floor(Math.random() * 65536)
		.toString(16)
		.padStart(4, "0")
}

/** Illustrative entries only: the shapes are real (nullifier, commitment, log), the values are random. */
function recordLine(index: number): HTMLElement {
	const line = document.createElement("div")
	if (index % 9 === 0) {
		line.className = "record__public"
		line.textContent = `public     40.00 USDC → 0x${hex4()}…${hex4()}  (you chose this one)`
		return line
	}
	const kind = ["nullifier ", "commitment", "log       "][index % 3] as string
	const label = document.createElement("b")
	label.textContent = kind
	line.append(label, ` 0x${hex4()}…${hex4()}${index % 3 === 2 ? " (encrypted)" : ""}`)
	return line
}

function startRecord(list: HTMLElement, counter: HTMLElement, run: Run | null): void {
	let count = 4312
	let index = 0
	const add = () => {
		list.prepend(recordLine(index++))
		while (list.children.length > RECORD_ROWS) list.lastChild?.remove()
		count++
		counter.textContent = `${count.toLocaleString("en-US")} entries`
	}
	list.replaceChildren()
	for (let i = 0; i < 12; i++) add()
	if (run) setInterval(() => halted(run) || add(), 900)
}

const pad2 = (n: number): string => String(n).padStart(2, "0")

function startClock(el: HTMLElement, run: Run): void {
	const tick = () => {
		if (halted(run)) return
		const d = new Date()
		const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
		el.textContent = `${date} ${d.toTimeString().slice(0, 8)}`
	}
	tick()
	setInterval(tick, 1000)
}

const fontsReady = (): Promise<unknown> => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))])

function collectFeeds(): Feed[] {
	return [...document.querySelectorAll<HTMLPreElement>("pre[data-feed]")].map((pre) => ({
		pre,
		host: pre.closest<HTMLElement>("[data-feed-host]") ?? document.documentElement,
		gain: Number(pre.dataset.gain ?? 1),
		subject: pre.dataset.feed === "hero",
		drift: Number(pre.dataset.drift ?? 1),
		cols: 1,
		rows: 1,
		cell: { width: 7.2, height: 14 },
		visible: true,
	}))
}

function watchVisibility(feeds: Feed[]): void {
	const byHost = new Map(feeds.filter((f) => f.host !== document.documentElement).map((f) => [f.host, f]))
	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			const feed = byHost.get(entry.target as HTMLElement)
			if (feed) feed.visible = entry.isIntersecting
		}
	})
	for (const host of byHost.keys()) observer.observe(host)
}

function trackPointer(hero: HTMLElement | null, target: { x: number; y: number }): void {
	hero?.addEventListener("mousemove", (e) => {
		const r = hero.getBoundingClientRect()
		target.x = (((e.clientX - r.left) / r.width) * 2 - 1) * 6
		target.y = (((e.clientY - r.top) / r.height) * 2 - 1) * 3
	})
	hero?.addEventListener("mouseleave", () => {
		target.x = 0
		target.y = 0
	})
}

function startLoop(feeds: Feed[], field: Field, hero: HTMLElement | null, run: Run): void {
	const box = document.querySelector<HTMLElement>("[data-box]")
	const label = document.querySelector<HTMLElement>("[data-box-label]")
	const heroFeed = feeds.find((f) => f.subject)
	const pan = { x: 0, y: 0 }
	const target = { x: 0, y: 0 }
	trackPointer(hero, target)
	const t0 = performance.now()
	let last = 0
	const frame = (now: number) => {
		requestAnimationFrame(frame)
		if (halted(run) || now - last < FRAME_MS) return
		last = now
		const time = (now - t0) / 1000
		pan.x += (target.x - pan.x) * 0.08
		pan.y += (target.y - pan.y) * 0.08
		for (const feed of feeds) if (feed.visible) drawFeed(feed, field, time, pan)
		placeBox(box, heroFeed, time)
		if (label) label.textContent = BOX_LABELS[Math.floor(time / 3) % BOX_LABELS.length] as string
	}
	requestAnimationFrame(frame)
}

function wirePause(run: Run): void {
	const button = document.querySelector<HTMLButtonElement>("[data-pause]")
	if (!button) return
	button.addEventListener("click", () => {
		run.paused = !run.paused
		button.textContent = run.paused ? "Play" : "Pause"
		button.setAttribute("aria-pressed", String(run.paused))
		document.documentElement.classList.toggle("is-paused", run.paused)
	})
}

export async function mountPage(): Promise<void> {
	const feeds = collectFeeds()
	const field = createField(0x6e756c6f)
	const still = reducedMotion()
	const layout = () => {
		for (const feed of feeds) sizeFeed(feed)
		if (!still) return
		for (const feed of feeds) drawFeed(feed, field, 0, { x: 0, y: 0 })
		placeBox(
			document.querySelector<HTMLElement>("[data-box]"),
			feeds.find((f) => f.subject),
			0,
		)
	}
	await fontsReady()
	layout()
	document.fonts.ready.then(layout)
	addEventListener("resize", layout)
	const list = document.querySelector<HTMLElement>("[data-record]")
	const counter = document.querySelector<HTMLElement>("[data-record-count]")
	const clock = document.querySelector<HTMLElement>("[data-clock]")
	if (still) {
		document.querySelector("[data-pause]")?.remove()
		if (list && counter) startRecord(list, counter, null)
		if (clock) startClock(clock, { paused: false })
		return
	}
	const run: Run = { paused: false }
	if (list && counter) startRecord(list, counter, run)
	if (clock) startClock(clock, run)
	wirePause(run)
	watchVisibility(feeds)
	startLoop(feeds, field, document.querySelector<HTMLElement>("[data-feed-host='hero']"), run)
}
