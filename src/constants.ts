/** ScriptEvent ID prefix: `ipc:<namespace>` */
export const IPC_NAMESPACE = 'ipc'

/** Internal endpoint used for invoke response routing */
export const RESPONSE_ENDPOINT = '@response'

/** Event emitter prefix for matching invoke requests to their responses */
export const RESPONSE_EVENT_PREFIX = 'invoke-response:'

/** Current IPC protocol version */
export const PROTOCOL_VERSION = 1 as const
