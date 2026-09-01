import { describe, expect, it } from "vitest"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { bridgeProxyArtifact } from "../src/artifacts"
import {
	claimTokensUntilSynced,
	deployAccountIfAbsent,
	registerManifestContract,
	registerManifestTrio,
	universalDeployInstance,
} from "./script-l2"

describe("script-l2", () => {
	it("universalDeployInstance reproduces the direct universal-deploy computation", async () => {
		const direct = await getContractInstanceFromInstantiationParams(
			bridgeProxyArtifact as never,
			{
				constructorArgs: [],
				salt: new Fr(1234),
				publicKeys: PublicKeys.default(),
				deployer: AztecAddress.ZERO,
				constructorArtifact: "constructor",
			} as never,
		)
		const viaHelper = await universalDeployInstance(bridgeProxyArtifact, [], "constructor", 1234)
		expect(viaHelper.address.toString()).toBe(direct.address.toString())
	})

	it("registerManifestTrio reconstructs constructor args and registers proxy → token → bridge in order", async () => {
		const { AztecAddress: Addr } = await import("@aztec/aztec.js/addresses")
		const { EthAddress } = await import("@aztec/foundation/eth-address")
		const { TokenContractArtifact } = await import("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js")
		const { tokenBridgeArtifact } = await import("../src/artifacts")
		const portal = "0x0000000000000000000000000000000000000042"

		// Compute the expected universal-deploy addresses the same way a real deploy records them.
		const proxyI = await universalDeployInstance(bridgeProxyArtifact, [], "constructor", 11)
		const tokenI = await universalDeployInstance(
			TokenContractArtifact,
			["N", "S", 6, proxyI.address, Addr.ZERO],
			"constructor_with_minter",
			22,
		)
		const bridgeI = await universalDeployInstance(
			tokenBridgeArtifact,
			[proxyI.address, EthAddress.fromString(portal)],
			"constructor",
			33,
		)

		const registered: string[] = []
		const ewallet = {
			registerContract: async (instance: { address: { toString: () => string } }) => {
				registered.push(instance.address.toString())
			},
		}
		const trio = await registerManifestTrio(ewallet, {
			l1: { portal },
			l2: {
				proxy: { address: proxyI.address.toString(), salt: 11, constructorArtifact: "constructor" },
				token: {
					address: tokenI.address.toString(),
					salt: 22,
					constructorArtifact: "constructor_with_minter",
					constructorArgs: ["N", "S", 6, proxyI.address.toString()],
				},
				bridge: { address: bridgeI.address.toString(), salt: 33, constructorArtifact: "constructor" },
			},
		})
		expect(registered).toEqual([proxyI.address.toString(), tokenI.address.toString(), bridgeI.address.toString()])
		expect(trio.proxy.address.toString()).toBe(proxyI.address.toString())
		expect(trio.bridge.address.toString()).toBe(bridgeI.address.toString())
	})

	it("claimTokensUntilSynced selects claim_private vs claim_public and passes the claim pair", async () => {
		const calls: { fn: string; args: unknown[] }[] = []
		const bridge = {
			methods: {
				claim_private: (...args: unknown[]) => ({
					send: async () => calls.push({ fn: "claim_private", args }),
				}),
				claim_public: (...args: unknown[]) => ({
					send: async () => calls.push({ fn: "claim_public", args }),
				}),
			},
		}
		const claimValue = new Fr(7)
		await claimTokensUntilSynced({
			bridge: bridge as never,
			isPrivate: true,
			recipient: "R",
			amount: 5n,
			claimValue,
			leafIndex: 9n,
			sendOpts: {},
		})
		await claimTokensUntilSynced({
			bridge: bridge as never,
			isPrivate: false,
			recipient: "R",
			amount: 5n,
			claimValue,
			leafIndex: 9n,
			sendOpts: {},
		})
		expect(calls.map((c) => c.fn)).toEqual(["claim_private", "claim_public"])
		expect(calls[0].args[2]).toBe(claimValue)
		expect(String(calls[0].args[3])).toBe(String(new Fr(9n)))
	})

	it("deployAccountIfAbsent no-ops when the node serves the account, else sends NO_FROM with the fee", async () => {
		const log: string[] = []
		const served = {
			node: { getContract: async () => ({}) },
			manager: {
				getDeployMethod: async () => {
					throw new Error("must not deploy")
				},
			},
			from: {} as never,
			fee: { paymentMethod: "sponsored" },
			log: (s: string) => log.push(s),
		}
		await deployAccountIfAbsent(served as never)
		expect(log).toEqual([])

		let sent: { fee: unknown; from: unknown } | undefined
		const absent = {
			node: { getContract: async () => undefined },
			manager: {
				getDeployMethod: async () => ({
					send: async (o: { fee: unknown; from: unknown }) => {
						sent = o
					},
				}),
			},
			from: {} as never,
			fee: { paymentMethod: "sponsored" },
			log: (s: string) => log.push(s),
		}
		await deployAccountIfAbsent(absent as never)
		expect(sent?.from).toBe("NO_FROM")
		expect(sent?.fee).toEqual({ paymentMethod: "sponsored" })
		expect(log).toEqual(["deploying", "deployed"])
	})

	it("registerManifestContract hard-stops on a recorded address that does not recompute", async () => {
		const neverCalled = {
			registerContract: async () => {
				throw new Error("must not register on mismatch")
			},
		}
		await expect(
			registerManifestContract(neverCalled, {
				label: "proxy",
				art: bridgeProxyArtifact,
				args: [],
				ctor: "constructor",
				salt: 1234,
				address: `0x${"11".repeat(32)}`,
			}),
		).rejects.toThrow(/manifest proxy mismatch: recomputed .* != recorded/)
	})
})
