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
import { Transport } from './transport'
import { PROTOCOL_VERSION, RESPONSE_ENDPOINT } from './types'

const DEFAULT_OPTIONS: Required<IPCOptions> = {
  namespace: 'main',
  chunkSize: 1800,
  compressThreshold: 800,
  chunkTimeout: 5000,
  maxPacketSize: 1_000_000,
}

export interface IPCSystemEvents {
  'error': Error
  'chunk:timeout': { id: string }
}

let idCounter = 0

function generateId(): string {
  const r = ((Math.random() * 0x100000000) >>> 0).toString(16).slice(0, 6).toUpperCase()
  const c = (idCounter++ % 36).toString(36).toUpperCase()
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

  constructor(options: IPCOptions = {}) {
    this.#options = { ...DEFAULT_OPTIONS, ...options }
    this.#transport = new Transport(this.#options.namespace)
    this.#compressor = new Compressor(this.#options.compressThreshold)
    this.#chunker = new Chunker(this.#options.chunkSize, this.#options.chunkTimeout)

    this.#transport.onReceive((payload) => {
      try {
        this.#handleReceive(payload)
      }
      catch (e) {
        this.events.emit('error', e as Error)
      }
    })
  }

  // Fire-and-forget: send data to an endpoint without expecting a response
  send<T>(endpoint: string, data: NoInfer<T>): void
  send<T>(endpoint: string, serializer: Serializer<T>, data: NoInfer<T>): void
  send<T>(endpoint: string, serializerOrData: Serializer<T> | T, data?: T): void {
    const id = generateId()
    const d = data !== undefined
      ? (serializerOrData as Serializer<T>).serialize(data as T)
      : (serializerOrData as T)
    const packet: Packet = { v: PROTOCOL_VERSION, id, e: endpoint, d }
    this.#sendPacket(packet)
  }

  // Register a listener for fire-and-forget messages on an endpoint
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

  // Request-response: invoke a handler on the other side and await its return value
  invoke<T = unknown, R = unknown>(endpoint: string, data: T): Promise<R>
  invoke<T = unknown, R = unknown>(
    endpoint: string,
    serializer: Serializer<T>,
    deserializer: Deserializer<R>,
    data: T,
  ): Promise<R>
  invoke<T = unknown, R = unknown>(
    endpoint: string,
    serializerOrData: Serializer<T> | T,
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

  // Register a responder for an endpoint — must be paired with invoke() on the other side
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

      this.#responses.once(`resp:${id}`, (response: unknown) => {
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
      this.#responses.emit(`resp:${id}`, data)
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
        handler(data)
      }
      return
    }

    // Packet was sent by this instance itself (loopback via ScriptEvent) — ignore quietly
    if (this.#sentIds.has(id)) {
      this.#sentIds.delete(id)
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
        this.events.emit('error', new Error(`Failed to parse reassembled packet for chunk ${chunk.i}`))
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
