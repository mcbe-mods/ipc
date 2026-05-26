import type { IPCEvents } from './events'

import type {
  Chunk,
  ErrorResponseData,
  HandleOptions,
  InvokeOptions,
  IPCOptions,
  OnOptions,
  Packet,
  ResponseData,
  SendOptions,
} from './types'
import { system } from '@minecraft/server'
import { EventEmitter } from 'mini-emit'
import { Chunker } from './chunk'
import { Compressor } from './compress'
import { PROTOCOL_VERSION, SYSTEM_DOMAINS } from './constants'
import { EVENTS, SYSTEM_EVENTS } from './events'
import { Transport } from './transport'
import { generateId, isInvokeOptions } from './utils'

const DEFAULT_OPTIONS: Required<IPCOptions> = {
  namespace: 'global',
  chunkSize: 1800,
  compressThreshold: 800,
  maxPacketSize: 1_000_000,
  invokeTimeout: 30_000,
  chunkTimeout: 30_000,
}

/**
 * IPC (Inter-Pack Communication) — message passing between Minecraft Bedrock behavior packs.
 *
 * Built on top of `/scriptevent`, supports:
 * - Fire-and-forget messaging (`send` / `on`)
 * - Request-response RPC (`invoke` / `handle`)
 * - Automatic chunking of large payloads
 * - Optional LZ-String compression
 *
 * @example
 * ```ts
 * const ipc = new IPC({ namespace: 'myAddon' })
 * ipc.send('chat', { text: 'hello' })
 * ipc.on('chat', (msg) => console.log(msg))
 * ```
 */
export class IPC {
  readonly #options: Required<IPCOptions>
  readonly #transport: Transport
  readonly #compressor: Compressor
  readonly #chunker: Chunker
  readonly #onHandlers = new Map<string, Set<(data: unknown) => void>>()
  readonly #handleHandlers = new Map<string, (data: unknown) => unknown | Promise<unknown>>()
  readonly #responses = new EventEmitter<Record<string, unknown>>()
  readonly #sentIds = new Set<string>()
  #transportUnsubscribe: () => void

  /**
   * System-level event emitter for internal IPC events.
   * See {@link EVENTS} for available events.
   */
  readonly events = new EventEmitter<IPCEvents>()

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

    this.#transportUnsubscribe = this.#transport.onReceive((systemDomain, route, payload) => {
      try {
        this.#handleReceive(systemDomain, route, payload)
      }
      catch (e) {
        this.events.emit(EVENTS.ERROR, e as Error)
      }
    })
  }

  /**
   * Destroy this IPC instance.
   * Unsubscribes from the transport, clears all handlers and pending responses.
   * After calling this, the instance will no longer receive or process any messages.
   */
  dispose(): void {
    this.#transportUnsubscribe()
    this.#onHandlers.clear()
    this.#handleHandlers.clear()
    this.#sentIds.clear()
    this.#responses.clear()
  }

  /**
   * Fire-and-forget: send data to a channel without expecting a response.
   * Use {@link on} on the receiving side to listen for these messages.
   * @param channel - The channel name
   * @param data - The data to send. If using a custom serializer, this is the typed value.
   * @param options - Optional settings (serializer)
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
   * ipc.send('notify', { message: 'hello' }, { serializer: mySerializer })
   * ```
   */
  send(channel: string): void
  send<T>(channel: string, data: T): void
  send<T>(channel: string, data: T, options: SendOptions<T>): void
  send<T = never>(channel: string, data?: T, options?: SendOptions<T>): void {
    const id = generateId()
    this.#sentIds.add(id)
    const serialized = options?.serializer && data !== undefined
      ? options.serializer.serialize(data)
      : data
    const packet: Packet = { version: PROTOCOL_VERSION, id, channel, data: serialized }
    this.#sendPacket(SYSTEM_DOMAINS.USER, packet)
  }

  /**
   * Register a listener for fire-and-forget messages on a channel.
   * Paired with {@link send} on the other side.
   * Returns an unsubscribe function.
   * @param channel - The channel name to listen on
   * @param handler - Called with the deserialized data each time a message arrives
   * @param options - Optional settings (deserializer)
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
   * ipc.on('data', (data) => {
   *   console.log(data)
   * }, { deserializer: myDeserializer })
   * ```
   */
  on<T>(channel: string, handler: (data: T) => void): () => void
  on<T>(channel: string, handler: (data: T) => void, options: OnOptions<T>): () => void
  on<T>(
    channel: string,
    handler: (data: T) => void,
    options?: OnOptions<T>,
  ): () => void {
    const wrapped = (raw: unknown): void => {
      const data = options?.deserializer
        ? options.deserializer.deserialize(raw as string)
        : (raw as T)
      handler(data)
    }

    let handlers = this.#onHandlers.get(channel)
    if (!handlers) {
      handlers = new Set()
      this.#onHandlers.set(channel, handlers)
    }
    handlers.add(wrapped)

    return () => {
      handlers!.delete(wrapped)
      if (handlers!.size === 0) {
        this.#onHandlers.delete(channel)
      }
    }
  }

  /**
   * Sends a request to the other side and waits for the handler's response.
   * Must be paired with {@link handle} on the receiving side.
   * The returned promise resolves with the handler's return value or rejects if
   * no handler is registered or the handler throws.
   * @param channel - The channel name to invoke
   * @param data - The data to send to the handler
   * @param options - Optional settings (timeout, serializer, deserializer)
   * @returns A promise that resolves with the handler's return value
   * @example
   * ```ts
   * const result = await ipc.invoke<{ x: number }, { y: string }>('calc', { x: 21 })
   * ```
   * @example
   * ```ts
   * const result = await ipc.invoke('calc', { x: 21 }, { timeout: 5000 })
   * ```
   * @example
   * ```ts
   * const result = await ipc.invoke<string>('ping')
   * ```
   * @example
   * ```ts
   * const result = await ipc.invoke('calc', data, { serializer: mySer, timeout: 5000 })
   * ```
   */
  invoke<R = unknown>(channel: string): Promise<R>
  invoke<R = unknown>(channel: string, options: InvokeOptions<never, R>): Promise<R>
  invoke<T = never, R = unknown>(channel: string, data: T, options?: InvokeOptions<T, R>): Promise<R>
  invoke<T = never, R = unknown>(
    channel: string,
    dataOrOptions?: T | InvokeOptions<never, R>,
    options?: InvokeOptions<T, R>,
  ): Promise<R> {
    if (dataOrOptions === undefined) {
      return this.#invokeImpl(channel, undefined, options)
    }

    if (isInvokeOptions(dataOrOptions)) {
      return this.#invokeImpl(channel, undefined, dataOrOptions)
    }

    return this.#invokeImpl(channel, dataOrOptions as T, options)
  }

  /**
   * Register a responder for a channel.
   * Must be paired with {@link invoke} on the other side.
   * The handler can return a value or a Promise. Throwing will cause the invoke to reject.
   * Only one handler can be registered per channel — duplicate registration throws.
   * @param channel - The channel name to handle
   * @param handler - Called with the deserialized data when an invoke arrives. Return a value or a Promise.
   * @param options - Optional settings (deserializer)
   * @returns A function that unregisters this handler
   * @throws {Error} If a handler is already registered for this channel
   * @example
   * ```ts
   * const off = ipc.handle<{ x: number }, { y: string }>('calc', async (req) => {
   *   return { y: String(req.x * 2) }
   * })
   * // later: off()
   * ```
   * @example
   * ```ts
   * ipc.handle('calc', (req) => {
   *   return req * 2
   * }, { deserializer: { deserialize: (s: string) => Number(s) } })
   * ```
   */
  handle<T, R>(channel: string, handler: (data: T) => R | Promise<R>): () => void
  handle<T, R>(channel: string, handler: (data: T) => R | Promise<R>, options: HandleOptions<T>): () => void
  handle<T, R>(
    channel: string,
    handler: (data: T) => R | Promise<R>,
    options?: HandleOptions<T>,
  ): () => void {
    if (this.#handleHandlers.has(channel)) {
      throw new Error(`Handler already registered for channel "${channel}"`)
    }

    const wrapped = options?.deserializer
      ? (raw: unknown) => handler(options.deserializer!.deserialize(raw as string))
      : handler

    this.#handleHandlers.set(channel, wrapped as (data: unknown) => unknown | Promise<unknown>)

    return () => {
      this.#handleHandlers.delete(channel)
    }
  }

  #invokeImpl<T, R>(
    channel: string,
    data?: T,
    options?: InvokeOptions<T, R>,
  ): Promise<R> {
    const id = generateId()
    const d = options?.serializer ? options.serializer.serialize(data as T) : data
    const packet: Packet = { version: PROTOCOL_VERSION, id, channel, data: d }
    const timeout = options?.timeout ?? this.#options.invokeTimeout

    return new Promise<R>((resolve, reject) => {
      let settled = false
      let timeoutId: number | undefined

      const cleanup = (): void => {
        if (settled)
          return
        settled = true
        if (timeoutId !== undefined)
          system.clearRun(timeoutId)
      }

      this.#sentIds.add(id)

      this.#responses.once(`${SYSTEM_EVENTS.INVOKE_RESPONSE}:${id}`, (response: unknown) => {
        cleanup()
        this.#sentIds.delete(id)
        const resp = response as ResponseData<R> | ErrorResponseData
        if (resp.ok) {
          const r = options?.deserializer
            ? options.deserializer.deserialize(resp.data as unknown as string)
            : (resp.data as R)
          resolve(r)
        }
        else {
          reject(new Error((resp as ErrorResponseData).err))
        }
      })

      if (timeout > 0) {
        const ticks = Math.ceil(timeout / 50)
        timeoutId = system.runTimeout(() => {
          if (settled)
            return
          settled = true
          this.#sentIds.delete(id)
          reject(new Error(`Invoke timed out for channel "${channel}"`))
        }, ticks)
      }

      this.#sendPacket(SYSTEM_DOMAINS.USER, packet)
    })
  }

  #sendPacket(systemDomain: string, packet: Packet): void {
    const raw = JSON.stringify(packet)

    if (raw.length > this.#options.maxPacketSize) {
      throw new Error(
        `Packet too large (${raw.length} chars, max ${this.#options.maxPacketSize})`,
      )
    }

    const { value, compressed } = this.#compressor.compress(raw)
    const route = systemDomain === SYSTEM_DOMAINS.USER ? packet.channel : packet.id

    if (value.length <= this.#options.chunkSize && !compressed) {
      this.#transport.send(systemDomain, route, value)
      return
    }

    const chunks = this.#chunker.split(packet.id, value, compressed)
    for (const chunk of chunks) {
      this.#transport.send(systemDomain, route, JSON.stringify(chunk))
    }
  }

  #handleReceive(systemDomain: string, route: string, payload: string): void {
    if (systemDomain === SYSTEM_DOMAINS.RESPONSE) {
      const parsed = JSON.parse(payload) as Packet | Chunk
      if ('version' in parsed) {
        const packet = parsed as Packet
        if (!this.#checkVersion(packet))
          return
        this.#responses.emit(`${SYSTEM_EVENTS.INVOKE_RESPONSE}:${route}`, packet.data)
      }
      else if ('seq' in parsed) {
        this.#handleChunk(parsed as Chunk, systemDomain, route)
      }
      return
    }

    if (systemDomain !== SYSTEM_DOMAINS.USER) {
      return
    }

    if (!this.#onHandlers.has(route) && !this.#handleHandlers.has(route)) {
      return
    }

    const parsed = JSON.parse(payload) as Packet | Chunk

    if ('version' in parsed) {
      this.#handleDirectPacket(parsed as Packet)
    }
    else if ('seq' in parsed) {
      this.#handleChunk(parsed as Chunk, systemDomain, route)
    }
    else {
      this.events.emit(EVENTS.INVALID_PACKET, { payload })
    }
  }

  #checkVersion(packet: Packet): boolean {
    if (packet.version !== PROTOCOL_VERSION) {
      this.events.emit(EVENTS.ERROR, new Error(
        `Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${packet.version} [channel: ${packet.channel}]`,
      ))
      return false
    }
    return true
  }

  #handleDirectPacket(packet: Packet): void {
    if (!this.#checkVersion(packet))
      return

    const { channel, data, id } = packet

    // Packet was sent by this instance itself (loopback via ScriptEvent)
    // Must check before handleHandler to prevent self-invocation of handle()
    if (this.#sentIds.has(id)) {
      this.#sentIds.delete(id)
      return
    }

    // Handle request — execute the registered responder and send back the result
    const handleHandler = this.#handleHandlers.get(channel)
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
    const onHandlers = this.#onHandlers.get(channel)
    if (onHandlers) {
      for (const handler of onHandlers) {
        try {
          handler(data)
        }
        catch (e) {
          this.events.emit(EVENTS.ERROR, e as Error)
        }
      }
      return
    }

    // No handler registered — notify the caller so invoke() doesn't hang
    this.#sendResponse(id, { ok: false, err: `No handler registered for "${channel}"` })
  }

  #handleChunk(chunk: Chunk, systemDomain: string, route: string): void {
    const result = this.#chunker.assemble(chunk, this.#options.chunkTimeout)

    if (result.done) {
      const raw = this.#compressor.decompress(result.data, result.compressed)
      let packet: Packet
      try {
        packet = JSON.parse(raw) as Packet
      }
      catch {
        this.events.emit(EVENTS.ERROR, new Error(`Failed to parse reassembled packet for chunk ${chunk.id}`))
        return
      }
      if (systemDomain === SYSTEM_DOMAINS.RESPONSE) {
        if (!this.#checkVersion(packet))
          return
        this.#responses.emit(`${SYSTEM_EVENTS.INVOKE_RESPONSE}:${route}`, packet.data)
      }
      else {
        this.#handleDirectPacket(packet)
      }
    }
  }

  #sendResponse(id: string, data: ResponseData | ErrorResponseData): void {
    const packet: Packet = {
      version: PROTOCOL_VERSION,
      id,
      channel: SYSTEM_DOMAINS.RESPONSE,
      data,
    }
    this.#sendPacket(SYSTEM_DOMAINS.RESPONSE, packet)
  }
}
