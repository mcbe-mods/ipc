import { readFileSync } from 'node:fs'
import { bench, describe } from 'vitest'
import { IPC } from '../src/ipc'
import { mockTransport } from './setup'

const DIST = readFileSync(new URL('../dist/index.mjs', import.meta.url), 'utf-8')
const SMALL = DIST.slice(0, 500)
const MEDIUM = DIST.slice(0, 5_000)
const LARGE = DIST

describe('IPC.send — fire-and-forget', () => {
  const ipc = new IPC({ namespace: 'bench' })

  bench('small (500 B — no compress, no chunk)', () => {
    mockTransport.send.mockClear()
    ipc.send('e', SMALL)
  })

  bench('medium (5 KB — compress, maybe no chunk if compressed < 1800)', () => {
    mockTransport.send.mockClear()
    ipc.send('e', MEDIUM)
  })

  bench('large (26 KB — compress + chunked)', () => {
    mockTransport.send.mockClear()
    ipc.send('e', LARGE)
  })
})

describe('IPC.send + on — full fire-and-forget cycle', () => {
  const ipc = new IPC({ namespace: 'cycle' })

  bench('small — send then simulate receive', () => {
    mockTransport.send.mockClear()
    ipc.send('e', SMALL)
    const payload = mockTransport.send.mock.calls[0][1]
    mockTransport.simulateReceive('ipc:cycle', payload)
  })

  bench('large — send (chunked) then simulate all chunks', () => {
    mockTransport.send.mockClear()
    ipc.send('e', LARGE)
    const calls = mockTransport.send.mock.calls
    for (const [, payload] of calls) {
      mockTransport.simulateReceive('ipc:cycle', payload)
    }
  })
})

describe('IPC.invoke + handle — RPC round-trip', () => {
  const ipc = new IPC({ namespace: 'rpc' })
  ipc.handle('echo', (d: string) => d)

  // Chunk field 'i' = packet id; Packet field 'id' = packet id
  function invokeId(call: unknown): string {
    const p = JSON.parse(call as string)
    return p.i ?? p.id
  }

  bench('small (500 B — no chunk, no compress) — invoke + response', async () => {
    mockTransport.send.mockClear()
    const p = ipc.invoke<string, string>('echo', SMALL)
    const id = invokeId(mockTransport.send.mock.calls[0][1])
    const resp = JSON.stringify({ v: 1, id, e: '@response', d: { ok: true, data: SMALL } })
    mockTransport.simulateReceive('ipc:rpc', resp)
    await p
  })

  bench('medium (5 KB — compress, maybe chunk) — invoke + response', async () => {
    mockTransport.send.mockClear()
    const p = ipc.invoke<string, string>('echo', MEDIUM)
    const id = invokeId(mockTransport.send.mock.calls[0][1])
    const resp = JSON.stringify({ v: 1, id, e: '@response', d: { ok: true, data: MEDIUM } })
    mockTransport.simulateReceive('ipc:rpc', resp)
    await p
  })

  bench('large (26 KB — compress + chunk) — invoke + response', async () => {
    mockTransport.send.mockClear()
    const p = ipc.invoke<string, string>('echo', LARGE)
    const id = invokeId(mockTransport.send.mock.calls[0][1])
    const resp = JSON.stringify({ v: 1, id, e: '@response', d: { ok: true, data: LARGE } })
    mockTransport.simulateReceive('ipc:rpc', resp)
    await p
  })
})

describe('compression ratio — payload size comparison', () => {
  const ipc = new IPC({ namespace: 'ratio' })

  bench('raw JSON vs compressed — small (500 B)', () => {
    mockTransport.send.mockClear()
    ipc.send('e', SMALL)
    const raw = JSON.stringify({ v: 1, id: '', e: 'e', d: SMALL })
    const sent = mockTransport.send.mock.calls[0][1]
    JSON.stringify({ raw: raw.length, sent: sent.length })
  })

  bench('raw JSON vs compressed — medium (5 KB)', () => {
    mockTransport.send.mockClear()
    ipc.send('e', MEDIUM)
    const raw = JSON.stringify({ v: 1, id: '', e: 'e', d: MEDIUM })
    const calls = mockTransport.send.mock.calls
    let sentLen = 0
    for (const [, payload] of calls) {
      sentLen += payload.length
    }
    JSON.stringify({ raw: raw.length, sent: sentLen })
  })

  bench('raw JSON vs compressed — large (26 KB)', () => {
    mockTransport.send.mockClear()
    ipc.send('e', LARGE)
    const raw = JSON.stringify({ v: 1, id: '', e: 'e', d: LARGE })
    const calls = mockTransport.send.mock.calls
    let sentLen = 0
    for (const [, payload] of calls) {
      sentLen += payload.length
    }
    JSON.stringify({ raw: raw.length, sent: sentLen })
  })
})
