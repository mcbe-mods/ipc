/**
 * Wraps Minecraft's ScriptEvent system to provide a simple pub/sub transport layer.
 * All addons sharing the same namespace can exchange messages,
 * even if they are loaded from separate behavior packs.
 *
 * **Limit**: The underlying `/scriptevent` command accepts at most **2048 bytes** per message.
 * @see https://learn.microsoft.com/en-us/minecraft/creator/reference/content/commandsreference/examples/commands/scriptevent?view=minecraft-bedrock-stable#usage
 */
import { ScriptEventSource, system } from '@minecraft/server'
import { CHANNELS } from './constants'

export class Transport {
  readonly #id: string

  constructor(namespace: string) {
    this.#id = `${CHANNELS.PREFIX}:${namespace}`
  }

  /**
   * Broadcast a raw string payload to all addons listening on the same namespace and channel.
   * @param channel - The channel name to send on (appended to event ID for fast routing)
   * @param payload - The raw string to send (usually a serialized packet)
   */
  send(channel: string, payload: string): void {
    system.sendScriptEvent(`${this.#id}:${channel}`, payload)
  }

  /**
   * Subscribe to incoming messages from other addons.
   * @param handler - Called with each incoming message, pre-routed by channel
   * @returns A function that unsubscribes this handler
   */
  onReceive(handler: (channel: string, payload: string) => void): () => void {
    const prefix = `${this.#id}:`
    const callback = (event: { id: string, message: string, sourceType: ScriptEventSource }): void => {
      if (event.sourceType !== ScriptEventSource.Server) {
        return
      }
      if (!event.id.startsWith(prefix)) {
        return
      }
      const channel = event.id.slice(prefix.length)
      handler(channel, event.message)
    }

    system.afterEvents.scriptEventReceive.subscribe(callback)

    return () => {
      system.afterEvents.scriptEventReceive.unsubscribe(callback)
    }
  }
}
