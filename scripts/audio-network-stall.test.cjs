const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const http = require('node:http')
const { resolve } = require('node:path')
const test = require('node:test')

const executable = resolve(
  process.env.TAE_NATIVE_TEST_DIR ||
    process.env.TAE_MINGW_BUILD_DIR ||
    'audio-engine/build/default',
  `twilight_ffmpeg_decoder_tests${process.platform === 'win32' ? '.exe' : ''}`
)

// A valid long WAV with only its initial PCM delivered. The TCP connection
// stays open, reproducing a CDN that stops sending without reporting EOF.
function stalledWavPrefix() {
  const dataBytes = 48000 * 2 * 2 * 300
  const bytes = Buffer.alloc(44 + 512 * 1024)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(dataBytes + 36, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(2, 22)
  bytes.writeUInt32LE(48000, 24)
  bytes.writeUInt32LE(48000 * 4, 28)
  bytes.writeUInt16LE(4, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(dataBytes, 40)
  return { bytes, length: dataBytes + 44 }
}

for (const mode of ['open', 'read']) {
  test(
    `real FFmpeg bounds a remote ${mode} that never completes`,
    {
      skip: !existsSync(executable),
      timeout: 38000
    },
    async () => {
      const sockets = new Set()
      const server = http.createServer((_request, response) => {
        if (mode === 'read') {
          const { bytes, length } = stalledWavPrefix()
          response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': length })
          response.write(bytes)
        }
      })
      server.on('connection', (socket) => {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', () => {})
      })
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const child = spawn(
        executable,
        [`--network-${mode}-timeout-probe`, `http://127.0.0.1:${server.address().port}/stall.wav`],
        { windowsHide: true }
      )
      let output = ''
      child.stdout.on('data', (chunk) => {
        output = (output + chunk).slice(-8192)
      })
      child.stderr.on('data', (chunk) => {
        output = (output + chunk).slice(-8192)
      })
      const deadline = setTimeout(() => child.kill(), 35000)
      try {
        const code = await new Promise((resolve, reject) => {
          child.on('error', reject)
          child.on('exit', resolve)
        })
        assert.equal(code, 0, output)
      } finally {
        clearTimeout(deadline)
        child.kill()
        for (const socket of sockets) socket.destroy()
        await new Promise((resolve) => server.close(resolve))
      }
    }
  )
}
