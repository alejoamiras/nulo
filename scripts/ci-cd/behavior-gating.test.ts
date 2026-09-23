/**
 * Anti-drift guard for the CI paths-filter gates.
 *
 * The smoke / network / build gates are DERIVED FROM THE DEPENDENCY GRAPH, not a
 * hand-curated list (see CI.md "CI gating" + implementations-plan/paths-filter-negation-fix/).
 * This test recomputes each gate's target graph from package.json and asserts the
 * live filter still covers it — so a new `@nulo/*` dependency added without gating
 * it, or a re-introduced `!` negation (the dorny `some`-quantifier footgun), fails CI.
 *
 * Wired into CI via the root `test:ci-gating` script in `_unit-tests.yml` — without
 * that step this guard would never run on a PR and the whole mechanism would be hollow.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
// apps/ vs packages/ split (FLAT layout): deployable leaves live under apps/, libs under packages/.
const APPS = new Set(["extension", "tools", "landing", "playground"])
const dirOf = (pkg: string): string => (APPS.has(pkg) ? "apps" : "packages")

/** Direct `@nulo/*` workspace deps of a package (runtime + dev — what it's built/tested from). */
function directDeps(pkg: string): string[] {
  const p = JSON.parse(readFileSync(join(ROOT, dirOf(pkg), pkg, "package.json"), "utf8"))
  return Object.keys({ ...p.dependencies, ...p.devDependencies })
    .filter((k) => k.startsWith("@nulo/"))
    .map((k) => k.slice("@nulo/".length))
}

/** Transitive `@nulo/*` dependency closure of a target (EXCLUDING the target itself). */
function transitiveDeps(target: string): string[] {
  const seen = new Set<string>()
  const walk = (pkg: string) => {
    for (const d of directDeps(pkg))
      if (!seen.has(d)) {
        seen.add(d)
        walk(d)
      }
  }
  walk(target)
  return [...seen].sort()
}

/** Parse a workflow's dorny `changes` filters — TWO-LEVEL (workflow YAML → the `with.filters` string), never regex. */
function filtersOf(workflow: string): Record<string, string[]> {
  // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
  const wf = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows", workflow), "utf8")) as any
  for (const job of Object.values(wf.jobs)) {
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    for (const step of (job as any).steps ?? []) {
      if (typeof step.uses === "string" && step.uses.includes("dorny/paths-filter") && step.with?.filters) {
        return Bun.YAML.parse(step.with.filters) as Record<string, string[]>
      }
    }
  }
  throw new Error(`no dorny/paths-filter step found in ${workflow}`)
}

/** A gate's pattern set must whole-package the target and src+manifest every transitive dep lib. */
function assertGraphCovered(patterns: string[], target: string, label: string) {
  expect(patterns, `${label}: target '${target}' must be whole-package gated`).toContain(`${dirOf(target)}/${target}/**`)
  for (const dep of transitiveDeps(target)) {
    expect(patterns, `${label}: dep lib '${dep}' src must be gated`).toContain(`packages/${dep}/src/**`)
    expect(patterns, `${label}: dep lib '${dep}' package.json must be gated`).toContain(`packages/${dep}/package.json`)
  }
}

const FILTER_WORKFLOWS = [
  "pr-quick.yml",
  "pr-extension-smoke-e2e.yml",
  "pr-extension-network-e2e.yml",
  "pr-extension-smoke-e2e-firefox.yml",
  "pr-extension-network-e2e-firefox.yml",
  "bridge-contracts.yml",
  "pr-tools-e2e.yml",
  "actionlint.yml",
]

/**
 * The check-run each PR workflow's aggregator job produces. Branch protection matches these BY
 * NAME (CLAUDE.md § Branching), so a renamed job that isn't repointed there blocks every merge —
 * this pin fails first. `required-checks.ts` renames the protection to the same names.
 */
const AGGREGATOR_CHECKS: Record<string, string> = {
  "pr-quick.yml": "quality-status",
  "pr-extension-smoke-e2e.yml": "extension-smoke-e2e-status",
  "pr-extension-network-e2e.yml": "extension-network-e2e-status",
  "pr-extension-smoke-e2e-firefox.yml": "extension-smoke-e2e-firefox-status",
  "pr-extension-network-e2e-firefox.yml": "extension-network-e2e-firefox-status",
  "bridge-contracts.yml": "bridge-contracts-status",
  "pr-tools-e2e.yml": "tools-e2e-status",
}

describe("CI aggregator check names", () => {
  test("each PR workflow's status job produces its documented check-run name", () => {
    for (const [file, name] of Object.entries(AGGREGATOR_CHECKS)) {
      // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
      const wf = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows", file), "utf8")) as any
      expect(wf.jobs.status?.name, `${file}: jobs.status.name`).toBe(name)
      expect(wf.jobs.status?.if, `${file}: the aggregator must always run`).toBe("always()")
    }
  })

  test("the protection runbook renames onto exactly these names", async () => {
    const { RENAMES } = await import("./required-checks")
    for (const target of Object.values(RENAMES)) {
      expect(Object.values(AGGREGATOR_CHECKS), `rename target '${target}' must be a produced check`).toContain(target)
    }
  })
})

describe("CI behavior-gating guard", () => {
  const smoke = filtersOf("pr-extension-smoke-e2e.yml")["smoke-surface"]
  const network = filtersOf("pr-extension-network-e2e.yml")["extension-network"]
  const quick = filtersOf("pr-quick.yml")

  test("NO `!` negation patterns anywhere (the dorny some-quantifier footgun)", () => {
    for (const wf of FILTER_WORKFLOWS) {
      for (const [name, pats] of Object.entries(filtersOf(wf))) {
        for (const p of pats) {
          expect(p.startsWith("!"), `${wf} → filter '${name}' has a forbidden negation: ${p}`).toBe(false)
        }
      }
    }
  })

  test("smoke-surface covers the extension graph", () => {
    assertGraphCovered(smoke, "extension", "smoke-surface")
  })

  test("extension-network covers the extension graph + the playground harness", () => {
    assertGraphCovered(network, "extension", "extension-network")
    expect(network, "network must gate the playground dApp harness").toContain("apps/playground/**")
  })

  test("needs-extension-build (pr-quick filter union) covers the extension graph", () => {
    const union = [
      ...quick["core-foundation"],
      ...quick["aztec-runtime"],
      ...quick["wallet-bridge"],
      ...quick["extension"],
    ]
    assertGraphCovered(union, "extension", "needs-extension-build")
  })

  test("a notices-generator change rebuilds both targets, and every build asserts the file shipped", () => {
    const inputs = ["src/**", "package.json", "texts/**", "bin/**", "expected-minimum.txt"].map(
      (path) => `packages/third-party-notices/${path}`,
    )
    // Beyond src + manifest: the licence texts and the expected-minimum list are build inputs too.
    for (const input of inputs) {
      expect(quick["extension"], `extension build: ${input}`).toContain(input)
      expect(quick["firefox-touching"], `the zip-content assertion runs per target: ${input}`).toContain(input)
    }
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const wf = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/_build-extension.yml"), "utf8")) as any
    const steps: { name?: string; run?: string }[] = wf.jobs.build.steps
    const assertion = steps.findIndex((step) => step.run?.includes("third-party-notices/bin/check-minimum.ts"))
    const firstUpload = steps.findIndex((step) => step.name?.startsWith("Upload"))
    expect(assertion, "the assertion step exists").toBeGreaterThan(-1)
    expect(assertion, "an artifact without notices is never uploaded").toBeLessThan(firstUpload)
  })

  test("tools build covers the tools graph", () => {
    assertGraphCovered(quick["tools"], "tools", "tools")
    expect(quick["tools"], "tools must gate its build workflow").toContain(".github/workflows/_build-tools.yml")
  })

  test("landing build covers the landing graph and the documents it renders, and is wired into the aggregator", () => {
    assertGraphCovered(quick["landing"], "landing", "landing")
    expect(quick["landing"], "a Terms edit must rebuild the pages generated from it").toContain("legal/**")
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const wf = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/pr-quick.yml"), "utf8")) as any
    expect(wf.jobs["build-landing"].if).toContain("needs-landing-build")
    expect(wf.jobs.changes.outputs["needs-landing-build"]).toBeDefined()
    expect(wf.jobs.status.needs, "a red landing build must red quality-status").toContain("build-landing")
    expect(JSON.stringify(wf.jobs.status.steps)).toContain("needs.build-landing.result")
  })

  test("bridge-contracts covers the contracts, the harness package, its graph, and the adopted manifests", () => {
    const contracts = filtersOf("bridge-contracts.yml")["contracts"]
    expect(contracts, "the Solidity + Noir sources").toContain("contracts/bridge/**")
    assertGraphCovered(contracts, "bridge-core", "bridge-contracts")
    for (const manifest of ["apps/tools/public/testnet-bridge.json", "apps/tools/public/mainnet-bridge.json"]) {
      expect(contracts, "a manifest bump is the frontend adopting a generation — the round trips must re-run").toContain(manifest)
    }
    for (const p of ["package.json", "bun.lock", "bunfig.toml", "patches/**", ".github/actions/setup-aztec/**", ".github/actions/setup-bun/**"]) {
      expect(contracts, `bridge-contracts must gate ${p}`).toContain(p)
    }
  })

  test("tools-e2e covers the tools graph, the bridge contracts, the harness package, and its own pipeline", () => {
    const filter = filtersOf("pr-tools-e2e.yml")["tools-e2e"]
    assertGraphCovered(filter, "tools", "tools-e2e")
    expect(filter, "the sandbox deploys the contracts the UI bridges through").toContain("contracts/bridge/**")
    expect(filter, "bridge-core's scripts ARE the sandbox harness").toContain("packages/bridge-core/**")
    for (const p of [
      "package.json",
      "bun.lock",
      "bunfig.toml",
      "patches/**",
      ".github/workflows/pr-tools-e2e.yml",
      ".github/workflows/_tools-e2e.yml",
      ".github/actions/setup-aztec/**",
      ".github/actions/setup-bun/**",
      ".github/actions/setup-playwright/**",
    ]) {
      expect(filter, `tools-e2e must gate ${p}`).toContain(p)
    }
  })

  test("the tools build job is wired from the changes output through to quality-status", () => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const wf = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/pr-quick.yml"), "utf8")) as any
    const outputs = wf.jobs.changes.outputs ?? {}
    expect(outputs.tools).toBe("${{ steps.override.outputs.full || steps.filter.outputs.tools }}")
    expect(outputs["needs-tools-build"]).toBe("${{ steps.compute.outputs.needs-tools-build }}")
    expect(wf.jobs["build-tools"]?.if).toBe("needs.changes.outputs.needs-tools-build == 'true'")
    expect(wf.jobs.status.needs, "quality-status must wait on build-tools").toContain("build-tools")
    const aggregate = wf.jobs.status.steps.map((s: { run?: string }) => s.run ?? "").join("\n")
    expect(aggregate, "quality-status must fail on a build-tools failure").toContain("needs.build-tools.result")
  })

  test("cross-cutting inputs (patches + root build inputs) gate the e2e suites", () => {
    for (const [label, pats] of [
      ["smoke", smoke],
      ["network", network],
    ] as const) {
      expect(pats, `${label}: patches/** rewrites installed deps`).toContain("patches/**")
      for (const root of ["package.json", "bun.lock", "bunfig.toml", "tsconfig.json"]) {
        expect(pats, `${label}: root input ${root}`).toContain(root)
      }
    }
  })

  // The shard pool / dedicated-job partition of the network suite is pinned per lane under
  // "canary lanes" below.

  // The self-pay phase gate — the wallet simulating and sending as the account a dApp names,
  // with the node's setup allow-list enforced — must keep running on every PR: the matrix in a
  // dedicated heavy job at retry 0 (a retry would re-mask an intermittent wallet regression),
  // the cheap two-account simulate in the shard pool (never excluded, so it cannot drop out).
  test("network-e2e keeps the self-pay phase gate in place at retry 0", () => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const wf = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/pr-extension-network-e2e.yml"), "utf8")) as any
    const words = (v: unknown): string[] => (typeof v === "string" ? v.split(/\s+/).filter(Boolean) : [])
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const jobs = Object.entries(wf.jobs) as [string, any][]

    const matrix = jobs.find(([, job]) => words(job.with?.test_files).includes("tests/e2e/network/selfpay-phase.test.ts"))
    expect(matrix, "selfpay-phase must run in a dedicated test_files job").toBeDefined()
    expect(String(matrix?.[1].with?.retry), "selfpay-phase runs at retry 0").toBe("0")
    expect(matrix?.[1].with?.proverless, "selfpay-phase runs proverless like the other heavy fee flows").toBe(true)

    const pool = jobs.find(([, job]) => job.with?.exclude_files)
    expect(words(pool?.[1].with?.exclude_files), "sim-from-selfpay stays in the shard pool").not.toContain(
      "tests/e2e/network/sim-from-selfpay.test.ts",
    )
    expect(String(pool?.[1].with?.retry), "the shard pool runs at retry 0").toBe("0")
    expect(existsSync(join(ROOT, "apps/extension/tests/e2e/network/sim-from-selfpay.test.ts")), "sim-from-selfpay exists").toBe(true)
    expect(existsSync(join(ROOT, "apps/extension/tests/e2e/network/selfpay-phase.test.ts")), "selfpay-phase exists").toBe(true)
  })
})

/**
 * The Firefox lanes are twins of the Chrome ones and ADVISORY. Two ways that can rot silently: a
 * twin drifts from the lane it mirrors (a file stops running on Firefox and nothing says so), or
 * a Firefox job slips into an aggregator a branch requires and starts blocking merges.
 */
describe("Firefox lanes", () => {
  // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
  const workflow = (file: string): any => Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows", file), "utf8"))
  const words = (v: unknown): string[] => (typeof v === "string" ? v.split(/\s+/).filter(Boolean) : [])
  type SuiteJob = { uses?: string; with?: Record<string, unknown>; strategy?: unknown; needs?: unknown; if?: unknown; secrets?: unknown }
  const TWINS = [
    { chrome: "pr-extension-smoke-e2e.yml", firefox: "pr-extension-smoke-e2e-firefox.yml", filter: "smoke-surface" },
    { chrome: "pr-extension-network-e2e.yml", firefox: "pr-extension-network-e2e-firefox.yml", filter: "extension-network" },
  ]

  test("each Firefox filter is its Chrome twin's, re-pointed at its own file, plus geckodriver", () => {
    for (const { chrome, firefox, filter } of TWINS) {
      const expected = filtersOf(chrome)
        [filter].map((pattern) => (pattern === `.github/workflows/${chrome}` ? `.github/workflows/${firefox}` : pattern))
        .concat(".github/actions/setup-geckodriver/**")
      expect([...filtersOf(firefox)[filter]].sort(), firefox).toEqual([...expected].sort())
    }
  })

  test("every Firefox PR suite job runs exactly the Chrome job's files on firefox", () => {
    for (const { chrome, firefox } of TWINS) {
      const [chromeJobs, firefoxJobs] = [workflow(chrome).jobs, workflow(firefox).jobs]
      expect(Object.keys(firefoxJobs), firefox).toEqual(Object.keys(chromeJobs))
      for (const [name, job] of Object.entries(chromeJobs) as [string, SuiteJob][]) {
        if (!job.uses) continue
        const twin: SuiteJob = firefoxJobs[name]
        expect(job.with?.browser, `${chrome} → ${name} stays on the default browser`).toBeUndefined()
        // Whole-shape equality: a dropped shard, input, dependency or condition is a lost file.
        const { test_files: chromeFiles, ...chromeWith } = job.with ?? {}
        const { test_files: firefoxFiles, ...firefoxWith } = twin.with ?? {}
        expect(firefoxWith, `${firefox} → ${name} with`).toEqual({ ...chromeWith, browser: "firefox" })
        expect(words(firefoxFiles), `${firefox} → ${name} test_files`).toEqual(words(chromeFiles))
        for (const key of ["uses", "strategy", "needs", "if", "secrets"] as const) {
          expect(twin[key], `${firefox} → ${name} ${key}`).toEqual(job[key])
        }
      }
    }
  })

  test("the Firefox PR lanes hold no write scope and skip drafts", () => {
    for (const { firefox } of TWINS) {
      const wf = workflow(firefox)
      expect(wf.permissions, firefox).toEqual({ contents: "read" })
      for (const [name, job] of Object.entries(wf.jobs) as [string, { permissions?: unknown }][]) {
        const want = name === "changes" ? { contents: "read", "pull-requests": "read" } : undefined
        expect(job.permissions, `${firefox} → ${name}`).toEqual(want)
      }
      const gate = wf.jobs.decide.steps[0]
      expect(gate.run, `${firefox}: decide`).toContain('if [ "$DRAFT" = "true" ]')
      expect(gate.env.DRAFT, `${firefox}: the gate reads the PR's real draft flag`).toBe("${{ github.event.pull_request.draft }}")
    }
  })

  // Exact, not a /firefox/ denylist: quality-status legitimately needs `build-firefox`.
  test("the required extension aggregators wait on exactly the Chrome suites", () => {
    expect(workflow("pr-extension-smoke-e2e.yml").jobs.status.needs).toEqual(["changes", "decide", "smoke"])
    expect(workflow("pr-extension-network-e2e.yml").jobs.status.needs).toEqual([
      "changes",
      "decide",
      "network-e2e",
      "network-e2e-heavy",
      "network-e2e-heavy-concurrent",
      "network-e2e-canary",
    ])
  })

  test("nightly and release run Firefox twins that no aggregator or publish step waits on", () => {
    for (const [file, gates] of [
      ["nightly.yml", ["status", "publish-nightly"]],
      ["release.yml", ["status", "attach-assets"]],
    ] as const) {
      const { jobs } = workflow(file)
      // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
      const firefoxJobs = Object.entries(jobs).filter(([, job]) => (job as any).with?.browser === "firefox").map(([name]) => name)
      expect(firefoxJobs, `${file} runs Firefox`).toContain("smoke-firefox-against-artifact")
      for (const [name, job] of Object.entries(jobs) as [string, { needs?: string | string[] }][]) {
        const needs = [job.needs ?? []].flat()
        const waitsOnFirefox = needs.filter((need) => firefoxJobs.includes(need))
        expect(waitsOnFirefox, `${file} → ${name} must not wait on an advisory Firefox job`).toEqual([])
      }
      for (const gate of gates) expect(jobs[gate], `${file} → ${gate}`).toBeDefined()
    }
  })

  test("nightly's Firefox network jobs mirror its Chrome ones", () => {
    const { jobs } = workflow("nightly.yml")
    for (const name of ["network-e2e", "network-e2e-heavy", "network-e2e-heavy-concurrent", "network-e2e-canary"]) {
      const [chrome, firefox] = [jobs[name], jobs[`${name}-firefox`]]
      expect(firefox, `nightly.yml → ${name}-firefox`).toBeDefined()
      expect(firefox.with.browser).toBe("firefox")
      expect(words(firefox.with.exclude_files)).toEqual(words(chrome.with.exclude_files))
      expect(words(firefox.with.test_files)).toEqual(words(chrome.with.test_files))
      expect(firefox.strategy).toEqual(chrome.strategy)
    }
  })

  test("the shared pieces default to chrome, and the browser caches share no key prefix", () => {
    for (const file of ["_extension-smoke-e2e.yml", "_extension-network-e2e.yml"]) {
      expect(workflow(file).on.workflow_call.inputs.browser.default, file).toBe("chrome")
    }
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const action = Bun.YAML.parse(readFileSync(join(ROOT, ".github/actions/setup-puppeteer/action.yml"), "utf8")) as any
    expect(action.inputs.browser.default).toBe("chrome")
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const caches = action.runs.steps.filter((step: any) => String(step.uses).startsWith("actions/cache@"))
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const [chrome, firefox] = ["chrome", "firefox"].map((browser) => caches.find((step: any) => step.if === `inputs.browser == '${browser}'`))
    const chromePrefix = String(chrome.with["restore-keys"]).trim()
    expect(chromePrefix.length).toBeGreaterThan(0)
    expect(String(firefox.with.key).startsWith(chromePrefix), "a Firefox key Chrome's restore prefix would match").toBe(false)
    expect(firefox.with["restore-keys"]).toBeUndefined()
  })
})

/**
 * The canary lanes — the prover-ON jobs every @aztec bump is gated on — run both execution
 * canaries on both browsers. What could rot silently: a canary dropped from one lane's list, left
 * in a proverless pool, or moved into a proverless job; a lane whose aggregator waits on a job but
 * never reads its result; the reusable workflow's results assertion silenced, or its label match
 * narrowed so that a lane escapes it.
 */
describe("canary lanes", () => {
  // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
  const workflow = (file: string): any => Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows", file), "utf8"))
  const words = (v: unknown): string[] => (typeof v === "string" ? v.split(/\s+/).filter(Boolean) : [])
  const SUITE = "_extension-network-e2e.yml"
  const LANES = [
    { file: "pr-extension-network-e2e.yml", browser: "chrome" },
    { file: "pr-extension-network-e2e-firefox.yml", browser: "firefox" },
    { file: "nightly.yml", browser: "chrome" },
    { file: "nightly.yml", browser: "firefox" },
  ] as const
  type SuiteJob = { uses?: string; with?: Record<string, unknown> }
  /** A lane is one browser's network suite in one caller: the shard pool plus its dedicated jobs. */
  const laneJobs = (file: string, browser: string): [string, SuiteJob][] =>
    (Object.entries(workflow(file).jobs) as [string, SuiteJob][]).filter(
      ([, job]) => String(job.uses).endsWith(SUITE) && (job.with?.browser ?? "chrome") === browser,
    )
  const canaryFiles = readdirSync(join(ROOT, "apps/extension/tests/e2e/network"))
    .filter((name) => name.endsWith("-canary.test.ts"))
    .sort()
    .map((name) => `tests/e2e/network/${name}`)

  test("the two execution canaries are on disk", () => {
    expect(canaryFiles).toEqual([
      "tests/e2e/network/frozen-account-canary.test.ts",
      "tests/e2e/network/passkey-execution-canary.test.ts",
    ])
  })

  // "Prover-ON" is the `proverless` input, not the job being dedicated: a heavy job is dedicated too.
  test("every canary runs prover-ON under a canary label in every lane, and is out of that lane's pool", () => {
    for (const { file, browser } of LANES) {
      const jobs = laneJobs(file, browser)
      const pools = jobs.filter(([, job]) => job.with?.exclude_files)
      expect(pools.map(([name]) => name), `${file} ${browser}: one shard pool`).toHaveLength(1)
      const excluded = words(pools[0][1].with?.exclude_files)
      for (const canary of canaryFiles) {
        const carriers = jobs.filter(([, job]) => words(job.with?.test_files).includes(canary))
        expect(carriers.map(([name]) => name), `${file} ${browser}: ${canary} runs in one dedicated job`).toHaveLength(1)
        const [, job] = carriers[0]
        expect(job.with?.proverless, `${file} ${browser}: ${canary} runs prover-ON`).not.toBe(true)
        expect(String(job.with?.shard_label), `${file} ${browser}: ${canary}'s job is a canary lane`).toStartWith("canary")
        expect(excluded, `${file} ${browser}: ${canary} is out of the shard pool`).toContain(canary)
      }
    }
  })

  // A file in a dedicated job's list but not the pool's runs twice; one in neither never runs.
  test("each lane's shard pool excludes exactly the union of its dedicated jobs' files", () => {
    for (const { file, browser } of LANES) {
      const jobs = laneJobs(file, browser)
      const excluded = jobs.flatMap(([, job]) => words(job.with?.exclude_files))
      const dedicated = jobs.flatMap(([, job]) => words(job.with?.test_files))
      expect(dedicated.length, `${file} ${browser}: dedicated jobs exist`).toBeGreaterThan(0)
      expect([...excluded].sort(), `${file} ${browser}: exclude_files == union of test_files`).toEqual(
        [...new Set(dedicated)].sort(),
      )
    }
  })

  // The reusable workflow folds newlines before `read -ra`; a block-scalar list is refused here as well,
  // since the whitespace-splitting pins above would accept one that the steps then mis-parse.
  test("every file list is one line", () => {
    for (const { file, browser } of LANES) {
      for (const [name, job] of laneJobs(file, browser)) {
        for (const key of ["test_files", "exclude_files"] as const) {
          const value = job.with?.[key]
          if (value !== undefined) expect(String(value), `${file} → ${name} ${key}`).not.toContain("\n")
        }
      }
    }
  })

  /** A script's lines that run — comments cannot test a result. */
  const commandLines = (run: unknown): string[] =>
    String(run ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))

  /** The jobs an aggregator's script actually tests: the operands of its `for r in …; do` lists and of
   *  its direct `[ "${{ needs.x.result }}" …` checks — an echo or a comment naming a result does not count. */
  function resultsTested(run: unknown): string[] {
    const commands = commandLines(run).join("\n")
    const inLoops = [...commands.matchAll(/for r in([\s\S]*?);\s*do/g)].flatMap((loop) =>
      [...loop[1].matchAll(/needs\.([\w-]+)\.result/g)].map((token) => token[1]),
    )
    const direct = [...commands.matchAll(/\[ "\$\{\{ needs\.([\w-]+)\.result \}\}" /g)].map((token) => token[1])
    return [...new Set([...inLoops, ...direct])].sort()
  }

  // A job in `needs` that the loop never tests can be red under a green aggregator.
  test("every job an aggregator waits on is tested in its result loop, and nothing else is", () => {
    for (const [file, aggregator] of [
      ["pr-extension-network-e2e.yml", "status"],
      ["pr-extension-network-e2e-firefox.yml", "status"],
      ["nightly.yml", "status"],
    ] as const) {
      const job = workflow(file).jobs[aggregator]
      const script = (job.steps as { run?: string }[]).map((step) => step.run ?? "").join("\n")
      expect(resultsTested(script), `${file} → ${aggregator} tests exactly its needs`).toEqual([...[job.needs ?? []].flat()].sort())
    }
    // The publish gate enumerates success: `!= 'failure'` would let a skipped or cancelled gate publish.
    const publish = workflow("nightly.yml").jobs["publish-nightly"]
    for (const need of [publish.needs ?? []].flat()) {
      expect(String(publish.if), `nightly.yml → publish-nightly requires needs.${need}.result == 'success'`).toContain(
        `needs.${need}.result == 'success'`,
      )
    }
  })

  // Pinned whole, not by fragment: a narrower condition, a `continue-on-error` or a commented-out call
  // would each keep the fragment while disarming the step.
  test("the reusable workflow asserts canary results on every canary* label, like its zero-proofs check", () => {
    type Step = { name?: string; if?: string; run?: string; env?: Record<string, string>; "continue-on-error"?: unknown }
    const job = workflow(SUITE).jobs["network-e2e"]
    expect(job["continue-on-error"], "the suite job fails when a step does").toBeUndefined()
    const steps = job.steps as Step[]
    const results = steps.find((step) => step.name === "Assert canary results")
    expect(results, "the results step exists").toBeDefined()
    expect(results?.if).toBe("${{ always() && !cancelled() && startsWith(inputs.shard_label, 'canary') }}")
    expect(results?.["continue-on-error"], "a red assertion is a red job").toBeUndefined()
    expect(commandLines(results?.run)).toContain(
      'bun scripts/ci-cd/assert-canary-results.ts "${RUNNER_TEMP}/canary-results.json" "${TEST_FILE_LIST[@]}"',
    )
    const run = steps.find((step) => step.name === "Run network e2e via agent")
    expect(run?.env?.NULO_E2E_RESULTS_FILE, "a canary* run writes the report").toBe(
      "${{ startsWith(inputs.shard_label, 'canary') && format('{0}/canary-results.json', runner.temp) || '' }}",
    )
    expect(run?.["continue-on-error"]).toBeUndefined()
    const presto = steps.find((step) => String(step.name).startsWith("Assert presto activity"))
    expect(presto?.["continue-on-error"]).toBeUndefined()
    expect(commandLines(presto?.run), "the zero-proofs check matches canary* too").toContain(
      'if [ "$PROVE_SUCCESS" -eq 0 ] && [[ "$SHARD_LABEL" == canary* ]]; then',
    )
    expect(existsSync(join(ROOT, "scripts/ci-cd/assert-canary-results.ts"))).toBe(true)
  })
})
