import { vi } from 'vitest'

// Mock @minecraft/server for testing
const scriptEventListeners = new Set<(event: { id: string, message: string, sourceType: string }) => void>()

export const mockTransport = {
  send: vi.fn(),
  receiveCallbacks: scriptEventListeners,
  simulateReceive(id: string, message: string) {
    for (const cb of scriptEventListeners) {
      cb({ id, message, sourceType: 'Server' })
    }
  },
}

vi.mock('@minecraft/server', () => ({
  system: {
    sendScriptEvent: vi.fn((id: string, message: string) => {
      mockTransport.send(id, message)
    }),
    runTimeout: vi.fn(),
    clearRun: vi.fn(),
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
