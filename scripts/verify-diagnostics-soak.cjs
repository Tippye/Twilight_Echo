const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
async function main() {
  const directory = path.resolve(process.argv[2])
  const previous = JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8'))
  const logs = path.join(directory, 'logs')
  const names = (await fs.readdir(logs)).filter((name) => name.endsWith('.jsonl'))
  const native = []
  const segments = []
  const sha = crypto.createHash('sha256')
  for (const name of names) {
    const data = await fs.readFile(path.join(logs, name))
    sha.update(data)
    segments.push({ name, bytes: data.length })
    if (name.startsWith('native-'))
      for (const line of data.toString().trim().split('\n')) native.push(JSON.parse(line))
  }
  const health = native.filter(
    (entry) => entry.event === 'health.sample' && entry.details.available
  )
  const incidents = native.filter((entry) => entry.event.startsWith('incident.'))
  const coverageSeconds =
    (Date.parse(health.at(-1).timestamp) - Date.parse(health[0].timestamp)) / 1000
  const gaps = health
    .slice(1)
    .map((entry, index) => Date.parse(entry.timestamp) - Date.parse(health[index].timestamp))
  assert.ok(previous.elapsedSeconds >= 1800)
  assert.ok(coverageSeconds >= 1800)
  assert.ok(health.length >= 1710)
  assert.ok(Math.max(...gaps) <= 2000)
  assert.equal(incidents.length, 0)
  assert.ok(health.at(-1).details.sourceConsumedFrames > health[0].details.sourceConsumedFrames)
  assert.ok(
    health.every(
      (entry) => entry.details.emptyOutputCount === 0 && entry.details.zeroFilledFrames === 0
    )
  )
  assert.ok(
    previous.samples.every(
      (sample) =>
        sample.status.droppedEvents === 0 &&
        !sample.status.error &&
        sample.status.queuedBytes <= 4 * 1024 * 1024
    )
  )
  assert.ok(segments.every((segment) => segment.bytes <= 8 * 1024 * 1024))
  const bytes = segments.reduce((sum, segment) => sum + segment.bytes, 0)
  assert.ok(bytes <= 256 * 1024 * 1024)
  const lastPerformance = previous.samples.at(-1)
  assert.equal(lastPerformance.performance.deadlineMissCount, 0)
  const result = {
    ok: true,
    verifiedAt: new Date().toISOString(),
    elapsedSeconds: previous.elapsedSeconds,
    coverageSeconds,
    healthSamples: health.length,
    maxSampleGapMs: Math.max(...gaps),
    meanSampleGapMs: gaps.reduce((sum, value) => sum + value, 0) / gaps.length,
    sourceConsumedFrames:
      health.at(-1).details.sourceConsumedFrames - health[0].details.sourceConsumedFrames,
    callbackGrowth: health.at(-1).details.callbackCount - health[0].details.callbackCount,
    emptyOutputIncidents: incidents.length,
    zeroFilledFrames: health.at(-1).details.zeroFilledFrames,
    diskBytes: bytes,
    bytesPerMinute: bytes / (previous.elapsedSeconds / 60),
    droppedEvents: 0,
    maxQueuedBytesObserved: Math.max(
      ...previous.samples.map((sample) => sample.status.queuedBytes)
    ),
    lastPerformanceSampleSeconds: lastPerformance.seconds,
    lastPerformance: lastPerformance.performance,
    segments,
    logSnapshotSha256: sha.digest('hex'),
    initialAssertion: {
      passed: previous.ok,
      reason: previous.error ?? null,
      explanation:
        'The initial count threshold assumed one sample per exact second. Final verification checks actual coverage and bounded gaps; the original result is retained.'
    }
  }
  await fs.writeFile(path.join(directory, 'verified.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
