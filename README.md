# @mcbe-mods/ipc

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![License][license-src]][license-href]

Inter-Pack Communication system for Minecraft Bedrock Edition Script API.

Built on `scriptEvent` — no commands, no binary protocols, just JSON + LZ-string compression + chunked transfer.

## Install

```bash
npm install @mcbe-mods/ipc
```

## Usage

```ts
import { IPC, IPC_SYSTEM_EVENTS } from '@mcbe-mods/ipc'

const ipc = new IPC({ namespace: 'myAddon' })
// scriptEvent ID → ipc:myAddon
```

### One-way message

```ts
ipc.send('chat', { text: 'hello', sender: 'alice' })

ipc.on<{ text: string, sender: string }>('chat', (data) => {
  console.log(data.text)
})
```

### Request / Response (RPC)

```ts
const res = await ipc.invoke<Req, Res>('inv.get', { slot: 5 })

ipc.handle<Req, Res>('inv.get', (req) => {
  return { item: 'stone', count: 1 }
})
```

### Timeout

```ts
// Per-call: reject after 5 seconds if no response
const res = await ipc.invoke('ping', data, { timeout: 5000 })

// Global default: all invocations use 30s timeout (configurable)
const ipc = new IPC({ invokeTimeout: 10_000 })

// Disable timeout entirely
const res = await ipc.invoke('ping', data, { timeout: 0 })
```

### Cancel subscription

```ts
const off = ipc.on('chat', handler)
off()
```

### Lifecycle

```ts
// Destroy the instance — unsubscribes from transport, clears all handlers
ipc.dispose()
```

### Custom serializer

```ts
import type { Deserializer, Serializer } from '@mcbe-mods/ipc'

const mySer: Serializer<MyType> = { serialize: v => JSON.stringify(v) }
const myDeser: Deserializer<MyType> = { deserialize: s => JSON.parse(s) }

// Fire-and-forget with serializer
ipc.send('channel', mySer, data)

// Receive with deserializer
ipc.on('channel', myDeser, (data) => {
  // ...
})

// RPC with serializer/deserializer via InvokeOptions
const res = await ipc.invoke('calc', data, {
  serializer: mySer,
  deserializer: myDeser,
  timeout: 5000,
})
```

## Options

```ts
interface IPCOptions {
  /**
   * Namespace for script events: `ipc:<namespace>`.
   * All addons with the same namespace can communicate.
   * @default 'global'
   */
  namespace?: string
  /**
   * Max bytes per chunk before splitting.
   *
   * Minecraft's `/scriptevent` has a **2048-byte** limit:
   * @see https://learn.microsoft.com/en-us/minecraft/creator/reference/content/commandsreference/examples/commands/scriptevent?view=minecraft-bedrock-stable#usage
   *
   * With Base64, 1 char = 1 byte, so safe value satisfies
   * `chunkSize + JSON(wrapper) ≤ 2048`.
   * @default 1800
   */
  chunkSize?: number
  /**
   * Raw JSON payloads larger than this are lz-string compressed before sending.
   * @default 800
   */
  compressThreshold?: number
  /**
   * Max serialized packet size in characters. Throws if exceeded.
   * @default 1_000_000
   */
  maxPacketSize?: number
  /**
   * Default timeout for invoke() in milliseconds.
   * Set to 0 to disable. Per-call override via InvokeOptions.
   * @default 30_000
   */
  invokeTimeout?: number
}
```

## Events

System-level events emitted by `ipc.events` — listen with type safety via `IPC_SYSTEM_EVENTS`:

```ts
ipc.events.on(IPC_SYSTEM_EVENTS.ERROR, (err) => {
  console.error('IPC error:', err.message)
})

ipc.events.on(IPC_SYSTEM_EVENTS.INVALID_PACKET, ({ payload }) => {
  console.warn('Received unrecognized payload:', payload)
})
```

| Event | Payload | When |
|-------|---------|------|
| `'error'` | `Error` | An internal error occurred (malformed chunk, parse failure, etc.) |
| `'invalid-packet'` | `{ payload: string }` | Received data that isn't a valid packet or chunk |

## License

[MIT](./LICENSE) License

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@mcbe-mods/ipc?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/@mcbe-mods/ipc
[npm-downloads-src]: https://img.shields.io/npm/dm/@mcbe-mods/ipc?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/@mcbe-mods/ipc
[bundle-src]: https://img.shields.io/bundlephobia/minzip/@mcbe-mods/ipc?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=@mcbe-mods/ipc
[license-src]: https://img.shields.io/github/license/mcbe-mods/ipc.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/mcbe-mods/ipc/blob/main/LICENSE
