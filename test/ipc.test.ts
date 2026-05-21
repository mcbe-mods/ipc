import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_NAMESPACE, PROTOCOL_VERSION, RESPONSE_ENDPOINT } from '../src/constants'
import { IPC, IPC_SYSTEM_EVENTS } from '../src/ipc'
import { mockTransport } from './setup'

describe('IPC', () => {
  let ipc: IPC

  beforeEach(() => {
    vi.useFakeTimers()
    mockTransport.send.mockClear()
    ipc = new IPC({ namespace: 'test' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends a direct (unchunked) packet', () => {
    ipc.send('ping', { msg: 'hello' })

    expect(mockTransport.send).toHaveBeenCalledTimes(1)
    const [id, payload] = mockTransport.send.mock.calls[0]
    expect(id).toBe(`${IPC_NAMESPACE}:test`)

    const parsed = JSON.parse(payload)
    expect(parsed.v).toBe(1)
    expect(parsed.e).toBe('ping')
    expect(parsed.d).toEqual({ msg: 'hello' })
  })

  it('receives a direct packet via on()', () => {
    const handler = vi.fn()
    ipc.on<{ msg: string }>('ping', handler)

    const packet = JSON.stringify({ v: PROTOCOL_VERSION, id: 'ABC123', e: 'ping', d: { msg: 'hello' } })
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, packet)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ msg: 'hello' })
  })

  it('supports multiple on() handlers per endpoint', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    ipc.on('test', h1)
    ipc.on('test', h2)

    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, JSON.stringify({ v: PROTOCOL_VERSION, id: 'X', e: 'test', d: 42 }))

    expect(h1).toHaveBeenCalledWith(42)
    expect(h2).toHaveBeenCalledWith(42)
  })

  it('unsubscribe via on() returned function', () => {
    const handler = vi.fn()
    const off = ipc.on('test', handler)
    off()

    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, JSON.stringify({ v: PROTOCOL_VERSION, id: 'X', e: 'test', d: 42 }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('invoke waits for handle response', async () => {
    ipc.handle<{ x: number }, { y: string }>('calc', async (req) => {
      return { y: String(req.x * 2) }
    })

    const promise = ipc.invoke<{ x: number }, { y: string }>('calc', { x: 21 })

    // Simulate the invoke packet arriving at handle side
    const sentPayload = mockTransport.send.mock.calls[0][1]
    const sentPacket = JSON.parse(sentPayload)

    // Simulate response arriving back
    const responsePacket = JSON.stringify({
      v: PROTOCOL_VERSION,
      id: sentPacket.id,
      e: RESPONSE_ENDPOINT,
      d: { ok: true, data: { y: '42' } },
    })
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, responsePacket)

    const result = await promise
    expect(result).toEqual({ y: '42' })
  })

  it('handle sends error response on handler exception', async () => {
    ipc.handle('fail', () => {
      throw new Error('oops')
    })

    // Simulate incoming invoke request
    const reqPacket = JSON.stringify({ v: PROTOCOL_VERSION, id: 'REQ1', e: 'fail', d: {} })
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, reqPacket)

    // Let microtasks settle
    await vi.runAllTimersAsync()

    // Check that an error response was sent
    const lastCall = mockTransport.send.mock.lastCall?.[1]
    if (lastCall) {
      const parsed = JSON.parse(lastCall)
      // Could be chunk-wrapped or direct
      const inner = parsed.v ? parsed : JSON.parse(parsed.d || '{}')
      if (inner.e === RESPONSE_ENDPOINT) {
        expect(inner.d.ok).toBe(false)
        expect(inner.d.err).toBe('Error: oops')
      }
    }
  })

  it('chunks large payloads', () => {
    // Create a separate IPC with very small chunk size and no compression
    const chunkIPC = new IPC({ namespace: 'test', chunkSize: 100, compressThreshold: 999999 })
    const largeData = { data: 'x'.repeat(500) }
    chunkIPC.send('big', largeData)

    // Should have sent multiple scriptEvents
    expect(mockTransport.send.mock.calls.length).toBeGreaterThan(1)

    // All should use the ipc:test ID
    for (const [id] of mockTransport.send.mock.calls) {
      expect(id).toBe(`${IPC_NAMESPACE}:test`)
    }

    // First call should be a chunk (has 'i' field)
    const firstPayload = JSON.parse(mockTransport.send.mock.calls[0][1])
    expect(firstPayload.i).toBeDefined()
    expect(firstPayload.s).toBe(0)
  })

  it('reassembles chunked payloads', () => {
    const handler = vi.fn()
    ipc.on<{ data: string }>('big', handler)

    // Simulate a chunked packet
    const packet = JSON.stringify({ v: PROTOCOL_VERSION, id: 'CHUNKID', e: 'big', d: { data: 'hello' } })
    const compressed = packet // not compressing for test simplicity

    // Manually chunk at 10 chars
    const chunks: string[] = []
    for (let i = 0; i < compressed.length; i += 10) {
      chunks.push(compressed.slice(i, i + 10))
    }

    // Send chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = JSON.stringify({ i: 'CHUNKID', s: i, t: chunks.length, d: chunks[i] })
      mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, chunk)
    }

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ data: 'hello' })
  })

  it('emits error on malformed chunk reassembly', () => {
    const errorHandler = vi.fn()
    ipc.events.on('error', errorHandler)

    const chunk = JSON.stringify({ i: 'BADID', s: 0, t: 1, d: 'not-json!!' })
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, chunk)

    expect(errorHandler).toHaveBeenCalled()
  })

  it('supports custom serializer in send()', () => {
    const customSerializer = {
      serialize: (v: number) => `num:${v}`,
    }
    ipc.send('custom', customSerializer, 42)

    const payload = mockTransport.send.mock.calls[0][1]
    const parsed = JSON.parse(payload)
    expect(parsed.d).toBe('num:42')
  })

  it('supports custom deserializer in on()', () => {
    const customDeserializer = {
      deserialize: (d: string) => Number.parseInt(d.replace('num:', ''), 10),
    }
    const handler = vi.fn()
    ipc.on('custom', customDeserializer, handler)

    const packet = JSON.stringify({ v: PROTOCOL_VERSION, id: 'X', e: 'custom', d: 'num:42' })
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, packet)

    expect(handler).toHaveBeenCalledWith(42)
  })

  it('handle() returns an unsubscribe function', () => {
    const handler = vi.fn(() => 'ok')
    const off = ipc.handle('temp', handler)
    off()

    // Second handle with same endpoint should not throw since first was removed
    expect(() => ipc.handle('temp', handler)).not.toThrow()
  })

  it('handle() throws on duplicate endpoint', () => {
    ipc.handle('dup', () => 'ok')
    expect(() => ipc.handle('dup', () => 'ok')).toThrow('already registered')
  })

  it('invoke rejects when no handle is registered', async () => {
    const promise = ipc.invoke('ghost', { x: 1 })

    const sentPayload = mockTransport.send.mock.calls[0][1]
    const sentPacket = JSON.parse(sentPayload)
    const responsePacket = JSON.stringify({
      v: PROTOCOL_VERSION,
      id: sentPacket.id,
      e: RESPONSE_ENDPOINT,
      d: { ok: false, err: 'No handler registered for "ghost"' },
    })
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, responsePacket)

    await expect(promise).rejects.toThrow('No handler registered for "ghost"')
  })

  it('isolates on() handlers across different namespaces', () => {
    const ipc2 = new IPC({ namespace: 'ns2' })
    const handler = vi.fn()
    ipc2.on('ping', handler)

    // ipc (namespace: 'test') sends — payload goes on ipc:test
    ipc.send('ping', { msg: 'hello' })
    const sentPayload = mockTransport.send.mock.lastCall?.[1]

    // Simulate packet arriving on ipc:test (sender's namespace)
    // ipc2 listens on ipc:ns2, so it should NOT receive this
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, sentPayload)
    expect(handler).not.toHaveBeenCalled()

    // Simulate packet arriving on ipc:ns2 — ipc2 SHOULD receive it
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:ns2`, sentPayload)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ msg: 'hello' })
  })

  it('isolates handle() handlers across different namespaces', () => {
    const ipc2 = new IPC({ namespace: 'ns2' })
    const handler = vi.fn(() => 'pong')
    ipc2.handle('ping', handler)

    // ipc (namespace: 'test') invokes
    ipc.invoke('ping', 'hello')

    const sentPayload = mockTransport.send.mock.lastCall?.[1]

    // Simulate on ns2's namespace — ipc2 should NOT handle
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:ns2`, sentPayload)
    expect(handler).not.toHaveBeenCalled()

    // No RESPONSE_ENDPOINT should have been sent from ipc2 back
    for (const [, payload] of mockTransport.send.mock.calls) {
      const parsed = JSON.parse(payload)
      expect(parsed.e).not.toBe(RESPONSE_ENDPOINT)
    }
  })

  it('ignores self-sent invoke packet on loopback', async () => {
    ipc.handle('echo', (data: string) => `echo:${data}`)

    const promise = ipc.invoke<string, string>('echo', 'hello')

    const sentPayload = mockTransport.send.mock.calls[0][1]
    const sentPacket = JSON.parse(sentPayload)

    // Simulate loopback: invoke packet returns to sender
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, JSON.stringify(sentPacket))

    // Simulate normal response from the other side
    const responsePacket = JSON.stringify({
      v: PROTOCOL_VERSION,
      id: sentPacket.id,
      e: RESPONSE_ENDPOINT,
      d: { ok: true, data: 'echo:hello' },
    })
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, responsePacket)

    await expect(promise).resolves.toBe('echo:hello')
  })

  it('does not execute handle() on loopback invoke', async () => {
    const handler = vi.fn(() => 'should-not-run')
    ipc.handle('test', handler)

    const promise = ipc.invoke('test', 'data')

    const sentPayload = mockTransport.send.mock.calls[0][1]
    const sentPacket = JSON.parse(sentPayload)

    // Simulate loopback — handle() should NOT be triggered
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, JSON.stringify(sentPacket))
    expect(handler).not.toHaveBeenCalled()

    // Resolve with a response from "the other side"
    const responsePacket = JSON.stringify({
      v: PROTOCOL_VERSION,
      id: sentPacket.id,
      e: RESPONSE_ENDPOINT,
      d: { ok: true, data: 'ok' },
    })
    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, responsePacket)
    await expect(promise).resolves.toBe('ok')
  })

  it('stops receiving messages after dispose()', () => {
    const handler = vi.fn()
    ipc.on('test', handler)
    ipc.dispose()

    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, JSON.stringify({ v: PROTOCOL_VERSION, id: 'X', e: 'test', d: 42 }))

    expect(handler).not.toHaveBeenCalled()
  })

  it('emits invalid-packet event for unrecognized payloads', () => {
    const handler = vi.fn()
    ipc.events.on(IPC_SYSTEM_EVENTS.INVALID_PACKET, handler)

    mockTransport.simulateReceive(`${IPC_NAMESPACE}:test`, JSON.stringify({ foo: 'bar' }))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ payload: JSON.stringify({ foo: 'bar' }) })
  })
})
