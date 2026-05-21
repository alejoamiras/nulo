/**
 * Convert an internal exception into the `WalletResponse.error` shape expected
 * by `@aztec/wallet-sdk`. Structured errors get EIP-1193 codes plus a
 * `walletErrorCode` discriminator; everything else collapses to a plain string
 * so the existing wire contract (string error for unrecognised throws) is
 * preserved.
 *
 * Pure — no I/O, no logger, no service dependencies. Lives next to
 * `background.ts` because the EIP-1193 mapping is a wallet-sdk transport
 * concern, not a wallet-bridge domain concern. Unit-testable via the
 * sibling `error-envelope.test.ts`.
 *
 * Wire reality: the dApp-side `@aztec/wallet-sdk` wrapper at
 * `extension_wallet.ts:181` wraps `response.error` in
 * `new Error(JSON.stringify(error))`. dApps that want to discriminate must
 * `JSON.parse(err.message).code` (see wallet-bridge README for the recipe).
 */

import { CapabilityNotGrantedError, JobCancelledError } from "@nulo/extension-messaging/errors"
import type { WalletResponse } from "@aztec/wallet-sdk/types"

export function toWalletResponseError(error: unknown): WalletResponse["error"] {
	if (error instanceof JobCancelledError) {
		return {
			code: 4001,
			message: error.message,
			data: {
				walletErrorCode: JobCancelledError.CODE,
				jobId: (error.details as { jobId?: string } | undefined)?.jobId,
			},
		}
	}
	if (error instanceof CapabilityNotGrantedError) {
		return {
			code: 4100,
			message: error.message,
			data: {
				walletErrorCode: CapabilityNotGrantedError.CODE,
				capabilityType: (error.details as { capabilityType?: string } | undefined)?.capabilityType,
			},
		}
	}
	return error instanceof Error ? error.message : String(error)
}
