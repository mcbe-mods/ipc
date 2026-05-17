export interface Serializer<T> {
  serialize: (value: T) => string
}

export interface Deserializer<T> {
  deserialize: (data: string) => T
}

export interface IPCOptions {
  namespace?: string
  chunkSize?: number
  compressThreshold?: number
  chunkTimeout?: number
  maxPacketSize?: number
}

export interface Packet<T = unknown> {
  v: 1
  id: string
  e: string
  d: T
}

export interface Chunk {
  i: string
  s: number
  t: number
  c?: 1
  d: string
}

export interface ResponseData<T = unknown> {
  ok: true
  data: T
}

export interface ErrorResponseData {
  ok: false
  err: string
}

export const RESPONSE_ENDPOINT = '@response'
export const PROTOCOL_VERSION = 1 as const
