// Build-time only. The player ships its decoder and never downloads an executable.
const { createHash } = require('node:crypto')
const { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { join, resolve, sep } = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const lock = require('../resources/automix-stems/zip-decoder.lock.json')
const execute = promisify(execFile)
const sha256 = (data) => createHash('sha256').update(data).digest('hex')

async function matches(path, expected) {
  try {
    return sha256(await readFile(path)) === expected
  } catch {
    return false
  }
}

async function download(url, file, expected) {
  if (await matches(file, expected)) return
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Cannot download pinned 7-Zip: HTTP ${response.status}`)
  const chunks = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.length
    if (bytes > 3 * 1024 ** 2) throw new Error('Pinned 7-Zip download exceeds size limit')
    chunks.push(chunk)
  }
  const data = Buffer.concat(chunks)
  if (sha256(data) !== expected)
    throw new Error('Pinned 7-Zip download failed SHA-256 verification')
  await writeFile(file, data)
}

async function prepareStemZipDecoder({
  root = resolve(__dirname, '..'),
  destination = join(root, 'resources', 'automix-stems')
} = {}) {
  const cache = join(root, 'node_modules', '.cache', 'automix-7zip', lock.version)
  await mkdir(cache, { recursive: true })
  const decoder = join(cache, '7za.exe')
  const license = join(cache, 'License.txt')
  if (!(await matches(decoder, lock.decoderSha256))) {
    const bootstrap = join(cache, '7zr.exe'),
      archive = join(cache, 'extra.7z')
    await Promise.all([
      download(lock.bootstrapUrl, bootstrap, lock.bootstrapSha256),
      download(lock.archiveUrl, archive, lock.archiveSha256)
    ])
    const temporary = await mkdtemp(join(cache, 'extract-'))
    if (!resolve(temporary).startsWith(resolve(cache) + sep))
      throw new Error('Invalid decoder staging path')
    try {
      await execute(
        bootstrap,
        ['e', '-y', '-bsp0', `-o${temporary}`, archive, 'x64/7za.exe', 'License.txt'],
        {
          windowsHide: true,
          timeout: 60_000
        }
      )
      if (!(await matches(join(temporary, '7za.exe'), lock.decoderSha256)))
        throw new Error('Pinned x64 ZIP decoder failed SHA-256 verification')
      await copyFile(join(temporary, 'License.txt'), license)
      await copyFile(join(temporary, '7za.exe'), decoder)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
  await mkdir(destination, { recursive: true })
  if (!(await matches(join(destination, '7za.exe'), lock.decoderSha256)))
    await copyFile(decoder, join(destination, '7za.exe'))
  await copyFile(license, join(destination, '7zip-LICENSE.txt'))
  await writeFile(
    join(destination, '7zip-NOTICE.txt'),
    [
      `7-Zip ${lock.version}, Copyright (C) Igor Pavlov.`,
      'The unmodified standalone x64 7za.exe decodes LZMA streams for AutoMix ZIP installation.',
      '7-Zip is free software under the GNU LGPL; see 7zip-LICENSE.txt.',
      `Corresponding source: ${lock.sourceUrl}`,
      `Binary distribution: ${lock.archiveUrl}`,
      `7za.exe SHA-256: ${lock.decoderSha256}`,
      ''
    ].join('\n')
  )
  return {
    version: lock.version,
    decoder: join(destination, '7za.exe'),
    sha256: lock.decoderSha256
  }
}

module.exports = { prepareStemZipDecoder }
if (require.main === module) {
  const preparation =
    process.platform === 'win32'
      ? prepareStemZipDecoder()
      : Promise.resolve({ skipped: true, reason: 'windows_only' })
  preparation
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
