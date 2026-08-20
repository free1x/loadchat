import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const blockedPaths = [
  /(^|\/)data(\/|$)/i,
  /(^|\/)release(\/|$)/i,
  /(^|\/)\.tmp(\/|$)/i,
  /(^|\/)\.env(?:\.|$)/i,
  /\.(?:sqlite|sqlite-wal|sqlite-shm|db|pem|key|p12|pfx)$/i
]
const allowedBlockedNames = new Set(['.env.example'])
const secretPatterns = [
  { name: 'private key', pattern: new RegExp('BEGIN ' + '(?:RSA |EC |OPENSSH )?PRIVATE KEY') },
  { name: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { name: 'AWS access key', pattern: /\bAKIA[A-Z0-9]{16}\b/ },
  { name: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  { name: 'hard-coded credential', pattern: /\b(?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*['"][^'"\r\n]{16,}['"]/i }
]
const binaryExtensions = /\.(?:png|jpe?g|gif|webp|ico|woff2?|zip|gz|pdf)$/i

let files = []
let usingGitIndex = false
try {
  files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
  usingGitIndex = files.length > 0
} catch { /* fall back to the working tree below */ }
if (!files.length) {
  const excluded = new Set(['.git', '.tmp', 'data', 'dist', 'dist-server', 'node_modules', 'release'])
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && excluded.has(entry.name)) continue
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else files.push(relative('.', absolute).replaceAll('\\', '/'))
    }
  }
  walk('.')
}

const findings = []
for (const file of files) {
  const normalized = file.replaceAll('\\', '/')
  if (!allowedBlockedNames.has(normalized) && blockedPaths.some((pattern) => pattern.test(normalized))) {
    findings.push(`${normalized}: private runtime/secret path must not be tracked`)
    continue
  }
  if (!existsSync(file) || binaryExtensions.test(file) || statSync(file).size > 5 * 1024 * 1024) continue
  const content = readFileSync(file, 'utf8')
  for (const { name, pattern } of secretPatterns) {
    const match = content.match(pattern)
    if (!match) continue
    const line = content.slice(0, match.index).split(/\r?\n/).length
    if (content.split(/\r?\n/)[line - 1]?.includes('publication-allow')) continue
    findings.push(`${normalized}:${line}: possible ${name}`)
  }
}

if (findings.length) {
  console.error('Publication safety check failed (secret values are intentionally not printed):')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log(`Publication safety check passed for ${files.length} ${usingGitIndex ? 'tracked' : 'source'} files.`)
