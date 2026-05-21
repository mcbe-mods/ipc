import { compressToBase64, decompressFromBase64 } from 'lz-string'
// Base64 is used instead of UTF16 because its output is pure ASCII
// (1 char = 1 byte), ensuring each chunk stays within the ScriptEvent
// 2048-byte limit. UTF16 characters can be 1-3 bytes in UTF-8, making
// it impossible to guarantee the limit isn't exceeded.
// @see https://learn.microsoft.com/en-us/minecraft/creator/reference/content/commandsreference/examples/commands/scriptevent?view=minecraft-bedrock-stable#usage

/**
 * Applies lz-string compression to payloads exceeding a size threshold.
 * Used internally by {@link IPC} — you typically don't need to interact with this class directly.
 */
export class Compressor {
  readonly #threshold: number

  /**
   * @param threshold - Payloads longer than this will be compressed
   */
  constructor(threshold: number) {
    this.#threshold = threshold
  }

  /**
   * Compress data if it exceeds the threshold and compression is beneficial.
   * @param data - The raw string to potentially compress
   * @returns The (possibly compressed) value and a flag indicating whether compression was applied
   */
  compress(data: string): { value: string, compressed: boolean } {
    if (data.length <= this.#threshold) {
      return { value: data, compressed: false }
    }

    const compressed = compressToBase64(data)
    if (compressed.length >= data.length) {
      return { value: data, compressed: false }
    }

    return { value: compressed, compressed: true }
  }

  /**
   * Decompress data if it was previously compressed.
   * @param data - The string to decompress
   * @param compressed - Whether compression was applied
   * @returns The decompressed (or original) string
   */
  decompress(data: string, compressed: boolean): string {
    if (!compressed)
      return data
    const decompressed = decompressFromBase64(data)
    if (decompressed === null)
      throw new Error('Decompression failed')
    return decompressed
  }
}
