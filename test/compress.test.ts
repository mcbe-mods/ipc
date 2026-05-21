import { describe, expect, it } from 'vitest'
import { Compressor } from '../src/compress'

describe('Compressor', () => {
  it('returns uncompressed for data under threshold', () => {
    const c = new Compressor(100)
    const { value, compressed } = c.compress('hello')
    expect(value).toBe('hello')
    expect(compressed).toBe(false)
  })

  it('compresses data over threshold', () => {
    const c = new Compressor(10)
    const data = 'A'.repeat(100)
    const { value, compressed } = c.compress(data)
    expect(compressed).toBe(true)
    expect(value.length).toBeLessThan(data.length)
  })

  it('does not compress if result is larger', () => {
    const c = new Compressor(1)
    const data = 'x'
    const { value, compressed } = c.compress(data)
    expect(compressed).toBe(false)
    expect(value).toBe('x')
  })

  it('decompresses previously compressed data', () => {
    const c = new Compressor(10)
    const original = `Hello, World! ${'x'.repeat(50)}`
    const { value, compressed } = c.compress(original)
    const decompressed = c.decompress(value, compressed)
    expect(decompressed).toBe(original)
  })

  it('passes through uncompressed data', () => {
    const c = new Compressor(100)
    const result = c.decompress('hello', false)
    expect(result).toBe('hello')
  })

  it('throws on decompression failure', () => {
    const c = new Compressor(100)
    expect(() => c.decompress('invalid-base64!!!', true)).toThrow('Decompression failed')
  })
})
