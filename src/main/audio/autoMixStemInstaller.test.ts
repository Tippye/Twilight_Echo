import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { deflateRawSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import {
  AutoMixStemInstaller,
  managedStemPackDirectories,
  validateStemArchivePath
} from './autoMixStemInstaller.ts'
import { STEM_MODEL_VERSION } from './autoMixStemService.ts'

const require = createRequire(import.meta.url)
const crc32 = require('buffer-crc32')
const MODEL = 'models/955717e8-8726e21a.th'
const model = Buffer.from('small model fixture')
const checkpoint = createHash('sha256').update(model).digest('hex')
type File = {
  name: string
  data: Buffer
  mode?: number
  size?: number
  corruptCrc?: boolean
  method?: number
  compressed?: Buffer
}
function pack(prefix = 'automix-enhancement/'): File[] {
  const metadata = Buffer.from(
    JSON.stringify({ modelVersion: STEM_MODEL_VERSION, checkpointSha256: checkpoint })
  )
  return [
    { name: prefix + 'manifest.json', data: metadata },
    { name: prefix + 'model.lock.json', data: metadata },
    { name: prefix + MODEL, data: model },
    { name: prefix + 'runtime/python.exe', data: Buffer.from('runtime fixture') }
  ]
}
// Stored ZIP fixtures give the preflight real central-directory attributes,
// including malicious names and sizes that archive libraries refuse to emit.
async function archive(path: string, files: File[]): Promise<void> {
  const local: Buffer[] = [],
    central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const payload = file.compressed ?? file.data
    const crc = file.corruptCrc ? 0 : crc32.unsigned(file.data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800 | (file.method === 14 ? 2 : 0), 6)
    header.writeUInt16LE(file.method ?? 0, 8)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(payload.length, 18)
    header.writeUInt32LE(file.size ?? file.data.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, payload)
    const index = Buffer.alloc(46)
    index.writeUInt32LE(0x02014b50)
    index.writeUInt16LE(0x0314, 4)
    index.writeUInt16LE(20, 6)
    index.writeUInt16LE(0x800 | (file.method === 14 ? 2 : 0), 8)
    index.writeUInt16LE(file.method ?? 0, 10)
    index.writeUInt32LE(crc, 16)
    index.writeUInt32LE(payload.length, 20)
    index.writeUInt32LE(file.size ?? file.data.length, 24)
    index.writeUInt16LE(name.length, 28)
    index.writeUInt32LE(((file.mode ?? 0x81a4) << 16) >>> 0, 38)
    index.writeUInt32LE(offset, 42)
    central.push(index, name)
    offset += header.length + name.length + payload.length
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  await writeFile(path, Buffer.concat([...local, directory, end]))
}

// Independently encoded by Python's standard ZIP_LZMA writer (24,000 bytes).
const lzmaData = Buffer.from('Audio inference fixture\n'.repeat(1000))
const lzmaPayload = Buffer.from(
  'CQQFAF0AAIAAACCdSIa5aXTNhCAXFKneWLVRa/Z+k2MvvCV5VrhQhlILYAz6OhLUoeVHaEjZJqf6L7S6t3Pe2+x6FUK57LeEkgz0Hv9ZRHy+rasEFJ09drtwMat+uT5r///sU+AA',
  'base64'
)
const workerDirectory = resolve('resources/automix-stems')
const nativeLzma = { skip: process.platform !== 'win32' }

test(
  'mixed Store/Deflate/LZMA ZIPs preserve every decoded byte and Unicode paths',
  nativeLzma,
  async () => {
    assert.ok(
      existsSync(join(workerDirectory, '7za.exe')),
      'Run node scripts/prepare-automix-stem-zip-decoder.cjs'
    )
    await fixture(
      async ({ zip, installer, root }) => {
        await archive(zip, [
          ...pack(),
          {
            name: 'automix-enhancement/runtime/deflated.bin',
            data: lzmaData,
            method: 8,
            compressed: deflateRawSync(lzmaData)
          },
          {
            name: 'automix-enhancement/runtime/声音 space.bin',
            data: lzmaData,
            method: 14,
            compressed: lzmaPayload
          }
        ])
        assert.equal((await installer.install()).phase, 'ready')
        assert.deepEqual(
          await readFile(join(managedStemPackDirectories(root)[0], 'runtime/声音 space.bin')),
          lzmaData
        )
        assert.deepEqual(
          await readFile(join(managedStemPackDirectories(root)[0], 'runtime/deflated.bin')),
          lzmaData
        )
      },
      { workerDirectory: () => workerDirectory }
    )
  }
)

test(
  'LZMA corruption, truncation and excessive dictionaries preserve the active installation',
  nativeLzma,
  async () => {
    await fixture(
      async ({ zip, installer, root, probes }) => {
        assert.equal((await installer.install()).phase, 'ready')
        const registry = await readFile(join(root, 'active.json'), 'utf8')
        const excessive = Buffer.from(lzmaPayload)
        excessive.writeUInt32LE(256 * 1024 ** 2, 5)
        const corrupt = Buffer.from(lzmaPayload)
        corrupt.fill(0xff, 15, 30)
        for (const payload of [
          Buffer.from([9, 4]),
          lzmaPayload.subarray(0, 45),
          excessive,
          corrupt
        ]) {
          await archive(zip, [
            ...pack(),
            {
              name: 'automix-enhancement/runtime/compressed.bin',
              data: lzmaData,
              method: 14,
              compressed: payload
            }
          ])
          assert.equal((await installer.install()).reason, 'integrity')
          assert.equal(await readFile(join(root, 'active.json'), 'utf8'), registry)
          assert.ok((await readdir(root)).every((name) => !name.startsWith('.install-')))
        }
        assert.equal(probes(), 1)
      },
      { workerDirectory: () => workerDirectory }
    )
  }
)

test(
  'cancelling LZMA extraction stops decoding and removes partial files',
  nativeLzma,
  async () => {
    await fixture(
      async ({ zip, installer, root }) => {
        const extra = Array.from({ length: 30 }, (_, index) => ({
          name: `automix-enhancement/runtime/material-${index}.bin`,
          data: lzmaData,
          method: 14,
          compressed: lzmaPayload
        }))
        await archive(zip, [...pack(), ...extra])
        const pending = installer.install()
        const deadline = Date.now() + 10_000
        while (installer.getStatus().completedBytes < lzmaData.length && Date.now() < deadline)
          await delay(1)
        assert.equal(installer.getStatus().phase, 'extracting')
        installer.cancel()
        assert.equal((await pending).phase, 'cancelled')
        assert.deepEqual(await readdir(root), [])
      },
      { workerDirectory: () => workerDirectory }
    )
  }
)

test('missing LZMA decoder never activates or probes package code', nativeLzma, async () => {
  await fixture(async ({ zip, installer, root, probes }) => {
    await archive(zip, [
      ...pack(),
      {
        name: 'automix-enhancement/runtime/compressed.bin',
        data: lzmaData,
        method: 14,
        compressed: lzmaPayload
      }
    ])
    assert.equal((await installer.install()).reason, 'integrity')
    assert.deepEqual(await readdir(root), [])
    assert.equal(probes(), 0)
  })
})
async function fixture(
  run: (value: {
    root: string
    zip: string
    installer: AutoMixStemInstaller
    probes: () => number
  }) => Promise<void>,
  options: Partial<ConstructorParameters<typeof AutoMixStemInstaller>[0]> = {}
): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'twilight-stem-installer-'))
  assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep))
  const root = join(temporary, 'managed'),
    zip = join(temporary, 'pack.zip')
  let probes = 0
  const installer = new AutoMixStemInstaller({
    root: () => root,
    workerDirectory: () => 'player-worker',
    checkpointSha256: checkpoint,
    chooseArchive: async () => zip,
    probe: async () => {
      probes++
      return { cpu: true, gpu: true, gpuName: 'GPU fixture' }
    },
    ...options
  })
  try {
    await archive(zip, pack())
    await run({ root, zip, installer, probes: () => probes })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

test('ZIP installation publishes an immutable validated pack; identical reinstall reuses it', async () => {
  await fixture(async ({ root, installer, probes }) => {
    const result = await installer.install()
    assert.equal(result.phase, 'ready')
    assert.equal(result.completedBytes, result.totalBytes)
    assert.deepEqual(result.capabilities, { cpu: true, gpu: true, gpuName: 'GPU fixture' })
    const [directory] = managedStemPackDirectories(root)
    assert.deepEqual(await readFile(join(directory, MODEL)), model)
    assert.equal((await installer.install()).phase, 'ready')
    assert.deepEqual(managedStemPackDirectories(root), [directory])
    assert.equal((await readdir(root)).filter((name) => name.startsWith('.')).length, 0)
    assert.equal(probes(), 2)
  })
})

test('rootless and nested packages work; multiple complete packages are rejected', async () => {
  for (const prefix of ['', 'outer/automix-enhancement/'])
    await fixture(async ({ zip, installer }) => {
      await archive(zip, pack(prefix))
      assert.equal((await installer.install()).phase, 'ready')
    })
  await fixture(async ({ zip, installer, probes }) => {
    await archive(zip, [...pack('cpu/'), ...pack('gpu/')])
    assert.equal((await installer.install()).reason, 'invalid_pack')
    assert.equal(probes(), 0)
  })
})

test('unsafe Windows paths, duplicate names, symlinks and file/directory collisions never launch runtime', async () => {
  for (const name of [
    '/absolute',
    '../escape',
    'x/../escape',
    'C:/escape',
    'x\\file',
    'x/file:ads',
    'x/con.txt',
    'x/NUL',
    'x/lpt1.dll',
    'x/space ',
    'x/dot.',
    'x//file',
    'x/./file',
    'x/\0file'
  ])
    assert.throws(() => validateStemArchivePath(name), /invalid_archive/)
  for (const extra of [
    { name: '../escape', data: Buffer.from('x') },
    { name: 'automix-enhancement/runtime/PYTHON.exe', data: Buffer.from('x') },
    { name: 'automix-enhancement/runtime/link', data: Buffer.from('target'), mode: 0xa1ff },
    { name: 'automix-enhancement/runtime', data: Buffer.from('x') }
  ])
    await fixture(async ({ zip, installer, probes, root }) => {
      await archive(zip, [...pack(), extra])
      assert.equal((await installer.install()).reason, 'invalid_archive')
      assert.equal(probes(), 0)
      assert.deepEqual(managedStemPackDirectories(root), [])
    })
})

test('corrupt ZIP CRC, checkpoint and inventory fail integrity before executing the runtime', async () => {
  for (const kind of ['crc', 'model', 'inventory'])
    await fixture(async ({ zip, installer, probes }) => {
      const files = pack()
      if (kind === 'crc') files[3].corruptCrc = true
      if (kind === 'model') files[2].data = Buffer.from('corrupted model')
      if (kind === 'inventory')
        files.push({
          name: 'automix-enhancement/package-files.json',
          data: Buffer.from(
            JSON.stringify({ files: { 'runtime/python.exe': { bytes: 1, sha256: 'bad' } } })
          )
        })
      await archive(zip, files)
      assert.equal((await installer.install()).reason, 'integrity')
      assert.equal(probes(), 0)
    })
})

test('incompatible metadata and malformed archives leave the old active package unchanged', async () => {
  await fixture(async ({ root, zip, installer, probes }) => {
    assert.equal((await installer.install()).phase, 'ready')
    const before = await readFile(join(root, 'active.json'), 'utf8')
    const files = pack()
    files[0].data = Buffer.from('{}')
    await archive(zip, files)
    assert.equal((await installer.install()).reason, 'invalid_pack')
    await writeFile(zip, 'not a ZIP')
    assert.equal((await installer.install()).reason, 'invalid_archive')
    assert.equal(await readFile(join(root, 'active.json'), 'utf8'), before)
    assert.equal(probes(), 1)
    assert.ok((await readdir(root)).every((name) => !name.startsWith('.install-')))
  })
})

test('insufficient disk space is reported before extracting or probing', async () => {
  await fixture(
    async ({ installer, probes, root }) => {
      assert.equal((await installer.install()).reason, 'disk_space')
      assert.equal(probes(), 0)
      assert.deepEqual(await readdir(root), [])
    },
    { freeBytes: async () => 1 }
  )
})

test('picker cancellation changes no files or preferences', async () => {
  await fixture(
    async ({ installer, root, probes }) => {
      assert.equal((await installer.install()).phase, 'cancelled')
      assert.equal(probes(), 0)
      assert.deepEqual(managedStemPackDirectories(root), [])
    },
    { chooseArchive: async () => null }
  )
})

test('runtime failure never publishes a pack', async () => {
  await fixture(
    async ({ installer, root }) => {
      assert.equal((await installer.install()).reason, 'runtime')
      assert.deepEqual(await readdir(root), [])
    },
    {
      probe: async () => {
        throw new Error('runtime failure')
      }
    }
  )
})

test('runtime is verified at a short permanent path before its active registry is published', async () => {
  let probedDirectory = ''
  await fixture(
    async ({ installer, root }) => {
      assert.equal((await installer.install()).phase, 'ready')
      assert.equal(probedDirectory, managedStemPackDirectories(root)[0])
      assert.match(probedDirectory.split(/[\\/]/).at(-1)!, /^[a-f0-9]{24}$/)
    },
    {
      probe: async (directory) => {
        probedDirectory = directory
        assert.ok(!directory.includes('.install-'))
        assert.deepEqual(await readFile(join(directory, MODEL)), model)
        await assert.rejects(readFile(join(directory, '..', 'active.json')))
        return { cpu: true, gpu: false }
      }
    }
  )
})

test('concurrent requests share one operation and cancellation during verification rolls back', async () => {
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await fixture(
    async ({ installer, root }) => {
      const first = installer.install()
      await started
      assert.equal((await installer.install()).phase, 'verifying')
      installer.cancel()
      release()
      assert.equal((await first).phase, 'cancelled')
      assert.deepEqual(await readdir(root), [])
    },
    {
      probe: async () => {
        entered()
        await gate
        return { cpu: true, gpu: false }
      }
    }
  )
})

test('managed registry ignores arbitrary paths and damaged duplicate installations are rejected', async () => {
  await fixture(async ({ installer, root }) => {
    await installer.install()
    const [directory] = managedStemPackDirectories(root)
    await writeFile(join(directory, 'runtime/python.exe'), 'tampered')
    assert.equal((await installer.install()).reason, 'integrity')
    await writeFile(join(root, 'active.json'), JSON.stringify(['../escape', 'C:/escape', 42]))
    assert.deepEqual(managedStemPackDirectories(root), [])
  })
})
