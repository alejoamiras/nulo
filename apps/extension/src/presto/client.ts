import { PrestoClient } from "@alejoamiras/presto-core"
import { PRESTO_HOST, PRESTO_HTTPS_PORT, PRESTO_PORT } from "./config"

/** The slice of `PrestoClient` a status consumer needs; tests inject a fake. */
export type PrestoStatusClient = Pick<PrestoClient, "checkStatus">

let client: PrestoClient | undefined

/**
 * One client per page context, so every consumer shares the SDK's 10 s status cache and protocol
 * pin. Pages never prove, but `httpsOnly` is explicit anyway: a page-side status must describe the
 * same transport the offscreen prover will use.
 */
export function getPrestoClient(): PrestoClient {
	client ??= new PrestoClient({
		aztecVersion: __AZTEC_VERSION__,
		presto: { host: PRESTO_HOST, port: PRESTO_PORT, httpsPort: PRESTO_HTTPS_PORT, httpsOnly: true },
	})
	return client
}
