const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const test = require('node:test')

test(
  'Electron preserves wallpaper alpha, streams the derivative and leaves the original intact',
  { timeout: 60000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-background-native-'))
    t.after(() => {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
      assert.ok(path.basename(root).startsWith('twilight-background-native-'))
      fs.rmSync(root, { recursive: true, force: true })
    })
    const esbuild = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }))
    const cacheFile = path.join(root, 'cache.cjs')
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/main/cache/backgroundDisplayCache.ts')],
      outfile: cacheFile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent'
    })
    const runner = path.join(root, 'runner.cjs')
    fs.writeFileSync(
      runner,
      `
    const assert = require('node:assert/strict')
    const fs = require('node:fs/promises')
    const path = require('node:path')
    const { pathToFileURL } = require('node:url')
    const { app, nativeImage, net } = require('electron')
    const { createBackgroundDisplayCache, BACKGROUND_DISPLAY_MAX_PIXELS } = require('./cache.cjs')
    app.setPath('userData', path.join(__dirname, 'profile'))
    app.whenReady().then(async () => {
      try {
        const width = 4200, height = 2400
        const pixels = Buffer.alloc(width * height * 4, 128)
        const original = nativeImage.createFromBitmap(pixels, { width, height }).toPNG()
        const source = path.join(__dirname, 'source.png')
        await fs.writeFile(source, original)
        let decodes = 0
        const decode = bytes => { decodes++; return nativeImage.createFromBuffer(bytes) }
        const cache = createBackgroundDisplayCache(decode)
        const [target, same] = await Promise.all([cache(source), cache(source)])
        assert.equal(target, same)
        assert.equal(decodes, 1)
        const response = await net.fetch(pathToFileURL(target).href)
        assert.equal(response.status, 200)
        assert.ok(response.headers.get('content-type').includes('image/png'))
        const display = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()))
        const size = display.getSize()
        assert.ok(size.width * size.height <= BACKGROUND_DISPLAY_MAX_PIXELS)
        assert.ok(size.width < width && size.height < height)
        const alpha = display.toBitmap()[3]
        assert.ok(alpha >= 127 && alpha <= 129, 'transparent PNG alpha must survive')
        assert.deepEqual(await fs.readFile(source), original)
        assert.equal(await createBackgroundDisplayCache(decode)(source), target)
        assert.equal(decodes, 1, 'disk hit must not decode original again')
        console.log('BACKGROUND_NATIVE_OK', JSON.stringify({ original: { width, height }, display: size, alpha }))
        app.exit(0)
      } catch (error) { console.error(error.stack); app.exit(1) }
    })
  `
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const { stdout } = await promisify(execFile)(require('electron'), [runner], {
      env,
      windowsHide: true,
      timeout: 50000
    })
    assert.match(stdout, /BACKGROUND_NATIVE_OK/)
  }
)
