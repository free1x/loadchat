import fs from 'node:fs'

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
fs.writeFileSync(new URL('../dist/.loadchat-version', import.meta.url), `${packageJson.version}\n`, 'utf8')
