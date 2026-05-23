import { describe, expect, it } from 'vitest'
import { Chunker } from '../src/chunk'

describe('Chunker', () => {
  it('splits data into multiple chunks', () => {
    const chunker = new Chunker(10)
    const data = 'A'.repeat(25)
    const chunks = chunker.split('test1', data, false)

    expect(chunks.length).toBe(3)
    expect(chunks[0].id).toBe('test1')
    expect(chunks[0].seq).toBe(0)
    expect(chunks[0].total).toBe(3)
    expect(chunks[0].data.length).toBe(10)
    expect(chunks[0].compressed).toBeUndefined()
  })

  it('marks compressed flag on all chunks', () => {
    const chunker = new Chunker(10)
    const data = 'A'.repeat(25)
    const chunks = chunker.split('test2', data, true)

    expect(chunks[0].compressed).toBe(true)
    expect(chunks[1].compressed).toBe(true)
    expect(chunks[2].compressed).toBe(true)
  })

  it('single chunk for small data', () => {
    const chunker = new Chunker(100)
    const chunks = chunker.split('test3', 'hello', false)
    expect(chunks.length).toBe(1)
    expect(chunks[0].seq).toBe(0)
    expect(chunks[0].total).toBe(1)
  })

  it('assembles chunks in order', () => {
    const chunker = new Chunker(5)
    const original = 'HelloWorldExtra'
    const chunks = chunker.split('pkt1', original, false)

    expect(chunks.length).toBe(3)

    const r1 = chunker.assemble(chunks[0])
    expect(r1.done).toBe(false)

    const r2 = chunker.assemble(chunks[1])
    expect(r2.done).toBe(false)

    const r3 = chunker.assemble(chunks[2])
    expect(r3.done).toBe(true)
    if (r3.done) {
      expect(r3.data).toBe(original)
      expect(r3.compressed).toBe(false)
    }
  })

  it('handles out-of-order chunks', () => {
    const chunker = new Chunker(5)
    const original = 'HelloWorldEx'
    const chunks = chunker.split('pkt2', original, false)

    expect(chunks.length).toBe(3)

    chunker.assemble(chunks[2])
    chunker.assemble(chunks[0])
    const r = chunker.assemble(chunks[1])

    expect(r.done).toBe(true)
    if (r.done) {
      expect(r.data).toBe(original)
    }
  })

  it('ignores duplicate chunks', () => {
    const chunker = new Chunker(5)
    const original = 'HelloWorldEx'
    const chunks = chunker.split('pkt3', original, false)

    expect(chunks.length).toBe(3)

    chunker.assemble(chunks[0])
    const r1 = chunker.assemble(chunks[0])
    expect(r1.done).toBe(false)

    chunker.assemble(chunks[1])
    const r2 = chunker.assemble(chunks[2])
    expect(r2.done).toBe(true)
    if (r2.done) {
      expect(r2.data).toBe(original)
    }
  })

  it('compressed flag is preserved during assemble', () => {
    const chunker = new Chunker(100)
    const chunks = chunker.split('pkt5', 'compressed-data', true)

    const r = chunker.assemble(chunks[0])
    expect(r.done).toBe(true)
    if (r.done) {
      expect(r.compressed).toBe(true)
    }
  })

  it('returns false for chunk with t <= 0', () => {
    const chunker = new Chunker(10)
    const r = chunker.assemble({ id: 'bad', seq: 0, total: 0, data: 'data' })
    expect(r.done).toBe(false)
  })
})
