import { describe, expect, it } from "vitest"
import { siteHeaders } from "./headers"

const sample = `/*
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Content-Security-Policy: default-src 'self'; script-src 'self'

/*.html
  Cache-Control: public, max-age=60, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`

describe("siteHeaders", () => {
	it("returns only the /* block, keeping values that contain colons", () => {
		expect(siteHeaders(sample)).toEqual({
			"Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
			"Content-Security-Policy": "default-src 'self'; script-src 'self'",
		})
	})

	it("returns nothing when there is no site-wide block", () => {
		expect(siteHeaders("/assets/*\n  Cache-Control: immutable\n")).toEqual({})
	})
})
