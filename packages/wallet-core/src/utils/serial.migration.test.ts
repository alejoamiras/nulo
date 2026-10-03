/**
 * Temporary migration evidence: each of the seven queue sites' hand-written chains, copied verbatim,
 * against the policy it migrates to. Removed once the migration's green results are logged.
 */
import { describe, expect, test } from "vitest"
import { createSerialQueue } from "./serial"

const CAP = 2_000
type Run = (op: () => Promise<unknown>) => Promise<unknown>

async function trace(make: () => Run, reports: string[]): Promise<string> {
	const log: string[] = []
	let ticks = 0
	let stopped = false
	let exhausted = false
	const spin = () => {
		if (stopped) return
		if (++ticks >= CAP) {
			exhausted = true
			return
		}
		queueMicrotask(spin)
	}
	queueMicrotask(spin)
	try {
		const run = make()
		const settleAfter = (jobs: number, value: unknown, reject: boolean) =>
			new Promise((resolve, fail) => {
				let n = 0
				const step = () => (++n >= jobs ? (reject ? fail(value) : resolve(value)) : queueMicrotask(step))
				queueMicrotask(step)
			})
		const ops = [
			{ name: "a", jobs: 2, reject: false, sync: false },
			{ name: "b", jobs: 1, reject: true, sync: false },
			{ name: "c", jobs: 3, reject: false, sync: false },
			{ name: "d", jobs: 1, reject: false, sync: true },
			{ name: "rethrow", jobs: 1, reject: true, sync: false },
			{ name: "f", jobs: 2, reject: false, sync: false },
		]
		await Promise.all(
			ops.map(({ name, jobs, reject, sync }) =>
				run(() => {
					log.push(`${ticks}:start:${name}`)
					if (sync) throw `sync-${name}`
					return settleAfter(jobs, name, reject)
				}).then(
					(v) => log.push(`${ticks}:ok:${name}:${String(v)}`),
					(e) => log.push(`${ticks}:err:${name}:${String(e)}`),
				),
			),
		)
		await settleAfter(20, undefined, false)
	} finally {
		stopped = true
	}
	if (exhausted) throw new Error(`the spinner ran out of its ${CAP}-job budget`)
	return `${log.join(" ")} | ${reports.join(" ")}`
}

function reporter(reports: string[]) {
	return (error: unknown) => {
		reports.push(String(error))
		if (error === "rethrow") throw "rethrown"
	}
}

const noop = () => {}

/** Each site's inline chain, verbatim apart from its names, paired with the migrated form. */
const SITES: Record<string, { inline: (report: (e: unknown) => void) => Run; migrated: (report: (e: unknown) => void) => Run }> = {
	"fee-send-selection": {
		inline: () => {
			let chain: Promise<void> = Promise.resolve()
			return (step) => {
				const link = chain.then(step as () => Promise<void>, step as () => Promise<void>)
				chain = link.catch(() => undefined)
				return link
			}
		},
		migrated: () => {
			const queue = createSerialQueue()
			return (op) => queue.run(op)
		},
	},
	"guarded-network-activation": {
		inline: () => {
			let tail: Promise<unknown> = Promise.resolve()
			return (fn) => {
				const run = tail.then(() => fn())
				tail = run.then(
					() => undefined,
					() => undefined,
				)
				return run
			}
		},
		migrated: () => {
			const queue = createSerialQueue()
			return (fn) => queue.run(() => fn())
		},
	},
	seeder: {
		inline: () => {
			let markerLock: Promise<void> = Promise.resolve()
			return (fn) => {
				const run = markerLock.then(fn)
				markerLock = run.then(
					() => undefined,
					() => undefined,
				)
				return run
			}
		},
		migrated: () => {
			const queue = createSerialQueue()
			return (fn) => queue.run(fn)
		},
	},
	logger: {
		inline: () => {
			let storageOps: Promise<void> = Promise.resolve()
			return (op) => {
				const next = storageOps.then(op as () => Promise<void>, op as () => Promise<void>).catch(() => {})
				storageOps = next
				return next
			}
		},
		migrated: () => {
			const queue = createSerialQueue({ onError: noop })
			return (op) => queue.run(op)
		},
	},
	offscreen: {
		inline: () => {
			let closeTail: Promise<void> = Promise.resolve()
			return (close) => {
				const link = closeTail.then(() => close()).catch(() => {}) as Promise<void>
				closeTail = link
				return link
			}
		},
		migrated: () => {
			const queue = createSerialQueue({ onError: noop })
			return (close) => queue.run(() => close())
		},
	},
	"scan-episodes": {
		inline: (report) => {
			let writeChain: Promise<void> = Promise.resolve()
			return (write) => {
				writeChain = writeChain.then(write as () => Promise<void>).catch((error) => report(error))
				return writeChain
			}
		},
		migrated: (report) => {
			const queue = createSerialQueue({ onError: (error) => report(error) })
			return (write) => queue.run(write)
		},
	},
	price: {
		inline: (report) => {
			let configTransition: Promise<void> = Promise.resolve()
			return (body) => {
				configTransition = configTransition
					.then(async () => {
						await body()
					})
					.catch((err) => report(err))
				return configTransition
			}
		},
		migrated: (report) => {
			const queue = createSerialQueue({ onError: (err) => report(err) })
			return (body) =>
				queue.run(async () => {
					await body()
				})
		},
	},
}

describe("the seven queue sites, inline against migrated (temporary)", () => {
	test.each(Object.keys(SITES))("%s", async (site) => {
		const inlineReports: string[] = []
		const inline = await trace(() => SITES[site].inline(reporter(inlineReports)), inlineReports)
		const migratedReports: string[] = []
		const migrated = await trace(() => SITES[site].migrated(reporter(migratedReports)), migratedReports)
		expect(migrated).toEqual(inline)
	})
})
