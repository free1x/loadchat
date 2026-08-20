import os from 'node:os'
import { Bonjour, type Service } from 'bonjour-service'

let bonjour: Bonjour | null = null
let service: Service | null = null

export function startMdns(serverName: string, port: number, enabled: boolean) {
  if (!enabled) return
  try {
    bonjour = new Bonjour()
    service = bonjour.publish({
      name: `${serverName} · LoadChat`, type: 'http', protocol: 'tcp', port,
      host: 'loadchat.local', txt: { path: '/', app: 'loadchat', hostname: os.hostname() }
    })
  } catch { stopMdns() }
}

export function stopMdns() {
  try { service?.stop() } catch { /* already stopped */ }
  try { bonjour?.destroy() } catch { /* already stopped */ }
  service = null; bonjour = null
}
