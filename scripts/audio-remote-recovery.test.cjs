// Real FFmpeg + WASAPI regression. Run on Windows with TAE_AUDIO_NODE pointing
// to an isolated native staging directory; the existing player is unaffected.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const preloadSeconds = Math.max(12, Number(process.env.TAE_RECOVERY_PRELOAD_SECONDS) || 12)

function wav(seconds) {
  const count = seconds * 48000 * 4
  const bytes = Buffer.alloc(44 + count)
  bytes.write('RIFF')
  bytes.writeUInt32LE(count + 36, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(2, 22)
  bytes.writeUInt32LE(48000, 24)
  bytes.writeUInt32LE(192000, 28)
  bytes.writeUInt16LE(4, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(count, 40)
  return bytes
}

if (process.argv[2] === 'client') {
  const [url, mode, directory] = process.argv.slice(3)
  const addon = path.resolve(process.env.TAE_AUDIO_NODE)
  process.env.PATH = `${path.dirname(addon)};${process.env.PATH}`
  const audio = require(addon)
  const first = path.join(directory, 'first.wav')
  const third = path.join(directory, 'third.wav')
  fs.writeFileSync(first, wav(preloadSeconds))
  fs.writeFileSync(third, wav(30))
  const samples = []
  const actions = []
  const started = Date.now()
  let paused = false
  let resumed = false
  let pauseAt = 0
  function finish() {
    clearInterval(timer)
    audio.Stop()
    fs.writeFileSync(
      path.join(directory, 'samples.json'),
      JSON.stringify({ samples, actions }, null, 2)
    )
    process.send?.({ kind: 'complete', samples, actions })
    setTimeout(() => process.exit(0), 500)
  }
  audio.SetVolume(0)
  audio.SetOutputBackend('wasapi')
  audio.LoadQueue(
    JSON.stringify([
      ...(mode === 'preload-idle'
        ? [{ id: 'first', source: first, duration: preloadSeconds }]
        : []),
      { id: 'remote', source: url, duration: 180 },
      { id: 'third', source: third, duration: 30 }
    ]),
    0
  )
  audio.Play(mode === 'preload-idle' ? first : url, 0)
  const timer = setInterval(() => {
    const info = JSON.parse(audio.GetPlaybackInfo())
    const diag = info.diagnostics || info.outputInfo?.diagnostics || {}
    const source = info.source === first ? 'first' : info.source === third ? 'third' : 'remote'
    const sample = {
      ms: Date.now() - started,
      state: info.state,
      source,
      position: info.position,
      queueIndex: info.queueIndex,
      lastError: diag.lastError,
      ...Object.fromEntries(
        Object.entries(diag).filter(([key]) =>
          /^(decode|liveRender|sourceConsumed|zeroFilled)/.test(key)
        )
      )
    }
    samples.push(sample)
    if (mode === 'pause-idle' && !paused && info.position >= 1) {
      audio.Pause()
      paused = true
      pauseAt = Date.now()
      actions.push({ event: 'pause', ms: Date.now() - started })
    }
    if (paused && !resumed && Date.now() - pauseAt >= 8000) {
      audio.Pause() // The public native API toggles pause/resume.
      resumed = true
      actions.push({ event: 'resume', ms: Date.now() - started })
    }
    if (samples.length % 20 === 0) process.send?.({ kind: 'progress', sample })
    if (
      source === 'third' ||
      (source === 'remote' && info.state === 'stopped') ||
      (source === 'remote' && info.position >= 14) ||
      Date.now() - started > (mode === 'preload-idle' ? preloadSeconds * 1000 + 45000 : 55000)
    )
      finish()
  }, 250)
} else {
  const test = require('node:test')
  for (const mode of ['preload-idle', 'pause-idle', 'read-timeout', 'persistent-failure']) {
    test(
      `remote recovery: ${mode}`,
      {
        timeout: mode === 'preload-idle' ? preloadSeconds * 1000 + 60000 : 70000,
        skip: process.platform !== 'win32' || !process.env.TAE_AUDIO_NODE
      },
      async () => {
        const evidenceRoot = path.resolve(
          process.env.TAE_REMOTE_RECOVERY_EVIDENCE || 'node_modules/.cache/issue132-recovery/http'
        )
        fs.mkdirSync(evidenceRoot, { recursive: true })
        // Native journals append across restarts; each run needs its own evidence.
        const directory = fs.mkdtempSync(path.join(evidenceRoot, `${mode}-`))
        const bytes = wav(180)
        const traffic = []
        const sockets = new Set()
        let request = 0
        const server = http.createServer((req, res) => {
          const id = ++request
          const offset = Number(/^bytes=(\d+)-/.exec(req.headers.range || '')?.[1] || 0)
          traffic.push({ event: 'request', id, offset, at: Date.now() })
          // WAV probing opens at byte zero, then seeks past its 44-byte header.
          // Both requests belong to the initial connection episode.
          if (mode === 'persistent-failure' && id > 2) {
            res.writeHead(503)
            res.end()
            return
          }
          res.writeHead(offset ? 206 : 200, {
            'Content-Type': 'audio/wav',
            'Content-Length': bytes.length - offset,
            'Accept-Ranges': 'bytes',
            ...(offset
              ? { 'Content-Range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` }
              : {})
          })
          let cursor = offset
          let expired = false
          let idleTimer
          function pump() {
            clearTimeout(idleTimer)
            if (expired || res.destroyed) return
            while (cursor < bytes.length) {
              if (
                id <= 2 &&
                /^(read-timeout|persistent-failure)$/.test(mode) &&
                cursor >= 2 * 1024 * 1024
              ) {
                expired = true
                traffic.push({ event: 'simulated-read-stall', id, cursor, at: Date.now() })
                return // TCP remains open; this is not a normal EOF.
              }
              const end = Math.min(bytes.length, cursor + 64 * 1024)
              const accepted = res.write(bytes.subarray(cursor, end))
              cursor = end
              if (!accepted) {
                if (id <= 2 && /idle$/.test(mode))
                  idleTimer = setTimeout(() => {
                    expired = true
                    traffic.push({ event: 'simulated-idle-expiry', id, cursor, at: Date.now() })
                  }, 3000)
                res.once('drain', pump)
                return
              }
            }
            res.end()
          }
          res.on('close', () => {
            clearTimeout(idleTimer)
            traffic.push({ event: 'close', id, cursor, at: Date.now() })
          })
          pump()
        })
        server.on('connection', (socket) => {
          sockets.add(socket)
          socket.on('close', () => sockets.delete(socket))
          socket.on('error', () => {})
        })
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
        const child = spawn(
          process.execPath,
          [
            __filename,
            'client',
            `http://127.0.0.1:${server.address().port}/remote.wav`,
            mode,
            directory
          ],
          {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            env: {
              ...process.env,
              TAE_DIAGNOSTICS_DIR: path.join(directory, 'logs'),
              TWILIGHT_LOG_SESSION_ID: `remote-recovery-${mode}`,
              TAE_SERVICE_GENERATION: '0'
            }
          }
        )
        let samples
        let actions
        let output = ''
        child.stdout.on('data', (chunk) => {
          output = (output + chunk).slice(-8192)
        })
        child.stderr.on('data', (chunk) => {
          output = (output + chunk).slice(-8192)
        })
        child.on('message', (message) => {
          if (message.kind === 'complete') ({ samples, actions } = message)
          if (message.kind === 'progress') console.log(mode, JSON.stringify(message.sample))
        })
        const deadline = setTimeout(
          () => child.kill(),
          mode === 'preload-idle' ? preloadSeconds * 1000 + 50000 : 60000
        )
        try {
          const code = await new Promise((resolve, reject) => {
            child.on('error', reject)
            child.on('exit', resolve)
          })
          assert.equal(code, 0, output)
          assert.ok(samples?.length)
          const native = fs
            .readdirSync(path.join(directory, 'logs'))
            .filter((name) => name.endsWith('.jsonl'))
            .flatMap((name) =>
              fs
                .readFileSync(path.join(directory, 'logs', name), 'utf8')
                .trim()
                .split('\n')
                .flatMap((line) => {
                  try {
                    return [JSON.parse(line)]
                  } catch {
                    return []
                  }
                })
            )
          const events = native.filter((entry) =>
            /^(decode[._]|ffmpeg[.]|stream.promoted|incident[.])/.test(entry.event)
          )
          const remote = samples.filter((sample) => sample.source === 'remote')
          const result = {
            mode,
            directory,
            nativeAddon: process.env.TAE_AUDIO_NODE,
            traffic,
            samples,
            actions,
            events
          }
          fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2))
          assert.ok(
            !samples.some((sample) => sample.source === 'third'),
            'a read failure must not promote the next song'
          )
          assert.ok(
            traffic.some((entry) => /^simulated-/.test(entry.event)),
            'the injected network fault must occur'
          )
          assert.ok(
            events.some((entry) => entry.event === 'decode.reconnect.start'),
            'the real engine must attempt recovery'
          )
          if (mode === 'persistent-failure') {
            assert.equal(remote.at(-1).state, 'stopped')
            assert.ok(remote.at(-1).lastError)
            assert.equal(remote.at(-1).queueIndex, 0)
            assert.equal(
              events.filter((entry) => entry.event === 'decode.reconnect.start').length,
              2
            )
            assert.ok(events.some((entry) => entry.event === 'decode.failed'))
          } else {
            assert.ok(remote.at(-1).position >= 14, 'the same song must continue after reconnect')
            assert.ok(!remote.some((sample) => sample.lastError))
            assert.ok(events.some((entry) => entry.event === 'decode.reconnect.complete'))
            if (/idle$/.test(mode))
              assert.ok(events.some((entry) => entry.event === 'decode.connection-idle'))
          }
        } finally {
          clearTimeout(deadline)
          if (child.exitCode === null) child.kill()
          for (const socket of sockets) socket.destroy()
          await new Promise((resolve) => server.close(resolve))
        }
      }
    )
  }
}
