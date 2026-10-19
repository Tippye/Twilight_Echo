const { spawn } = require('node:child_process')
const { openSync, closeSync, mkdirSync } = require('node:fs')
const path = require('node:path')
const output = path.resolve(
  process.argv[3] || 'node_modules/.cache/diagnostics-package-smoke-verified'
)
mkdirSync(output, { recursive: true })
const fd = openSync(path.join(output, 'electron.log'), 'w')
const child = spawn(
  require('electron'),
  [path.resolve('scripts/diagnostics-package-smoke.cjs'), path.resolve(process.argv[2]), output],
  { windowsHide: true, stdio: ['ignore', fd, fd] }
)
child.on('error', (error) => {
  closeSync(fd)
  console.error(error)
  process.exitCode = 1
})
child.on('exit', (code) => {
  closeSync(fd)
  console.log(`Diagnostic package smoke exit: ${code}`)
  process.exitCode = code || 0
})
