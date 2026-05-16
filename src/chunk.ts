import type { Chunk } from './types'
import { calcGameTicks } from '@mcbe-mods/utils'
import { system } from '@minecraft/server'

interface PendingPacket {
  fragments: string[]
  received: number
  total: number
  compressed: boolean
  timer: ReturnType<typeof system.runTimeout>
}

export class Chunker {
  readonly #chunkSize: number
  readonly #timeout: number
  readonly #buffer = new Map<string, PendingPacket>()

  constructor(chunkSize: number, timeout: number) {
    this.#chunkSize = chunkSize
    this.#timeout = timeout
  }

  split(id: string, data: string, compressed: boolean): Chunk[] {
    const chunks: Chunk[] = []
    const total = Math.ceil(data.length / this.#chunkSize)

    for (let i = 0; i < total; i++) {
      const chunk: Chunk = {
        i: id,
        s: i,
        t: total,
        d: data.slice(i * this.#chunkSize, (i + 1) * this.#chunkSize),
      }
      if (compressed) {
        chunk.c = 1
      }
      chunks.push(chunk)
    }

    return chunks
  }

  assemble(
    chunk: Chunk,
  ): { done: false } | { done: true, data: string, compressed: boolean } {
    let pending = this.#buffer.get(chunk.i)

    if (!pending) {
      pending = {
        fragments: [],
        received: 0,
        total: chunk.t,
        compressed: chunk.c === 1,
        timer: system.runTimeout(() => {
          this.#buffer.delete(chunk.i)
        }, calcGameTicks(this.#timeout)),
      }
      this.#buffer.set(chunk.i, pending)
    }

    if (pending.fragments[chunk.s] !== undefined) {
      return { done: false }
    }

    pending.fragments[chunk.s] = chunk.d
    pending.received++

    if (pending.received === pending.total) {
      system.clearRun(pending.timer)
      this.#buffer.delete(chunk.i)
      return { done: true, data: pending.fragments.join(''), compressed: pending.compressed }
    }

    return { done: false }
  }

  get pendingCount(): number {
    return this.#buffer.size
  }
}
