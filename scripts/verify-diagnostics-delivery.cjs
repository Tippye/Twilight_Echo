const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const yauzl = require('yauzl')
const asar = require('@electron/asar')
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex')
async function zipFiles(file) {
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error)
      const files = new Map()
      zip.on('error', reject)
      zip.on('end', () => resolve(files))
      zip.readEntry()
      zip.on('entry', (entry) =>
        zip.openReadStream(entry, (error, stream) => {
          if (error) return reject(error)
          const chunks = []
          stream.on('error', reject)
          stream.on('data', (chunk) => chunks.push(chunk))
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks))
            zip.readEntry()
          })
        })
      )
    })
  )
}
async function main() {
  const resources = path.resolve(process.argv[2])
  const smoke = path.resolve(process.argv[3])
  const archive = path.join(resources, 'app.asar')
  const writer = asar.extractFile(archive, path.normalize('out/main/diagnosticWriter.js'))
  assert.ok(writer.includes(Buffer.from('parentPort')))
  const files = await zipFiles(path.join(smoke, 'diagnostics.zip'))
  const manifest = JSON.parse(files.get('manifest.json'))
  for (const file of manifest.files) {
    assert.equal(hash(files.get(file.name)), file.sha256)
    assert.equal(files.get(file.name).length, file.bytes)
  }
  assert.ok(files.has('markers.json'))
  assert.ok(files.has('timeline.jsonl'))
  const snapshots = JSON.parse(files.get('snapshots.json'))
  const identity = snapshots.find((entry) => entry.name === 'native.identity')
  assert.equal(identity.status, 'ok')
  const binaries = {}
  for (const name of ['twilight_audio_node.node', 'twilight-audio-engine.dll']) {
    binaries[name] = hash(await fs.readFile(path.join(resources, 'audio-engine', name)))
    assert.equal(
      identity.value[name],
      binaries[name],
      `${name} must be the loaded installed binary`
    )
  }
  assert.equal(snapshots.find((entry) => entry.name === 'native.capabilities').status, 'ok')
  assert.ok(manifest.coverage.events > 100)
  for (const [name, value] of files)
    assert.ok(!value.includes(Buffer.from('private-secret')), `secret in ${name}`)
  const timeline = files
    .get('timeline.jsonl')
    .toString()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.ok(timeline.some((entry) => entry.event === 'javascript.error'))
  assert.ok(timeline.some((entry) => entry.event === 'health.sample'))
  const installer = path.resolve('dist/TwilightEcho-1.3.1-setup.exe')
  const installerSha256 = hash(await fs.readFile(installer))
  const checksum = await fs.readFile(installer + '.sha256', 'utf8')
  assert.ok(checksum.startsWith(installerSha256))
  const result = {
    ok: true,
    verifiedAt: new Date().toISOString(),
    installer,
    installerSha256,
    writerSha256: hash(writer),
    binaries,
    manifestCoverage: manifest.coverage,
    snapshotFailures: manifest.snapshotFailures,
    smoke: JSON.parse(await fs.readFile(path.join(smoke, 'result.json'), 'utf8'))
  }
  await fs.writeFile(path.join(smoke, 'verified.json'), JSON.stringify(result, null, 2))
  console.log(
    JSON.stringify({ ok: true, installerSha256, events: manifest.coverage.events, binaries })
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
