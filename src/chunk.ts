import type { Chunk } from './types'

interface PendingPacket {
  fragments: string[]
  received: number
  total: number
  compressed: boolean
}

/**
 * Splits large serialized packets into smaller chunks and reassembles them on the receiving end.
 * Used internally by {@link IPC} — you typically don't need to interact with this class directly.
 */
export class Chunker {
  readonly #chunkSize: number
  readonly #buffer = new Map<string, PendingPacket>()

  /**
   * @param chunkSize - Maximum characters per chunk
   */
  constructor(chunkSize: number) {
    this.#chunkSize = chunkSize
  }

  /**
   * Split a serialized string into ordered chunks for transport.
   * @param id - A unique identifier shared by all chunks of this packet
   * @param data - The serialized string to split
   * @param compressed - Whether the data is compressed with lz-string
   * @returns An array of chunks ready to be sent
   */
  split(id: string, data: string, compressed: boolean): Chunk[] {
    const chunks: Chunk[] = []
    const total = Math.ceil(data.length / this.#chunkSize)

    for (let i = 0; i < total; i++) {
      const chunk: Chunk = {
        id,
        seq: i,
        total,
        data: data.slice(i * this.#chunkSize, (i + 1) * this.#chunkSize),
      }
      if (compressed) {
        chunk.compressed = true
      }
      chunks.push(chunk)
    }

    return chunks
  }

  /**
   * Feed a received chunk to the reassembly buffer.
   * Returns `{ done: true }` with the full data once all fragments have arrived.
   * @param chunk - The incoming chunk fragment
   */
  assemble(
    chunk: Chunk,
  ): { done: false } | { done: true, data: string, compressed: boolean } {
    if (chunk.total <= 0) {
      return { done: false }
    }

    let pending = this.#buffer.get(chunk.id)

    if (!pending) {
      pending = {
        fragments: [],
        received: 0,
        total: chunk.total,
        compressed: chunk.compressed === true,
      }
      this.#buffer.set(chunk.id, pending)
    }

    if (pending.fragments[chunk.seq] !== undefined) {
      return { done: false }
    }

    pending.fragments[chunk.seq] = chunk.data
    pending.received++

    if (pending.received === pending.total) {
      this.#buffer.delete(chunk.id)
      return { done: true, data: pending.fragments.join(''), compressed: pending.compressed }
    }

    return { done: false }
  }

  /** Number of packets currently being reassembled */
  get pendingCount(): number {
    return this.#buffer.size
  }
}
