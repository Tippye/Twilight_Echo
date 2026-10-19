import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// PKWARE ZIP method 14 has a four-byte version/property prefix followed by
// the five LZMA properties. Convert it to an LZMA-alone stream for the bundled,
// trusted decoder. It receives bytes over stdin and never extracts paths.
function lzmaHeader(bytes: number): Transform {
  let prefix = Buffer.alloc(0)
  let initialized = false
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (initialized) return callback(null, chunk)
      const needed = Math.min(9 - prefix.length, chunk.length)
      prefix = Buffer.concat([prefix, chunk.subarray(0, needed)])
      if (prefix.length < 9) return callback()
      if (
        prefix.readUInt16LE(2) !== 5 ||
        prefix[4] >= 225 ||
        prefix.readUInt32LE(5) > 128 * 1024 ** 2
      )
        return callback(new Error('invalid_zip_lzma_properties'))
      const header = Buffer.alloc(13)
      prefix.copy(header, 0, 4, 9)
      header.writeBigUInt64LE(BigInt(bytes), 5)
      initialized = true
      callback(null, Buffer.concat([header, chunk.subarray(needed)]))
    },
    flush(callback) {
      callback(initialized ? null : new Error('truncated_zip_lzma_header'))
    }
  })
}

export function decodeStemZipLzma(
  input: Readable,
  bytes: number,
  decoder: string,
  signal: AbortSignal
): Readable {
  async function* decode(): AsyncGenerator<Buffer> {
    const child = spawn(decoder, ['x', '-tlzma', '-si', '-so', '-bd'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal
    })
    let failure: unknown
    const closed = new Promise<number | null>((resolve) => {
      child.once('error', (error) => {
        failure ??= error
      })
      child.once('close', resolve)
    })
    child.stderr.on('data', () => {})
    const timer = setTimeout(() => {
      failure ??= new Error('zip_lzma_timeout')
      child.kill()
    }, 5 * 60_000)
    timer.unref()
    const header = lzmaHeader(bytes)
    const written = pipeline(input, header, child.stdin, { signal }).catch((error) => {
      failure ??= error
      child.kill()
      child.stdout.destroy(error)
    })
    try {
      for await (const chunk of child.stdout) yield chunk as Buffer
      await written
      const code = await closed
      if (failure || code !== 0) throw new Error('invalid_zip_lzma_stream', { cause: failure })
    } finally {
      clearTimeout(timer)
      input.destroy()
      header.destroy()
      child.stdin.destroy()
      child.stdout.destroy()
      if (child.exitCode === null) child.kill()
      await Promise.allSettled([written, closed])
    }
  }
  return Readable.from(decode(), { objectMode: false })
}
