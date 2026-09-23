export declare global {
	interface Console {
		_trace: typeof console.trace
		_debug: typeof console.debug
		_log: typeof console.log
		_info: typeof console.info
		_warn: typeof console.warn
		_error: typeof console.error
	}

	/** The console sniffer's sinks: a namespace of its own so `console.error` never lands on `window.onerror`. */
	interface Window {
		nuloOntrace?: typeof console.trace
		nuloOndebug?: typeof console.debug
		nuloOnlog?: typeof console.log
		nuloOninfo?: typeof console.info
		nuloOnwarn?: typeof console.warn
		nuloOnerror?: typeof console.error
	}
}
