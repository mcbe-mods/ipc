/** Public — system events emitted by {@link IPC.events}. */
export const EVENTS = {
  ERROR: 'error',
  INVALID_PACKET: 'invalid-packet',
} as const

export interface IPCEvents {
  [EVENTS.ERROR]: Error
  [EVENTS.INVALID_PACKET]: { payload: string }
}

/** Internal — EventEmitter routing keys (not exported from package) */
export const SYSTEM_EVENTS = {
  INVOKE_RESPONSE: 'invoke-response',
} as const
