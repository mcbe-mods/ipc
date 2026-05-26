import type { InvokeOptions } from './types'

const ID_RANDOM_BITS = 0x100000000
const ID_RANDOM_CHARS = 6
const ID_COUNTER_RADIX = 36

let idCounter = 0

/** Generate a short unique identifier for packet correlation (hex random + counter suffix). */
export function generateId(): string {
  const r = ((Math.random() * ID_RANDOM_BITS) >>> 0).toString(16).slice(0, ID_RANDOM_CHARS).toUpperCase()
  const c = (idCounter++ % ID_COUNTER_RADIX).toString(ID_COUNTER_RADIX).toUpperCase()
  return r + c
}

/**
 * Type guard: checks whether an unknown value is an {@link InvokeOptions} object.
 *  Uses a stricter check — requires `serializer` or `deserializer` to have
 *  an actual `serialize` / `deserialize` method.  The plain `timeout` key is
 *  no longer sufficient on its own to avoid false-positives when a data
 *  payload happens to contain that property name.
 *
 *  If you only need to pass a timeout without data, use the three-argument form:
 *  `invoke(channel, undefined, { timeout })`.
 */
export function isInvokeOptions(obj: unknown): obj is InvokeOptions {
  if (typeof obj !== 'object' || obj === null)
    return false
  const o = obj as Record<string, unknown>
  if ('serializer' in o && typeof o.serializer === 'object' && o.serializer !== null) {
    if (typeof (o.serializer as Record<string, unknown>).serialize === 'function')
      return true
  }
  if ('deserializer' in o && typeof o.deserializer === 'object' && o.deserializer !== null) {
    if (typeof (o.deserializer as Record<string, unknown>).deserialize === 'function')
      return true
  }
  return false
}
