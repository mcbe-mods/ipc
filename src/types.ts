import type { PROTOCOL_VERSION } from './constants'

/** Custom serialization — transforms complex data into a string for transport */
export interface Serializer<T> {
  /** @returns The string representation of `value` */
  serialize: (value: T) => string
}

/** Custom deserialization — restores data from the string produced by {@link Serializer} */
export interface Deserializer<T> {
  /** @returns The parsed value */
  deserialize: (data: string) => T
}

/**
 * Per-call options for {@link IPC.invoke}.
 * @template T - The request data type
 * @template R - The response data type
 */
export interface InvokeOptions<T = never, R = unknown> {
  /** Timeout in milliseconds. Falls back to {@link IPCOptions.invokeTimeout}. 0 disables timeout. */
  timeout?: number
  /** Custom serializer for the request data */
  serializer?: Serializer<T>
  /** Custom deserializer for the response data */
  deserializer?: Deserializer<R>
}

/** Options for creating an IPC instance */
export interface IPCOptions {
  /** Namespace used for script events: `ipc:<namespace>`. All addons sharing the same namespace can communicate. @default 'global' */
  namespace?: string
  /**
   * If a packet (or already compressed payload) exceeds this many **bytes**
   * (not characters), it will be split into chunks.
   *
   * Minecraft's `/scriptevent` command has a **2048-byte** message limit:
   * @see https://learn.microsoft.com/en-us/minecraft/creator/reference/content/commandsreference/examples/commands/scriptevent?view=minecraft-bedrock-stable#usage
   *
   * With `compressToBase64`, each character is 1 byte,
   * so the safe value satisfies `chunkSize + JSON(chunk wrapper) ≤ 2048`.
   * @default 1800
   */
  chunkSize?: number
  /** Raw JSON payloads larger than this will be compressed with lz-string before sending. @default 800 */
  compressThreshold?: number
  /** Maximum allowed serialized packet size in characters. Throws if exceeded. @default 1_000_000 */
  maxPacketSize?: number
  /** Default timeout for {@link IPC.invoke} in milliseconds. 0 disables timeout. @default 30_000 */
  invokeTimeout?: number
}

/**
 * Internal protocol packet.
 * Every message sent between IPC instances is wrapped in this structure.
 * @template T - The payload type
 */
export interface Packet<T = unknown> {
  /** Protocol version identifier */
  v: typeof PROTOCOL_VERSION
  /** Unique request id, used to match a response to its original invoke call */
  id: string
  /** Endpoint name — determines which handler or listener receives this packet */
  e: string
  /** Payload — the actual data being sent */
  d: T
}

/**
 * A single fragment of a chunked packet.
 * When a serialized packet exceeds `chunkSize`, it is split into multiple Chunks
 * and reassembled on the receiving end.
 */
export interface Chunk {
  /** The id of the original packet this fragment belongs to */
  i: string
  /** Zero-based index of this fragment within the reassembly sequence */
  s: number
  /** Total number of fragments expected for this packet */
  t: number
  /** Set to `1` if the data slice is compressed with lz-string */
  c?: 1
  /** Raw or lz-string-compressed segment of the serialized packet */
  d: string
}

/**
 * A successful response to an invoke call.
 * Discriminated from {@link ErrorResponseData} by the `ok` field.
 */
export interface ResponseData<T = unknown> {
  ok: true
  /** The return value produced by the handler */
  data: T
}

/** A failed response to an invoke call — the handler threw or no handler was found. */
export interface ErrorResponseData {
  ok: false
  /** Error description */
  err: string
}
