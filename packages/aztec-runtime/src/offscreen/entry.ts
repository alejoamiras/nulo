/**
 * PXE offscreen-document bootstrap.
 *
 * Chrome-agnostic: this file starts the PXE service inside whatever
 * environment the embedder provides. The extension's offscreen shell
 * (`extension/src/offscreen/index.ts`) constructs the concrete
 * `ProfileServiceClient` / `LoggerServiceClient` and passes them in as
 * structural `IProfileReader` / `ILogger`.
 *
 * The SW↔offscreen READY handshake (`chrome.runtime.sendMessage`) is
 * deliberately NOT done here — it stays in the extension's shell so this
 * package remains free of any `chrome.*` calls.
 */

import type { ILogger } from "@nulo/wallet-core/logger"
import { ServiceCollection } from "@nulo/wallet-core/base"
import { PxeService, type IProfileReader } from "../pxe/service"

export interface PxeOffscreenDeps {
	profiles: IProfileReader
	logger: ILogger
}

/**
 * Start the PXE service in the offscreen environment. Awaits init
 * before returning so the caller can signal ready *after* the service
 * is actually live.
 */
export async function createPxeOffscreen(deps: PxeOffscreenDeps): Promise<void> {
	const services = new ServiceCollection()
	services.add(new PxeService(deps.profiles, deps.logger))
	await services.start()
}
