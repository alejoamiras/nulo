// Hand-written, independent of the Worker's map, so a changed target moves the implementation
// without moving the expectation.
export const EXPECTED: Readonly<Record<string, string>> = {
	"tools.nulo.sh": "https://unleashed-mainnet.alejo-amiras.workers.dev",
	"testnet.tools.nulo.sh": "https://unleashed-testnet.alejo-amiras.workers.dev",
}

// Paths that turn a naive `new URL(path, origin)` or string concatenation into another origin.
export const HOSTILE_PATHS = [
	"//evil.example/x",
	"/\\evil.example",
	"/%2F%2Fevil.example",
	"/@evil.example",
	"/..%2F..%2Fevil.example",
	"/%0d%0aLocation:%20https://evil.example",
]

// Percent-encoding that must survive byte for byte: decoding it would split `memo` into two params.
export const ENCODED_SUFFIX = "/a%20b/%2F/c?memo=a%26admin%3Dtrue&nl=%0D%0A&ok=%E2%9C%93"
