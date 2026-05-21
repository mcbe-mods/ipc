import type {
  Chunk,
  Deserializer,
  ErrorResponseData,
  IPCOptions,
  Packet,
  ResponseData,
  Serializer,
} from './types'

import { EventEmitter } from 'mini-emit'
import { Chunker } from './chunk'
import { Compressor } from './compress'
import { PROTOCOL_VERSION, RESPONSE_ENDPOINT, RESPONSE_EVENT_PREFIX } from './constants'
import { Transport } from './transport'

const DEFAULT_OPTIONS: Required<IPCOptions> = {
  namespace: 'global',
  chunkSize: 1800,
  compressThreshold: 800,
  maxPacketSize: 1_000_000,
}

/**
 * Events emitted by {@link IPC.events}.
 * - `error`: An internal error occurred (e.g., malformed chunk reassembly).
 */
export const IPC_SYSTEM_EVENTS = {
  ERROR: 'error',
} as const

export interface IPCSystemEvents {
  [IPC_SYSTEM_EVENTS.ERROR]: Error
}

const ID_RANDOM_BITS = 0x100000000
const ID_RANDOM_CHARS = 6
const ID_COUNTER_RADIX = 36

let idCounter = 0

function generateId(): string {
  const r = ((Math.random() * ID_RANDOM_BITS) >>> 0).toString(16).slice(0, ID_RANDOM_CHARS).toUpperCase()
  const c = (idCounter++ % ID_COUNTER_RADIX).toString(ID_COUNTER_RADIX).toUpperCase()
  return r + c
}

export class IPC {
  readonly #options: Required<IPCOptions>
  readonly #transport: Transport
  readonly #compressor: Compressor
  readonly #chunker: Chunker
  readonly #onHandlers = new Map<string, Set<(data: unknown) => void>>()
  readonly #handleHandlers = new Map<string, (data: unknown) => unknown | Promise<unknown>>()
  readonly #responses = new EventEmitter<Record<string, unknown>>()
  readonly #sentIds = new Set<string>() // IDs sent by this instance — used to detect loopback and prevent false "No handler" errors

  readonly events = new EventEmitter<IPCSystemEvents>()

  /**
   * Creates an IPC instance bound to the given namespace.
   * All addons that create an IPC with the same namespace can communicate.
   * @param options - Configuration options (see {@link IPCOptions})
   */
  constructor(options: IPCOptions = {}) {
    this.#options = { ...DEFAULT_OPTIONS, ...options }
    this.#transport = new Transport(this.#options.namespace)
    this.#compressor = new Compressor(this.#options.compressThreshold)
    this.#chunker = new Chunker(this.#options.chunkSize)

    this.#transport.onReceive((payload) => {
      try {
        this.#handleReceive(payload)
      }
      catch (e) {
        this.events.emit(IPC_SYSTEM_EVENTS.ERROR, e as Error)
      }
    })
  }

  /**
   * Fire-and-forget: send data to an endpoint without expecting a response.
   * Use {@link on} on the receiving side to listen for these messages.
   * @param endpoint - The endpoint name
   * @param data - The data to send. If using a custom serializer, this is the typed value.
   * @example
   * ```ts
   * ipc.send('notify')
   * ```
   * @example
   * ```ts
   * ipc.send('notify', { message: 'hello' })
   * ```
   * @example
   * ```ts
   * ipc.send('notify', mySerializer, { message: 'hello' })
   * ```
   */
  send(endpoint: string): void
  send<T>(endpoint: string, data: NoInfer<T>): void
  send<T>(endpoint: string, serializer: Serializer<T>, data: NoInfer<T>): void
  send<T = never>(endpoint: string, serializerOrData?: Serializer<T> | T, data?: T): void {
    const id = generateId()
    const d = data !== undefined
      ? (serializerOrData as Serializer<T>).serialize(data as T)
      : (serializerOrData as T)
    const packet: Packet = { v: PROTOCOL_VERSION, id, e: endpoint, d }
    this.#sendPacket(packet)
  }

  /**
   * Register a listener for fire-and-forget messages on an endpoint.
   * Paired with {@link send} on the other side.
   * Returns an unsubscribe function.
   * @param endpoint - The endpoint name to listen on
   * @param handler - Called with the deserialized data each time a message arrives
   * @returns A function that unsubscribes this listener
   * @example
   * ```ts
   * const off = ipc.on<string>('chat', (msg) => {
   *   console.log(msg)
   * })
   * // later: off()
   * ```
   * @example
   * ```ts
   * ipc.on('data', myDeserializer, (data) => {
   *   console.log(data)
   * })
   * ```
   */
  on<T>(endpoint: string, handler: (data: T) => void): () => void
  on<T>(endpoint: string, deserializer: Deserializer<T>, handler: (data: T) => void): () => void
  on<T>(
    endpoint: string,
    deserializerOrHandler: Deserializer<T> | ((data: T) => void),
    handler?: (data: T) => void,
  ): () => void {
    let deserializer: Deserializer<T> | undefined
    let userHandler: (data: T) => void

    if (handler !== undefined) {
      deserializer = deserializerOrHandler as Deserializer<T>
      userHandler = handler
    }
    else {
      userHandler = deserializerOrHandler as (data: T) => void
    }

    const wrapped = (raw: unknown): void => {
      const data = deserializer
        ? deserializer.deserialize(raw as string)
        : (raw as T)
      userHandler(data)
    }

    let handlers = this.#onHandlers.get(endpoint)
    if (!handlers) {
      handlers = new Set()
      this.#onHandlers.set(endpoint, handlers)
    }
    handlers.add(wrapped)

    return () => {
      handlers!.delete(wrapped)
      if (handlers!.size === 0) {
        this.#onHandlers.delete(endpoint)
      }
    }
  }

  /**
   * Sends a request to the other side and waits for the handler's response.
   * Must be paired with {@link handle} on the receiving side.
   * The returned promise resolves with the handler's return value or rejects if
   * no handler is registered or the handler throws.
   * @param endpoint - The endpoint name to invoke
   * @param data - The data to send to the handler
   * @returns A promise that resolves with the handler's return value
   * @example
   * ```ts
   * const result = await ipc.invoke<{ x: number }, { y: string }>('calc', { x: 21 })
   * ```
   * @example
   * ```ts
   * const result = await ipc.invoke('calc', mySerializer, myDeserializer, data)
   * ```
   * @example
   * ```ts
   * const result = await ipc.invoke<string>('ping')
   * ```
   */
  invoke<R = unknown>(endpoint: string): Promise<R>
  invoke<T = unknown, R = unknown>(endpoint: string, data: T): Promise<R>
  invoke<T = unknown, R = unknown>(
    endpoint: string,
    serializer: Serializer<T>,
    deserializer: Deserializer<R>,
    data: T,
  ): Promise<R>
  invoke<T = never, R = unknown>(
    endpoint: string,
    serializerOrData?: Serializer<T> | T,
    deserializer?: Deserializer<R>,
    data?: T,
  ): Promise<R> {
    let serializer: Serializer<T> | undefined
    let value: T

    if (data !== undefined) {
      serializer = serializerOrData as Serializer<T>
      value = data as T
    }
    else {
      value = serializerOrData as T
    }

    return this.#invokeImpl(endpoint, value, serializer, deserializer)
  }

  /**
   * Register a responder for an endpoint.
   * Must be paired with {@link invoke} on the other side.
   * The handler can return a value or a Promise. Throwing will cause the invoke to reject.
   * Only one handler can be registered per endpoint — duplicate registration throws.
   * @param endpoint - The endpoint name to handle
   * @param handler - Called with the deserialized data when an invoke arrives. Return a value or a Promise.
   * @returns A function that unregisters this handler
   * @throws {Error} If a handler is already registered for this endpoint
   * @example
   * ```ts
   * const off = ipc.handle<{ x: number }, { y: string }>('calc', async (req) => {
   *   return { y: String(req.x * 2) }
   * })
   * // later: off()
   * ```
   */
  handle<T, R>(
    endpoint: string,
    handler: (data: T) => R | Promise<R>,
  ): () => void {
    if (this.#handleHandlers.has(endpoint)) {
      throw new Error(`Handler already registered for endpoint "${endpoint}"`)
    }

    this.#handleHandlers.set(endpoint, handler as (data: unknown) => unknown | Promise<unknown>)

    return () => {
      this.#handleHandlers.delete(endpoint)
    }
  }

  #invokeImpl<T, R>(
    endpoint: string,
    data: T,
    serializer?: Serializer<T>,
    deserializer?: Deserializer<R>,
  ): Promise<R> {
    const id = generateId()
    const d = serializer ? serializer.serialize(data) : data
    const packet: Packet = { v: PROTOCOL_VERSION, id, e: endpoint, d }

    return new Promise<R>((resolve, reject) => {
      this.#sentIds.add(id)

      this.#responses.once(`${RESPONSE_EVENT_PREFIX}${id}`, (response: unknown) => {
        this.#sentIds.delete(id)
        const resp = response as ResponseData<R> | ErrorResponseData
        if (resp.ok) {
          const r = deserializer
            ? deserializer.deserialize(resp.data as unknown as string)
            : (resp.data as R)
          resolve(r)
        }
        else {
          reject(new Error((resp as ErrorResponseData).err))
        }
      })

      this.#sendPacket(packet)
    })
  }

  #sendPacket(packet: Packet): void {
    const raw = JSON.stringify(packet)

    if (raw.length > this.#options.maxPacketSize) {
      throw new Error(
        `Packet too large (${raw.length} chars, max ${this.#options.maxPacketSize})`,
      )
    }

    const { value, compressed } = this.#compressor.compress(raw)

    if (value.length <= this.#options.chunkSize && !compressed) {
      this.#transport.send(value)
      return
    }

    const chunks = this.#chunker.split(packet.id, value, compressed)
    for (const chunk of chunks) {
      this.#transport.send(JSON.stringify(chunk))
    }
  }

  #handleReceive(payload: string): void {
    const parsed = JSON.parse(payload) as Packet | Chunk

    if ('v' in parsed) {
      this.#handleDirectPacket(parsed as Packet)
    }
    else if ('i' in parsed) {
      this.#handleChunk(parsed as Chunk)
    }
  }

  #handleDirectPacket(packet: Packet): void {
    const { e: endpoint, d: data, id } = packet

    // Response from an invoke — resolve/reject the pending promise by id
    if (endpoint === RESPONSE_ENDPOINT) {
      this.#responses.emit(`${RESPONSE_EVENT_PREFIX}${id}`, data)
      return
    }

    // Packet was sent by this instance itself (loopback via ScriptEvent)
    // Must check before handleHandler to prevent self-invocation of handle()
    if (this.#sentIds.has(id)) {
      this.#sentIds.delete(id)
      return
    }

    // Handle request — execute the registered responder and send back the result
    const handleHandler = this.#handleHandlers.get(endpoint)
    if (handleHandler) {
      Promise.resolve()
        .then(() => handleHandler(data))
        .then((result) => {
          this.#sendResponse(id, { ok: true, data: result })
        })
        .catch((err) => {
          this.#sendResponse(id, { ok: false, err: String(err) })
        })
      return
    }

    // Fire-and-forget — forward to all on() listeners
    const onHandlers = this.#onHandlers.get(endpoint)
    if (onHandlers) {
      for (const handler of onHandlers) {
        try {
          handler(data)
        }
        catch (e) {
          this.events.emit(IPC_SYSTEM_EVENTS.ERROR, e as Error)
        }
      }
      return
    }

    // No handler registered — notify the caller so invoke() doesn't hang
    this.#sendResponse(id, { ok: false, err: `No handler registered for "${endpoint}"` })
  }

  #handleChunk(chunk: Chunk): void {
    const result = this.#chunker.assemble(chunk)

    if (result.done) {
      const raw = this.#compressor.decompress(result.data, result.compressed)
      let packet: Packet
      try {
        packet = JSON.parse(raw) as Packet
      }
      catch {
        this.events.emit(IPC_SYSTEM_EVENTS.ERROR, new Error(`Failed to parse reassembled packet for chunk ${chunk.i}`))
        return
      }
      this.#handleDirectPacket(packet)
    }
  }

  #sendResponse(id: string, data: ResponseData | ErrorResponseData): void {
    const packet: Packet = {
      v: PROTOCOL_VERSION,
      id,
      e: RESPONSE_ENDPOINT,
      d: data,
    }
    this.#sendPacket(packet)
  }
}
