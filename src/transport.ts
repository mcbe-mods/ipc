import { ScriptEventSource, system } from '@minecraft/server'

const IPC_NAMESPACE = 'ipc'

export class Transport {
  readonly #id: string

  constructor(namespace: string) {
    this.#id = `${IPC_NAMESPACE}:${namespace}`
  }

  send(payload: string): void {
    system.sendScriptEvent(this.#id, payload)
  }

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
