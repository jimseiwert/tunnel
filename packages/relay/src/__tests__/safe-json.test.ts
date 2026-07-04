import { describe, it, expect } from 'bun:test'
import { parseHeadersJson } from '../util/safe-json.js'

describe('parseHeadersJson', () => {
  it('parses a valid header object', () => {
    expect(parseHeadersJson('{"content-type":"application/json"}')).toEqual({
      'content-type': 'application/json',
    })
  })
  it('returns {} for invalid JSON', () => {
    expect(parseHeadersJson('{not valid')).toEqual({})
  })
  it('returns {} for null / undefined', () => {
    expect(parseHeadersJson(null)).toEqual({})
    expect(parseHeadersJson(undefined)).toEqual({})
  })
  it('returns {} for JSON that is not an object', () => {
    expect(parseHeadersJson('"a string"')).toEqual({})
    expect(parseHeadersJson('42')).toEqual({})
    expect(parseHeadersJson('null')).toEqual({})
    expect(parseHeadersJson('[1,2,3]')).toEqual({})
  })
})
