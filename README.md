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
import { IPC } from '@mcbe-mods/ipc'

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

### Cancel subscription

```ts
const off = ipc.on('chat', handler)
off()
```

### Custom serializer

```ts
import type { Deserializer, Serializer } from '@mcbe-mods/ipc'

const mySer: Serializer<MyType> = { serialize: v => JSON.stringify(v) }
const myDeser: Deserializer<MyType> = { deserialize: s => JSON.parse(s) }

ipc.send('channel', mySer, data)
ipc.on('channel', myDeser, (data) => {
  // ...
})
```

## Options

```ts
interface IPCOptions {
  namespace?: string // scriptEvent ID: ipc:<namespace> (default: 'main')
  chunkSize?: number // max chars per chunk (default: 1800)
  compressThreshold?: number // auto-compress above this size (default: 800)
  chunkTimeout?: number // chunk reassembly timeout in ms (default: 5000)
  maxPacketSize?: number // max raw JSON length (default: 1000000)
}
```

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
