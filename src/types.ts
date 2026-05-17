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
  v: 1 // protocol version
  id: string // unique request id for response matching
  e: string // endpoint name
  d: T // payload
}

export interface Chunk {
  i: string // packet id
  s: number // sequence index
  t: number // total chunks
  c?: 1 // compressed flag
  d: string // data slice (raw segment or lz-string compressed segment)
}

// Discriminated by ok — ok:true carries data, ok:false carries err
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
