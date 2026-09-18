/** Shared fixtures for the `TokenSeeder` unit suites. Test-only. */

import { vi } from "vitest"
import { fakeBrowser } from "@webext-core/fake-browser"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import type { DefaultTokenSeed } from "./default-tokens"
import { type SeedMarkerEntry, type SeedPreview, TokenSeeder, type TokenSeederDeps } from "./seeder"
import type { TokenInterface } from "./spec"

export const CHAIN_ID = 999
export const CONTRACT = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
export const CLASS_ID = "0x0225da0f4227a139c3d6562b6554750adcdec45fd62d9b16af11da21033ef2cf"
export const MARKER_KEY = "nulo:core:token-seeded@p1"
export const KEY = `${CHAIN_ID}:${CONTRACT}`

export const SEED: DefaultTokenSeed = {
	chainId: CHAIN_ID,
	contract: CONTRACT,
	expectedClassId: CLASS_ID,
	expectedSymbol: "cUSD",
	displayName: "Compressed USD",
}

export const IFACE = { chainId: CHAIN_ID, contract: CONTRACT, isComplete: true } as unknown as TokenInterface

export function goodPreview(): SeedPreview {
	return { name: "Compressed USD", symbol: "cUSD", decimals: 6, interface: IFACE }
}

/** Every seeder a suite builds. A failed attempt arms a real retry timer and the
 *  marker storage is shared across tests, so a timer outliving its test would
 *  write into the next one — `disposeSeeders` belongs in every `afterEach`. */
const liveSeeders: TokenSeeder[] = []

export function trackSeeder(seeder: TokenSeeder): TokenSeeder {
	liveSeeders.push(seeder)
	return seeder
}

export function disposeSeeders(): void {
	for (const seeder of liveSeeders.splice(0)) seeder.dispose()
}

export function makeSeeder(overrides?: Partial<TokenSeederDeps> & { version?: string; getVersion?: () => string }) {
	const api = new FakeBrowserApi()
	const logger = new LoggerStore(new ConfigStore())
	const deps: TokenSeederDeps = {
		getSeeds: vi.fn(async () => [SEED]),
		getActiveProfile: vi.fn(async () => ({ id: "p1" })),
		getActiveNetwork: vi.fn(async () => ({ id: "net1", chainId: CHAIN_ID })),
		getAccounts: vi.fn(async () => [{ address: "0xacc1" }]),
		preview: vi.fn(async () => goodPreview()),
		isTokenPresent: vi.fn(async () => false),
		persist: vi.fn(async () => {}),
		onStatusChanged: vi.fn(),
		...overrides,
	}
	const getVersion = overrides?.getVersion ?? (() => overrides?.version ?? "1.0.0")
	const seeder = trackSeeder(new TokenSeeder(deps, api.storage.local, logger, getVersion))
	return { seeder, deps, api, logger }
}

export async function readMarker(): Promise<Record<string, SeedMarkerEntry>> {
	const res = await fakeBrowser.storage.local.get(MARKER_KEY)
	return res[MARKER_KEY] ? JSON.parse(res[MARKER_KEY] as string) : {}
}

export async function writeMarker(state: unknown): Promise<void> {
	await fakeBrowser.storage.local.set({ [MARKER_KEY]: JSON.stringify(state) })
}

/** Moves the clock past the longest retry wait, so back-to-back `run()` calls each attempt. */
export function skipBackoff(): void {
	vi.setSystemTime(Date.now() + 61_000)
}
