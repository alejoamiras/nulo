const mimeByExtension: Record<string, string> = {
	".json": "application/json;charset=utf-8",
	".txt": "text/plain;charset=utf-8",
	".zip": "application/zip",
	".gz": "application/gzip",
	".csv": "text/csv;charset=utf-8",
	".html": "text/html;charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".pdf": "application/pdf",
}

function getExtension(filename: string): string {
	const dotIndex = filename.lastIndexOf(".")
	return dotIndex !== -1 ? filename.slice(dotIndex).toLowerCase() : ""
}

function resolveMime(filename: string, mime?: string): string {
	if (mime) return mime

	const ext = getExtension(filename)
	return mimeByExtension[ext] || "text/plain;charset=utf-8"
}

export async function downloadFile({
	data,
	filename,
	mime,
	saveAs = false,
	compressionFormat,
}: {
	data: string
	filename: string
	mime?: string
	saveAs?: boolean
	compressionFormat?: CompressionFormat
}): Promise<void> {
	// `downloads` is a REQUIRED manifest permission (always granted), so no `chrome.permissions`
	// check/request here: the runtime prompt used to fire AFTER the backup was generated, steal
	// focus, and close the MV3 popup — forcing a full restart. Any genuine failure still surfaces
	// via `chrome.downloads.download`'s `lastError` below.
	let blob: Blob
	let finalFilename = filename
	if (compressionFormat) {
		const compressedData = await compressData(data, compressionFormat)
		const compressedMimeType = getCompressedMimeType(compressionFormat)
		const arrayBuffer = await compressedData.arrayBuffer()

		blob = new Blob([arrayBuffer], { type: compressedMimeType })
		finalFilename = getCompressedFilename(filename, compressionFormat)
	} else {
		const resolvedMime = resolveMime(filename, mime)
		blob = new Blob([data], { type: resolvedMime })
	}

	const url = URL.createObjectURL(blob)

	try {
		await new Promise<void>((resolve, reject) => {
			chrome.downloads.download(
				{
					url,
					filename: finalFilename,
					saveAs,
				},
				() => {
					const err = (chrome.runtime as unknown as { lastError?: { message?: string } }).lastError
					if (err) reject(new Error(err.message ?? "Download failed"))
					else resolve()
				},
			)
		})
	} finally {
		URL.revokeObjectURL(url)
	}
}

/** Thrown when a picked (or decompressed) file exceeds the caller's byte cap. */
export class FileTooLargeError extends Error {
	constructor(public readonly limitBytes: number) {
		super(`File exceeds the ${limitBytes}-byte limit`)
		this.name = "FileTooLargeError"
	}
}

export async function pickFile(accept = ".json,.txt,.gz,.gzip", delay = false, autoDecompress = true, maxBytes?: number): Promise<File> {
	return new Promise((resolve, reject) => {
		const input = document.createElement("input")
		input.type = "file"
		input.accept = accept
		input.style.display = "none"

		document.body.appendChild(input)

		input.onchange = () => {
			const file = input.files?.[0]
			document.body.removeChild(input)

			if (!file) {
				reject(new Error("No file selected"))
				return
			}

			// The cap and the plain path settle SYNCHRONOUSLY here (reject-and-return, always — a
			// throw would leave the outer promise pending); only decompression goes async.
			const verdict = classifyPickedFile(file, autoDecompress, maxBytes)
			if (verdict === "too-large") {
				reject(new FileTooLargeError(maxBytes as number))
				return
			}
			if (verdict === "plain") {
				resolve(file)
				return
			}
			void settleDecompressed(file, verdict, maxBytes, resolve, reject)
		}

		if (delay) {
			setTimeout(() => input.click(), 50)
		} else {
			input.click()
		}
	})
}

/** The cap must run HERE, not in callers: for compressed files the unbounded materialization would
 *  otherwise already have happened inside the decompress by the time a caller can look at `.size`. */
function classifyPickedFile(file: File, autoDecompress: boolean, maxBytes: number | undefined): "too-large" | "plain" | CompressionFormat {
	if (maxBytes !== undefined && file.size > maxBytes) return "too-large"
	const compressionFormat = getCompressionFormat(file?.name)
	if (!compressionFormat || !autoDecompress) return "plain"
	return compressionFormat
}

/** The async tail of a pick: inflate, or fall back to the original file — except for the cap
 *  error, which must NOT fall into the warn-and-fallback (resolving with the still-compressed
 *  original would reclassify a decompression bomb as a plain file). Owns the pick's settlement. */
async function settleDecompressed(
	file: File,
	compressionFormat: CompressionFormat,
	maxBytes: number | undefined,
	resolve: (file: File) => void,
	reject: (err: unknown) => void,
): Promise<void> {
	try {
		const decompressedBlob = await decompressData(file, compressionFormat, maxBytes)
		const decompressedFile = new File([decompressedBlob], file.name.replace(`${getExtension(file.name)}`, ""), {
			type: decompressedBlob.type,
			lastModified: file.lastModified,
		})

		resolve(decompressedFile)
	} catch (err) {
		if (err instanceof FileTooLargeError) {
			reject(err)
			return
		}
		console.warn(`Failed to decompress ${file.name}:`, err instanceof Error ? err.message : err)
		resolve(file)
	}
}

// Compression / Decompression
const supportedCompressionFormats = ["gzip", "deflate", "deflate-raw"] as const
type CompressionFormat = (typeof supportedCompressionFormats)[number]

interface CompressionStream extends GenericTransformStream {
	readonly readable: ReadableStream<Uint8Array>
	readonly writable: WritableStream<BufferSource>
}

interface DecompressionStream extends GenericTransformStream {
	readonly readable: ReadableStream<Uint8Array>
	readonly writable: WritableStream<BufferSource>
}

declare var CompressionStream: {
	new (format: string): CompressionStream
}

declare var DecompressionStream: {
	new (format: string): DecompressionStream
}

function isCompressionStreamSupported(): boolean {
	try {
		new CompressionStream("gzip")
		new DecompressionStream("gzip")
		return true
	} catch {
		return false
	}
}

function getCompressedFilename(originalFilename: string, compressionFormat: CompressionFormat): string {
	const extension = getExtension(originalFilename)
	const baseName = extension ? originalFilename.slice(0, -extension.length) : originalFilename

	switch (compressionFormat) {
		case "gzip":
			return `${baseName}.gz`
		case "deflate":
			return `${baseName}.zz`
		case "deflate-raw":
			return `${baseName}.df`
		default:
			return `${originalFilename}.compressed`
	}
}

function getCompressedMimeType(compressionFormat: CompressionFormat): string {
	switch (compressionFormat) {
		case "gzip":
			return "application/gzip"
		case "deflate":
		case "deflate-raw":
			return "application/octet-stream"
		default:
			return "application/octet-stream"
	}
}

function getCompressionFormat(filename?: string): CompressionFormat | null {
	if (!filename) return null

	const extension = getExtension(filename)
	switch (extension) {
		case ".gz":
		case ".gzip":
			return "gzip"
		case ".zz":
		case ".deflate":
			return "deflate"
		case ".df":
		case ".raw":
			return "deflate-raw"

		default:
			return null
	}
}

export async function compressData(data: string | ArrayBuffer | Blob | ReadableStream, format: CompressionFormat): Promise<Blob> {
	if (!isCompressionStreamSupported()) {
		throw new Error("Compression Streams API is not supported in this browser version")
	}

	if (!supportedCompressionFormats.includes(format)) {
		throw new Error(`Unsupported compression format: ${format}. Available: ${supportedCompressionFormats.join(", ")}`)
	}

	let inputStream: ReadableStream<Uint8Array>

	if (typeof data === "string") {
		const encoder = new TextEncoder()
		const bytes = encoder.encode(data)
		inputStream = new ReadableStream({
			start(controller) {
				controller.enqueue(bytes)
				controller.close()
			},
		})
	} else if (data instanceof ArrayBuffer) {
		inputStream = new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(data))
				controller.close()
			},
		})
	} else if (data instanceof Blob) {
		inputStream = data.stream()
	} else {
		inputStream = data
	}

	try {
		const compressionStream = new CompressionStream(format)
		// biome-ignore lint/suspicious/noExplicitAny: DOM CompressionStream typings diverge slightly across TS lib versions
		const compressedStream = inputStream.pipeThrough(compressionStream as any) as ReadableStream<Uint8Array>
		const response = new Response(compressedStream)
		return await response.blob()
	} catch (err) {
		throw new Error(`Failed to compress data: ${err instanceof Error ? err.message : String(err)}`)
	}
}

export async function decompressData(compressedData: Blob | ArrayBuffer, format: CompressionFormat, maxBytes?: number): Promise<Blob> {
	if (!isCompressionStreamSupported()) {
		throw new Error("Compression Streams API is not supported in this browser version")
	}

	let uint8Array: Uint8Array

	if (compressedData instanceof ArrayBuffer) {
		uint8Array = new Uint8Array(compressedData)
	} else if (compressedData instanceof Blob) {
		const arrayBuffer = await compressedData.arrayBuffer()
		uint8Array = new Uint8Array(arrayBuffer)
	} else {
		throw new Error("Unsupported data type")
	}

	const ds = new DecompressionStream(format)
	const writer = ds.writable.getWriter()

	// The producer promises must settle even when the reader cancels
	// mid-stream (the over-cap abort): a genuine write failure still surfaces
	// through the reader side, so these catches only prevent an unhandled
	// rejection — they never hide a failure.
	writer.write(uint8Array as BufferSource).catch(() => {})
	writer.close().catch(() => {})

	// Chunk-wise drain with a running total: a small compressed input can
	// inflate arbitrarily, so the cap must be enforced DURING inflation —
	// checking the result's size afterwards would be after the memory is
	// already spent.
	const reader = ds.readable.getReader()
	const chunks: BlobPart[] = []
	let total = 0
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		total += value.byteLength
		if (maxBytes !== undefined && total > maxBytes) {
			await reader.cancel()
			throw new FileTooLargeError(maxBytes)
		}
		chunks.push(value as BlobPart)
	}
	return new Blob(chunks)
}
