/**
 * Wraps Minecraft's ScriptEvent system to provide a simple pub/sub transport layer.
 * All addons sharing the same namespace can exchange messages,
 * even if they are loaded from separate behavior packs.
 *
 * **Limit**: The underlying `/scriptevent` command accepts at most **2048 bytes** per message.
 * @see https://learn.microsoft.com/en-us/minecraft/creator/reference/content/commandsreference/examples/commands/scriptevent?view=minecraft-bedrock-stable#usage
 *
 * **Event ID format**: `ipc:<systemDomain>:<namespace>:<route>`
 * - systemDomain: system domain for routing (user, response, etc.)
 * - namespace: user-configured namespace, validated against injection
 * - route: channel name (user domain) or invoke id (response domain)
 */
import { ScriptEventSource, system } from '@minecraft/server'
import { SYSTEM_DOMAINS } from './constants'

export class Transport {
  readonly #namespace: string

  constructor(namespace: string) {
    this.#namespace = namespace
  }

  /**
   * Broadcast a raw string payload to all addons listening on the same namespace and system domain.
   * @param systemDomain - The system domain (user, response, etc.)
   * @param route - The route within the domain (channel name or invoke id)
   * @param payload - The raw string to send
   */
  send(systemDomain: string, route: string, payload: string): void {
    system.sendScriptEvent(`${SYSTEM_DOMAINS.PREFIX}:${systemDomain}:${this.#namespace}:${route}`, payload)
  }

  /**
   * Subscribe to incoming messages from other addons.
   * @param handler - Called with (systemDomain, route, payload) for each matching message
   * @returns A function that unsubscribes this handler
   */
  onReceive(handler: (systemDomain: string, route: string, payload: string) => void): () => void {
    const basePrefix = `${SYSTEM_DOMAINS.PREFIX}:`
    const nsPrefix = `${this.#namespace}:`

    const callback = (event: { id: string, message: string, sourceType: ScriptEventSource }): void => {
      if (event.sourceType !== ScriptEventSource.Server) {
        return
      }
      if (!event.id.startsWith(basePrefix)) {
        return
      }
      const suffix = event.id.slice(basePrefix.length)
      const firstColon = suffix.indexOf(':')
      if (firstColon < 0) {
        return
      }
      const systemDomain = suffix.slice(0, firstColon)
      const nsAndRoute = suffix.slice(firstColon + 1)

      if (!nsAndRoute.startsWith(nsPrefix)) {
        return
      }
      const route = nsAndRoute.slice(nsPrefix.length)
      handler(systemDomain, route, event.message)
    }

    system.afterEvents.scriptEventReceive.subscribe(callback)

    return () => {
      system.afterEvents.scriptEventReceive.unsubscribe(callback)
    }
  }
}
