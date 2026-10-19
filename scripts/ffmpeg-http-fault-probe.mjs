import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'

// Root supplies the freshly built canonical decoder-test executable. No app,
// credentials, commercial audio, persistent media cache or client profile.
const [executable, output, selectedCases] = process.argv.slice(2)
if (!executable)
  throw new Error(
    'Usage: node scripts/ffmpeg-http-fault-probe.mjs <decoder-tests.exe> [numeric-result.json] [comma-separated cases]'
  )
const rate = 48000
const channels = 2
const seconds = 40
const dataBytes = rate * channels * 2 * seconds
const wav = Buffer.alloc(44 + dataBytes)
wav.write('RIFF', 0)
wav.writeUInt32LE(36 + dataBytes, 4)
wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)
wav.writeUInt16LE(channels, 22)
wav.writeUInt32LE(rate, 24)
wav.writeUInt32LE(rate * channels * 2, 28)
wav.writeUInt16LE(channels * 2, 32)
wav.writeUInt16LE(16, 34)
wav.write('data', 36)
wav.writeUInt32LE(dataBytes, 40)
for (let frame = 0; frame < rate * seconds; frame++) {
  const value = Math.round(Math.sin((2 * Math.PI * 440 * frame) / rate) * 1000)
  for (let channel = 0; channel < channels; channel++)
    wav.writeInt16LE(value, 44 + (frame * channels + channel) * 2)
}
const cut = 44 + rate * channels * 2 * 8
let scenario = 'complete'
let requests = 0
let sentBytes = 0
const sockets = new Set()
const heldResponses = new Set()
const server = createServer((req, res) => {
  requests++
  if (scenario === 'headers-stall') return
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
  const start = match ? Number(match[1]) : 0
  const end = match?.[2] ? Math.min(Number(match[2]), wav.length - 1) : wav.length - 1
  if (scenario === 'read-reset' && start >= cut) {
    res.writeHead(403)
    res.end()
    return
  }
  if (start > end || start >= wav.length) {
    res.writeHead(416)
    res.end()
    return
  }
  res.writeHead(match ? 206 : 200, {
    'Content-Type': 'audio/wav',
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    ...(match ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {})
  })
  if (scenario === 'seek-stall' && start > 1024 * 1024) return
  if (scenario === 'complete' || scenario === 'seek-stall') {
    sentBytes += end - start + 1
    res.end(wav.subarray(start, end + 1))
    return
  }
  const stop = Math.max(start, Math.min(end + 1, cut))
  if (stop > start) {
    sentBytes += stop - start
    res.write(wav.subarray(start, stop))
  }
  if (scenario === 'read-reset') setTimeout(() => res.destroy(), 30)
  if (scenario === 'resume-read') heldResponses.add({ res, stop, end })
})
server.on('connection', (socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const url = `http://127.0.0.1:${server.address().port}/synthetic.wav`
async function run(name) {
  scenario = name === 'stop-open' ? 'headers-stall' : name === 'stop-read' ? 'body-stall' : name
  requests = 0
  sentBytes = 0
  const child = spawn(
    executable,
    [
      name === 'seek-stall'
        ? '--http-seek-probe'
        : name === 'stop-open'
          ? '--http-stop-open-probe'
          : name === 'resume-read'
            ? '--http-restart-read-probe'
            : name === 'stop-read'
              ? '--http-stop-read-probe'
              : '--http-read-probe',
      url,
      '0'
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let stdout = ''
  let stderrBytes = 0
  let killed = false
  child.stdout.on('data', (chunk) => {
    if (stdout.length < 65536) stdout += chunk.toString()
    if (name === 'resume-read' && stdout.includes('"resume-source"')) {
      for (const held of heldResponses) {
        sentBytes += held.end - held.stop + 1
        held.res.end(wav.subarray(held.stop, held.end + 1))
      }
      heldResponses.clear()
    }
  })
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length
  })
  const timer = setTimeout(
    () => {
      killed = true
      child.kill()
    },
    name.startsWith('stop-') ? 4000 : 18000
  )
  const [exitCode] = await once(child, 'close')
  clearTimeout(timer)
  let facts
  try {
    facts = JSON.parse(stdout.trim().split(/\r?\n/).at(-1))
  } catch {}
  for (const socket of sockets) socket.destroy()
  const passed =
    exitCode === 0 &&
    !killed &&
    facts &&
    (name === 'resume-read'
      ? facts.opened &&
        facts.cancelledBeforeRestart &&
        facts.restarted &&
        facts.framesBeforeRestart > 0 &&
        facts.framesAfterRestart > rate * 20 &&
        facts.frames <= rate * seconds &&
        facts.eof &&
        !facts.error
      : name === 'complete'
        ? facts.opened && facts.frames === rate * seconds && facts.eof && !facts.error
        : facts.error &&
          !facts.eof &&
          facts.totalMs < 17000 &&
          (!['body-stall', 'read-reset', 'seek-stall', 'stop-read'].includes(name) ||
            facts.opened) &&
          (name.startsWith('stop-')
            ? facts.cancelled && facts.totalMs < 2500
            : name === 'read-reset'
              ? !facts.cancelled
              : facts.timeout))
  return {
    name,
    passed: Boolean(passed),
    exitCode,
    killed,
    requests,
    sentBytes,
    stderrBytes,
    facts
  }
}
const results = []
const allCases = [
  'complete',
  'resume-read',
  'stop-open',
  'stop-read',
  'headers-stall',
  'body-stall',
  'read-reset',
  'seek-stall'
]
const cases = selectedCases ? selectedCases.split(',') : allCases
if (cases.some((name) => !allCases.includes(name))) throw new Error('Unknown fault case')
try {
  for (const name of cases) results.push(await run(name))
} finally {
  for (const socket of sockets) socket.destroy()
  server.close()
}
const receipt = {
  scope: 'Ephemeral loopback synthetic 40 s PCM WAV; no app/profile/account/audio export.',
  fixtureVersion: 2,
  limitation:
    'No external FFmpeg interrupt is enabled. stop cases call the existing cancellation API at 150 ms; other cases rely on production deadlines, with a separate parent process kill bound.',
  allPassed: results.every((result) => result.passed),
  results
}
if (output) fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify(receipt, null, 2))
if (!receipt.allPassed) process.exitCode = 1
