# Research: RPC URL allowlist (F-011)

## Current validation stack

| Layer | File:line | Status |
|---|---|---|
| `addNetwork` schema param | `network/spec.ts:121` | `z.string().url()` — accepts `javascript:`, `data:`, `file:`, `chrome:` |
| `addEndpoint` schema param | `network/spec.ts:141` | `z.string().url()` — same |
| `updateEndpoint` schema param | `network/spec.ts:145` | `z.string().url()` — same |
| Persisted `NetworkEndpoint.rpcUrl` | `network/spec.ts:77-81` | Plain `z.string()` — NO validation |
| Persisted `NetworkInfo.rpcUrl` | `network/spec.ts:97-101` | Plain `z.string()` — NO validation |
| `restore()` | `network/service.ts:613-645` | Shape-only check via `isNewShapeNetwork()`; persists URLs as-is |
| Node-factory adapter | `aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:16-18` | Passes through to `createAztecNodeClient(rpcUrl, ...)` — no checks |
| Fetch utility | `aztec-runtime/src/utils/fetch.ts:87-98` | Timeout only |

## What `z.string().url()` accepts

- `javascript:alert(1)` ✓
- `data:text/html,<script>...` ✓
- `file:///etc/passwd` ✓
- `chrome://extensions` ✓
- `ftp://...` ✓
- `http://attacker.example.com` ✓
- `https://...` ✓ (legit)
- `http://localhost:8080` ✓ (legit dev)

## Proposed allowlist design

**Allow**:
- `https:` for any host
- `http:` ONLY for loopback (string-match `localhost`, `127.0.0.1`, `[::1]`)

**Reject**: everything else.

**Placement**: in `network/spec.ts` as a custom Zod refine. Reason: schema enforcement catches it at add-network AND at restore (deserialization), not just at user-facing UI.

```typescript
const RpcUrlSchema = z.string().url().refine(
  (url) => {
    const u = new URL(url)
    const scheme = u.protocol.slice(0, -1)
    if (scheme === 'https') return true
    if (scheme === 'http') {
      const host = u.hostname.toLowerCase()
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
    }
    return false
  },
  { message: 'RPC URL must use https:// or http://localhost / http://127.0.0.1' }
)
// Apply to NetworkEndpointSchema + NetworkInfoSchema (replaces z.string()) and to addNetwork/addEndpoint params
```

## e2e:agent compatibility ✓

Generated URLs from `resolve-ports.ts`:
- `anvilUrl: http://127.0.0.1:<port>` — PASS
- `aztecUrl: http://localhost:<port>` — PASS
- `playgroundUrl: http://localhost:<port>/` — PASS
- `faucetUrl: http://localhost:<port>/` — PASS

All loopback. No e2e workflow breakage.

## Custom dev hosts

Grep finds NO references to `host.docker.internal`, `*.local` TLDs, custom dev FQDNs. Team uses only `localhost` / `127.0.0.1` / public HTTPS endpoints. Proposed allowlist is sufficient.

## Migration

Default-seeded networks all use `https://`. No migration cost for existing wallets.

## Test scaffold (additions to existing `network/service.test.ts`)

```typescript
describe("RPC URL allowlist (F-011)", () => {
  test("rejects javascript: URL", async () => {
    await expect(service.addNetwork("Evil", "javascript:alert(1)"))
      .rejects.toThrow(/https|loopback/i)
  })
  test("rejects http://attacker.example.com", async () => {
    await expect(service.addNetwork("Bad", "http://attacker.example.com"))
      .rejects.toThrow(/https|loopback/i)
  })
  test("accepts http://localhost:8888", async () => {
    const net = await service.addNetwork("Local", "http://localhost:8888")
    expect(net.endpoints[0].rpcUrl).toBe("http://localhost:8888")
  })
  test("accepts https://aztec-node.example.com", async () => {
    const net = await service.addNetwork("HTTPS", "https://aztec-node.example.com")
    expect(net.endpoints[0].rpcUrl).toBe("https://aztec-node.example.com")
  })
  test("restore rejects backup entry with data: URL", async () => {
    const bad = { id: "net1", profileId: "p1", chainId: 99, name: "Bad", primaryEndpointId: "ep1",
      endpoints: [{ id: "ep1", rpcUrl: "data:text/html,..." }] }
    const result = await service.restore([bad])
    expect(result[0]).toHaveProperty("restoreError")
  })
})
```
