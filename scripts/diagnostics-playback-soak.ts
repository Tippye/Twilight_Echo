import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import { openSync, writeSync, closeSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { DiagnosticWriterClient } from '../src/main/diagnostics/client.ts'
import { configureDiagnosticLogger, writeDiagnostic } from '../src/main/diagnostics/logger.ts'

const directory = resolve(process.argv[2] ?? 'node_modules/.cache/diagnostics-soak')
const seconds = Number(process.argv[3] ?? 1800)
const addon = resolve(
  process.argv[4] ?? 'node_modules/.cache/issue132/native/twilight_audio_node.node'
)
await mkdir(directory, { recursive: true })
const logs = join(directory, 'logs')
process.env.TAE_DIAGNOSTICS_DIR = logs
process.env.TWILIGHT_LOG_SESSION_ID ??= `soak-${Date.now()}`
process.env.TAE_SERVICE_GENERATION = '1'
process.env.PATH = `${resolve(addon, '..')};${process.env.PATH}`
const writer = new DiagnosticWriterClient(
  logs,
  new URL('../src/main/diagnostics/writerWorker.ts', import.meta.url)
)
configureDiagnosticLogger({ sessionId: process.env.TWILIGHT_LOG_SESSION_ID }, (event) =>
  writer.record(event)
)
const source = join(directory, 'soak.wav')
// A real PCM decode/render path, muted in shared mode so an existing player can keep running.
const bytes = (seconds + 10) * 48000 * 4
const header = Buffer.alloc(44)
header.write('RIFF')
header.writeUInt32LE(bytes + 36, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(2, 22)
header.writeUInt32LE(48000, 24)
header.writeUInt32LE(192000, 28)
header.writeUInt16LE(4, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(bytes, 40)
const fd = openSync(source, 'w')
try {
  writeSync(fd, header)
  const block = Buffer.alloc(1024 * 1024)
  for (let left = bytes; left > 0; left -= block.length)
    writeSync(fd, block, 0, Math.min(left, block.length))
} finally {
  closeSync(fd)
}
const audio = createRequire(import.meta.url)(addon)
const samples: any[] = []
const started = Date.now()
try {
  audio.SetVolume(0)
  audio.SetOutputBackend('wasapi')
  audio.Play(source, 0)
  writeDiagnostic('soak', 'playback.start', { seconds })
  const first = JSON.parse(audio.GetPlaybackInfo())
  for (let tick = 0; tick < seconds; tick++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    // Exercise normal poll/queue traffic alongside the independent native sampler.
    const playback = JSON.parse(audio.GetPlaybackInfo())
    writeDiagnostic(
      'soak',
      'playback.sample',
      {
        state: playback.state,
        position: playback.position,
        diagnostics: playback.outputInfo?.diagnostics
      },
      'debug'
    )
    for (let event = 0; event < 20; event++)
      writeDiagnostic('soak', 'traffic.sample', { tick, event }, 'debug')
    if (tick % 60 === 0) {
      const status = await writer.status()
      samples.push({
        seconds: tick + 1,
        status,
        performance: playback.outputInfo?.renderPerformance,
        memory: process.memoryUsage()
      })
      await writeFile(
        join(directory, 'progress.json'),
        JSON.stringify({ elapsedSeconds: tick + 1, samples }, null, 2)
      )
    }
    if (playback.state !== 'playing') throw new Error(`Playback stopped: ${playback.state}`)
  }
  const last = JSON.parse(audio.GetPlaybackInfo())
  audio.Stop()
  await writer.flush()
  const native: any[] = []
  for (const name of await readdir(logs))
    if (name.startsWith('native-')) {
      for (const line of (await readFile(join(logs, name), 'utf8')).split('\n').filter(Boolean))
        native.push(JSON.parse(line))
    }
  const health = native.filter(
    (entry) => entry.event === 'health.sample' && entry.details.available
  )
  const incidents = native.filter((entry) => entry.event.startsWith('incident'))
  const coverageSeconds =
    (Date.parse(health.at(-1)?.timestamp) - Date.parse(health[0]?.timestamp)) / 1000
  const maxSampleGapMs = health
    .slice(1)
    .reduce(
      (gap, entry, index) =>
        Math.max(gap, Date.parse(entry.timestamp) - Date.parse(health[index].timestamp)),
      0
    )
  if (
    health.length < seconds * 0.95 ||
    coverageSeconds < seconds - 3 ||
    maxSampleGapMs > 2000 ||
    incidents.length ||
    health.at(-1).details.sourceConsumedFrames <= health[0].details.sourceConsumedFrames
  )
    throw new Error('Native health evidence failed')
  const totalBytes = (
    await Promise.all(
      (await readdir(logs)).map(async (name) => (await stat(join(logs, name))).size)
    )
  ).reduce((a, b) => a + b, 0)
  const result = {
    ok: true,
    elapsedSeconds: (Date.now() - started) / 1000,
    binarySha256: createHash('sha256')
      .update(await readFile(resolve(addon, '..', 'twilight-audio-engine.dll')))
      .digest('hex'),
    first,
    last,
    healthSamples: health.length,
    coverageSeconds,
    maxSampleGapMs,
    incidents: incidents.length,
    diskBytes: totalBytes,
    bytesPerMinute: totalBytes / (seconds / 60),
    samples
  }
  await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ok: true, seconds, totalBytes, healthSamples: health.length }))
} catch (error) {
  await writeFile(
    join(directory, 'result.json'),
    JSON.stringify(
      { ok: false, error: String(error), elapsedSeconds: (Date.now() - started) / 1000, samples },
      null,
      2
    )
  )
  throw error
} finally {
  try {
    audio.Stop()
  } catch {
    /* The independent test engine may already be stopped. */
  }
  await writer.close()
}
process.exit(0)
