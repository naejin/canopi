import { describe, expect, it } from 'vitest'
import { describeMapErrorEvent, redactCredentials, redactError } from '../maplibre/redact-credentials'

describe('map error credential redaction', () => {
  it('redacts the Google key wherever it rides in a URL', () => {
    expect(redactCredentials('https://tile.googleapis.com/v1/2dtiles/3/4/5?key=AIzaSECRET'))
      .toBe('https://tile.googleapis.com/v1/2dtiles/3/4/5?key=<redacted>')
    expect(redactCredentials('a=1&api_key=SECRET&b=2')).toBe('a=1&api_key=<redacted>&b=2')
  })

  it('redacts the session token of an official tile URL, not only the key', () => {
    const message = 'AJAXError: Not Found (404): https://tile.googleapis.com/v1/2dtiles/3/4/5?session=AKz-SESSION_TOKEN&key=AIzaSECRET'
    const redacted = redactCredentials(message)
    expect(redacted).not.toContain('SESSION_TOKEN')
    expect(redacted).not.toContain('AIzaSECRET')
    expect(redacted).toBe('AJAXError: Not Found (404): https://tile.googleapis.com/v1/2dtiles/3/4/5?session=<redacted>&key=<redacted>')
    expect(describeMapErrorEvent({ sourceId: 'satellite', error: { status: 404, message } }))
      .not.toContain('SESSION_TOKEN')
  })

  it('returns the same error when it holds no credential', () => {
    const plain = new Error('Style failed')
    expect(redactError(plain)).toBe(plain)
    const leaky = new Error('GET https://x/tile?session=TOKEN failed')
    const redacted = redactError(leaky)
    expect(redacted).not.toBe(leaky)
    expect(redacted.message).toBe('GET https://x/tile?session=<redacted> failed')
  })
})
