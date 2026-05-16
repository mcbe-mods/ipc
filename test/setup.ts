import { vi } from 'vitest'

// Mock @minecraft/server for testing
const scriptEventListeners = new Set<(event: { id: string, message: string, sourceType: string }) => void>()
const timeoutHandlers = new Map<number, () => void>()
let timeoutIdCounter = 0

export const mockTransport = {
  send: vi.fn(),
  receiveCallbacks: scriptEventListeners,
  simulateReceive(id: string, message: string) {
    for (const cb of scriptEventListeners) {
      cb({ id, message, sourceType: 'Server' })
    }
  },
}

export function triggerTimeouts(): void {
  for (const [, cb] of timeoutHandlers) {
    cb()
  }
  timeoutHandlers.clear()
}

vi.mock('@minecraft/server', () => ({
  system: {
    sendScriptEvent: vi.fn((id: string, message: string) => {
      mockTransport.send(id, message)
    }),
    runTimeout: vi.fn((callback: () => void, _tickDelay: number) => {
      const id = ++timeoutIdCounter
      timeoutHandlers.set(id, callback)
      return id
    }),
    clearRun: vi.fn((id: number) => {
      timeoutHandlers.delete(id)
    }),
    afterEvents: {
      scriptEventReceive: {
        subscribe: vi.fn((callback: (event: any) => void) => {
          scriptEventListeners.add(callback)
        }),
        unsubscribe: vi.fn((callback: (event: any) => void) => {
          scriptEventListeners.delete(callback)
        }),
      },
    },
  },
  ScriptEventSource: {
    Server: 'Server',
  },
}))

vi.mock('@mcbe-mods/utils', () => ({
  calcGameTicks: vi.fn((ms: number) => Math.ceil(ms / 50)),
}))
