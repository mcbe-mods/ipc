/**
 * Wraps Minecraft's ScriptEvent system to provide a simple pub/sub transport layer.
 * All addons sharing the same namespace can exchange messages,
 * even if they are loaded from separate behavior packs.
 */
import { ScriptEventSource, system } from '@minecraft/server'

const IPC_NAMESPACE = 'ipc'

export class Transport {
  readonly #id: string

  constructor(namespace: string) {
    this.#id = `${IPC_NAMESPACE}:${namespace}`
  }

  /**
   * Broadcast a raw string payload to all addons listening on the same namespace.
   * @param payload - The raw string to send (usually a serialized packet)
   */
  send(payload: string): void {
    system.sendScriptEvent(this.#id, payload)
  }

  /**
   * Subscribe to incoming messages from other addons.
   * @param handler - Called with each incoming message
   * @returns A function that unsubscribes this handler
   */
  onReceive(handler: (payload: string) => void): () => void {
    const callback = (event: { id: string, message: string, sourceType: ScriptEventSource }): void => {
      if (event.sourceType !== ScriptEventSource.Server) {
        return
      }
      if (event.id !== this.#id) {
        return
      }
      handler(event.message)
    }

    system.afterEvents.scriptEventReceive.subscribe(callback)

    return () => {
      system.afterEvents.scriptEventReceive.unsubscribe(callback)
    }
  }
}
