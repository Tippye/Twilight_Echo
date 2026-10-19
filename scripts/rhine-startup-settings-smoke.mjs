import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { _electron: electron } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const profile = resolve('.cache/rhine-startup-settings-smoke-' + Date.now())
const manifest = JSON.parse(
  await readFile(resolve('../Twilight-Echo-plugins/plugins/rhine-lab/plugin.json'), 'utf8')
)
const packageFile = resolve(
  '../Twilight-Echo-plugins/packages',
  `${manifest.id}-${manifest.version}.tep`
)
const selection = { pluginId: manifest.id, experienceId: 'rhine-lab' }
const key = `${selection.pluginId}:${selection.experienceId}`
await mkdir(profile, { recursive: true })
await writeFile(
  join(profile, 'settings.json'),
  JSON.stringify({ onboardingCompleted: true, autoCheckLogin: false, motionPreference: 'off' })
)
const env = { ...process.env, RHINE_TEST_PROFILE: profile }
delete env.ELECTRON_RUN_AS_NODE
let app, page
const errors = []
async function launch() {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [resolve('scripts/rhine-experience-bootstrap.cjs'), '--mute-audio', ...(process.env.RHINE_TEST_ANGLE ? ['--use-angle=' + process.env.RHINE_TEST_ANGLE] : [])],
    env,
    timeout: 60000
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForFunction(() => !!window.api?.settings, { timeout: 60000 })
}
async function stop() {
  if (app.process().exitCode !== null) {
    app = null
    return
  }
  const closing = app.waitForEvent('close', { timeout: 10000 }).catch(() => {
    app.process().kill()
  })
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await closing
  app = null
}
async function appearance() {
  const settingsButton = page.getByRole('button', { name: '设置', exact: true })
  await settingsButton.waitFor()
  if ((await settingsButton.getAttribute('aria-pressed')) !== 'true') await settingsButton.click()
  await page.locator('[data-settings-category="appearance"]').click({ timeout: 30000 })
  await page.locator('#setting-startup-experience select').waitFor({ timeout: 30000 })
}
const snapshot = () => page.evaluate(() => window.api.settings.get())
try {
  await launch()
  // Upgrade a real older package with the UI mounted, preserving its private data.
  const previousPackage = resolve('../Twilight-Echo-plugins/packages', `${manifest.id}-0.2.1.tep`)
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[file] })
    dialog.showMessageBox = async () => ({ response:0, checkboxChecked:false })
  }, previousPackage)
  await page.evaluate(() => window.api.plugins.chooseAndInstall('package'))
  await page.evaluate(id => window.api.plugins.enable(id), manifest.id)
  await page.evaluate(id => window.api.extensions.experiencePreferences(id, { migrationSentinel:'preserved', localPreferences:{} }), manifest.id)
  await page.getByText('莱茵生命', {exact:true}).first().dispatchEvent('click')
  await page.locator('.experience-window iframe').waitFor()
  await page.waitForFunction(() => document.querySelector('.experience-window iframe')?.src.includes('/0.2.1/'))
  await app.evaluate(({ dialog }, packageFile) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [packageFile] })
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  }, packageFile)
  await page.evaluate(() => window.api.plugins.chooseAndInstall('package'))
  await page.evaluate((id) => window.api.plugins.enable(id), manifest.id)
  await page.waitForFunction(version => document.querySelector('.experience-window iframe')?.src.includes('/'+version+'/'), manifest.version)
  assert.equal((await page.evaluate(id => window.api.extensions.experiencePreferences(id), manifest.id)).migrationSentinel,'preserved')
  await page.getByRole('button',{name:'返回 Twilight Echo',exact:true}).first().click()
  await page.locator('.experience-window').waitFor({state:'detached'})
  console.log('live upgrade preserved preferences and replaced the old frame')
  await appearance()
  console.log('appearance ready')
  const select = page.locator('#setting-startup-experience select')
  await page.waitForFunction(
    (key) =>
      [...document.querySelectorAll('#setting-startup-experience option')].some(
        (option) => option.value === key
      ),
    key
  )
  await page.evaluate(() => {
    window.confirm = (message) => {
      window.__restartPrompt = message
      return false
    }
  })
  await select.selectOption(key)
  await page.waitForFunction(() => window.__restartPrompt?.includes('重启'))
  assert.deepEqual((await snapshot()).settings.startupExperience, selection)
  assert.ok((await snapshot()).restartReasons.includes('完整界面'))
  assert.equal(
    await page.locator('.experience-window').count(),
    0,
    'deferred restart must not swap the live interface'
  )
  await page.locator('.restart-banner').waitFor()
  await select.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(profile, 'appearance-selected.png') })
  console.log('deferred restart saved')
  await page.evaluate(() => {
    window.__restartPrompt = ''
  })
  await select.selectOption('')
  await page.waitForFunction(
    async () => (await window.api.settings.get()).settings.startupExperience === null
  )
  assert.equal(
    await page.evaluate(() => window.__restartPrompt),
    '',
    'reverting an unapplied selection needs no restart'
  )
  assert.ok(!(await snapshot()).restartReasons.includes('完整界面'))
  await select.selectOption(key)
  await page.waitForFunction(() => !!window.__restartPrompt)

  await stop()
  await launch()
  await page.locator('.experience-window iframe').waitFor({ timeout: 60000 })
  assert.ok(!(await snapshot()).restartReasons.includes('完整界面'))
  const frame = page.frameLocator('.experience-window iframe')
  await frame.locator('.three-scene canvas').waitFor({ timeout: 60000 })
  await frame.locator('#music-loading').waitFor({ state: 'hidden', timeout: 60000 })
  await page.screenshot({ path: join(profile, 'startup-rhine.png') })
  console.log('startup restored Rhine')
  await page.getByRole('button', { name: '返回 Twilight Echo', exact: true }).first().click()
  await page.locator('.experience-window').waitFor({ state: 'detached' })
  assert.deepEqual(
    (await snapshot()).settings.startupExperience,
    selection,
    'temporary exit preserves preference'
  )
  await appearance()
  await page.evaluate(() => {
    window.confirm = () => true
  })
  // Exercise the real relaunch IPC and graceful quit, but launch the second process under Playwright.
  await app.evaluate(
    ({ app }, marker) => {
      app.relaunch = () => {
        process.getBuiltinModule('node:fs').writeFileSync(marker, 'yes')
      }
    },
    join(profile, 'relaunch-requested.txt')
  )
  const closed = app.waitForEvent('close', { timeout: 60000 }).catch((error) => ({ error }))
  await page
    .locator('#setting-startup-experience select')
    .selectOption('')
    .catch(() => {})
  const closeResult = await closed
  if (closeResult?.error) throw closeResult.error
  app = null
  assert.equal(await readFile(join(profile, 'relaunch-requested.txt'), 'utf8'), 'yes')
  await launch()
  await appearance()
  assert.equal((await snapshot()).settings.startupExperience, null)
  assert.equal(await page.locator('.experience-window').count(), 0)
  assert.ok(!(await snapshot()).restartReasons.includes('完整界面'))

  // Disabled and removed packages cannot be revived from persisted startup settings.
  await page.evaluate(
    async ({ selection, id }) => {
      await window.api.settings.update({ startupExperience: selection })
      await window.api.plugins.disable(id)
    },
    { selection, id: manifest.id }
  )
  await stop()
  await launch()
  await appearance()
  await page.getByText('所选插件未启用或已移除，启动时将使用默认界面。', { exact: true }).waitFor()
  assert.equal(await page.locator('.experience-window').count(), 0)
  await page.screenshot({ path: join(profile, 'unavailable-fallback.png') })
  await page.evaluate((id) => window.api.plugins.uninstall(id), manifest.id)
  await stop()
  await launch()
  await appearance()
  assert.equal(await page.locator('.experience-window').count(), 0)
  assert.equal(await page.locator('#setting-startup-experience select').inputValue(), key)
  assert.deepEqual(errors, [])
  const result = {
    selection,
    liveUpgrade: true,
    upgradePreservedPreferences: true,
    deferredRestart: true,
    startupRestored: true,
    relaunchIpc: true,
    builtinRestored: true,
    disabledFallback: true,
    uninstalledFallback: true,
    errors
  }
  await writeFile(join(profile, 'result.json'), JSON.stringify(result, null, 2))
  console.log(result)
} catch (error) {
  console.error('Smoke failure:', error, errors)
  if (page && !page.isClosed()) {
    console.error((await page.locator('body').innerText()).slice(0, 2500))
    await page.screenshot({ path: join(profile, 'failure.png') }).catch(() => {})
  }
  throw error
} finally {
  if (app) await stop()
}
