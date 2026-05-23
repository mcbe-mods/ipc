/** Channels used for internal message routing */
export const CHANNELS = {
  /** Base prefix for all ScriptEvent IDs: `ipc:<namespace>:<channel>` */
  PREFIX: 'ipc',
  /** Internal response routing channel for invoke/handle */
  RESPONSE: '@response',
} as const

/** Event emitter prefix for matching invoke requests to their responses */
export const RESPONSE_EVENT_PREFIX = 'invoke-response:'

/** Current IPC protocol version */
export const PROTOCOL_VERSION = 1 as const
