import os from 'node:os'

export function lanAddresses(port: number, protocol = 'http') {
  const result: string[] = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) result.push(`${protocol}://${entry.address}:${port}`)
    }
  }
  return result
}

export function localIpv4s() {
  return lanAddresses(0).map((url) => new URL(url).hostname)
}
