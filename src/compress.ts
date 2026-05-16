import { compressToUTF16, decompressFromUTF16 } from 'lz-string'

export class Compressor {
  readonly #threshold: number

  constructor(threshold: number) {
    this.#threshold = threshold
  }

  compress(data: string): { value: string, compressed: boolean } {
    if (data.length <= this.#threshold) {
      return { value: data, compressed: false }
    }

    const compressed = compressToUTF16(data)
    if (compressed.length >= data.length) {
      return { value: data, compressed: false }
    }

    return { value: compressed, compressed: true }
  }

  decompress(data: string, compressed: boolean): string {
    if (!compressed)
      return data
    return decompressFromUTF16(data) ?? data
  }
}
