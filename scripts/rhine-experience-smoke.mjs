import { mkdir, writeFile, cp, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron: electron } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const profile = resolve('.cache/rhine-fusion-smoke')
const pluginRoot = resolve('../Twilight-Echo-plugins/plugins/rhine-lab')
const manifest = JSON.parse(await readFile(join(pluginRoot, 'plugin.json'), 'utf8'))
await mkdir(profile, { recursive: true })
const media = join(profile, 'media')
await mkdir(media, { recursive: true })
await mkdir(join(profile, 'cover-cache'), { recursive: true })
const tracks = []
await cp(join(pluginRoot, 'public/demo-covers/square.png'), join(media, 'cover.png'))
for (const [index, cover] of ['square', 'portrait', 'landscape'].entries()) {
  const data = Buffer.alloc(44100 * 2 * 60)
  const header = Buffer.alloc(44)
  header.write('RIFF'); header.writeUInt32LE(data.length + 36, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22); header.writeUInt32LE(44100, 24); header.writeUInt32LE(88200, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40)
  const fileName = `silent-${index}.wav`
  const filePath = join(media, fileName)
  await writeFile(filePath, Buffer.concat([header, data]))
  await cp(join(pluginRoot, 'public/demo-covers', `${cover}.png`), join(profile, 'cover-cache', `${cover}.png`))
  tracks.push({ id: `rhine-test-${index}`, title: `Silent Test ${index + 1}`, artist: 'Rhine Test',
    album: `Archive ${index + 1}`, albumArtist: 'Rhine Test', genre: 'Ambient', fileName, filePath,
    dir: media, duration: 60, size: data.length + 44, format: 'WAV', sampleRate: 44100, bitDepth: 16,
    trackNumber: 1, discNumber: 1, cover: `cover://${cover}.png`, lyrics: '[00:00.00]Rhine Test\n[00:05.00]Silent playback' })
}
await writeFile(join(profile, 'music-library.json'), JSON.stringify({ version: 2, revision: 1, tracks, folders: [media], exclusions: [] }))
await writeFile(join(profile, 'settings.json'), JSON.stringify({ onboardingCompleted: true, startupHomePage: 'local', libraryFolders: [media], volume: 0 }))
const packageFile = resolve('../Twilight-Echo-plugins/packages', `${manifest.id}-${manifest.version}.tep`)
const env = { ...process.env, RHINE_TEST_PROFILE: profile }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: require('electron'), args: [resolve('scripts/rhine-experience-bootstrap.cjs'), '--mute-audio'], env, timeout: 60000 })
const errors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') console.log('renderer:', message.text()) })
  await page.waitForFunction(() => !!window.api?.plugins, { timeout: 60000 })
  await app.evaluate(({ dialog }, packageFile) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [packageFile] })
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  }, packageFile)
  const installation = await page.evaluate(() => window.api.plugins.chooseAndInstall('package'))
  console.log('package installed', installation.plugin.id)
  const enabled = await page.evaluate(id => window.api.plugins.enable(id), manifest.id)
  console.log('enabled', enabled.id, enabled.status)
  console.log('experiences', await page.evaluate(() => window.api.extensions.experiences()))
  await page.getByText('莱茵生命', { exact: true }).first().dispatchEvent('click')
  console.log('entered', page.frames().map(frame => frame.url()))
  const frame = page.frameLocator('.experience-window iframe')
  await frame.locator('.three-scene canvas').waitFor({ timeout: 60000 })
  console.log('canvas loaded')
  await frame.locator('.system-nav [data-terminal="queue"]').waitFor({ state: 'attached', timeout: 120000 })
  if (await frame.locator('#skip').isVisible()) await frame.locator('#skip').click()
  await frame.locator('[data-action="open"]').last().click()
  await frame.locator('[data-track-play="rhine-test-0"]').waitFor({ timeout: 30000 })
  await page.waitForTimeout(7000)
  const covers = await frame.locator('#three-scene canvas').evaluate(async () => {
    const images = await Promise.all(['square', 'portrait', 'landscape'].map(async name => {
      const image = new Image(); image.crossOrigin = 'anonymous'; image.src = `cover://${name}.png`;
      await image.decode();
      return { loaded: image.naturalWidth > 0, src: image.src };
    }));
    if (document.querySelector('.album-cover')) throw Error('Redundant cover card remains');
    if (document.querySelectorAll('.detail-tabs [role=tab]').length !== 4) throw Error('Missing metadata tabs');
    return images;
  })
  if (covers.some(cover => !cover.loaded)) throw new Error('Host cover handle failed to load')
  if (await frame.locator('[data-terminal="toggle"]').getAttribute('aria-pressed') === 'true') throw new Error('Browsing started playback')
  await page.screenshot({ path: join(profile, 'host-original-detail.png'), timeout: 60000 })
  await frame.locator('[data-track-play="rhine-test-0"]').click()
  const child = page.frames().find(frame => frame.url().startsWith('plugin-ui:'))
  const readPlayback = () => ({ playing: document.querySelector('[data-terminal="toggle"]').getAttribute('aria-pressed') === 'true', time: Number(document.getElementById('twilight-seek').value), track: document.querySelector('.twilight-transport').dataset.trackId })
  await child.waitForFunction(() => document.querySelector('[data-terminal="toggle"]').getAttribute('aria-pressed') === 'true' && Number(document.getElementById('twilight-seek').value) > 0, { timeout: 30000 })
  if (!(await frame.locator('[data-now-album]').innerText()).includes('Archive 1')) throw Error('Current album missing from toolbar')
  await frame.locator('[data-tab="technical"]').click()
  if (!(await frame.locator('#tab-panel').innerText()).includes('44.1 kHz')) throw Error('Host technical metadata missing')
  await frame.locator('.archive-player-panel summary').click()
  await frame.locator('#twilight-seek').fill('12')
  await frame.locator('#twilight-seek').dispatchEvent('change')
  await frame.locator('#twilight-volume').fill('0.2')
  await frame.locator('#twilight-volume').dispatchEvent('change')
  await child.waitForFunction(() => Number(document.getElementById('twilight-seek').value) >= 12 && Number(document.getElementById('twilight-volume').value) === .2)
  await frame.locator('.archive-player-panel summary').click()
  await frame.locator('[data-terminal="queue"]').click({ timeout: 60000 })
  console.log('queue opened')
  await frame.locator('.terminal-track').first().waitFor()
  const playback = await child.evaluate(readPlayback)
  await frame.locator('[data-terminal="close"]').click()
  await frame.locator('[data-action="replay"]').click()
  await child.waitForFunction(() => document.getElementById('stage').dataset.musicBoot === 'running')
  await page.waitForTimeout(1200)
  const duringBoot = await child.evaluate(readPlayback)
  if (!duringBoot.playing || duringBoot.track !== playback.track || duringBoot.time <= playback.time) throw new Error('Replaying startup interrupted host playback')
  await frame.locator('#skip').click()
  await child.waitForFunction(() => document.getElementById('stage').dataset.musicBoot === 'done')
  await frame.locator('[data-terminal="queue"]').click()
  const isolation = await child.evaluate(() => ({ api: typeof window.api, require: typeof require, process: typeof process, origin: location.origin }))
  const boundary = await child.evaluate(async version => ({
    manifest: (await fetch(new URL('../plugin.json', location.href))).status,
    wrongVersion: (await fetch(location.href.replace(`/${version}/`, '/9.9.9/'))).status
  }), manifest.version)
  if (boundary.manifest === 200 || boundary.wrongVersion === 200) throw new Error('Resource boundary escaped')
  if (isolation.api !== 'undefined' || isolation.require !== 'undefined' || isolation.process !== 'undefined') throw new Error('Iframe has privileged globals')
  await page.screenshot({ path: join(profile, 'host-queue.png'), timeout: 60000 })
  await page.getByRole('button', { name: '返回 Twilight Echo', exact: true }).first().click()
  await page.locator('.experience-window').waitFor({ state: 'detached' })
  await page.getByText('莱茵生命', { exact: true }).first().dispatchEvent('click')
  const reentered = await page.waitForEvent('framenavigated', { predicate: frame => frame.url().startsWith('plugin-ui:'), timeout: 10000 }).catch(() => page.frames().find(frame => frame.url().startsWith('plugin-ui:')))
  await reentered.waitForFunction(() => document.querySelector('[data-terminal="toggle"]')?.getAttribute('aria-pressed') === 'true', { timeout: 30000 })
  const afterExit = await reentered.evaluate(readPlayback)
  if (!afterExit.playing || afterExit.time < playback.time) throw new Error('Exiting the experience interrupted host playback')
  await page.evaluate(id => window.api.plugins.disable(id), manifest.id)
  await page.locator('.experience-window').waitFor({ state: 'detached' })
  await page.evaluate(id => window.api.plugins.uninstall(id), manifest.id)
  if ((await page.evaluate(() => window.api.plugins.list())).some(p => p.id === manifest.id)) throw new Error('Uninstall failed')
  console.log(JSON.stringify({ isolation, boundary, covers, playback, afterExit, disabled: true, uninstalled: true, errors }))
  await writeFile(join(profile, 'result.json'), JSON.stringify({ isolation, boundary, covers, playback, duringBoot, afterExit, disabled: true, uninstalled: true, errors }, null, 2))
  if (errors.length) process.exitCode = 1
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
}
