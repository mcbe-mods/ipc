/** System domains used for message routing in ScriptEvent IDs: `ipc:<systemDomain>:<namespace>:<route>` */
export const SYSTEM_DOMAINS = {
  /** Fixed prefix for all IPC ScriptEvent IDs */
  PREFIX: 'ipc',
  /** User-facing domain — send/on/invoke/handle messages */
  USER: 'user',
  /** Internal domain — invoke response routing */
  RESPONSE: 'response',
} as const

export const EVENTS = {
  INVOKE_RESPONSE: 'invoke-response',
} as const

/** Current IPC protocol version */
export const PROTOCOL_VERSION = 1 as const
