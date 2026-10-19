import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { EMPTY_MINI_PLAYER_STATE } from '../src/shared/miniPlayer.ts'

const require = createRequire(import.meta.url)
const { _electron: electron } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const profile = resolve('.cache/rhine-satellites-' + Date.now())
await mkdir(profile, { recursive: true })
await writeFile(join(profile, 'settings.json'), JSON.stringify({ onboardingCompleted: true, volume: 0 }))
const env = { ...process.env, RHINE_TEST_PROFILE: profile }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: require('electron'), args: [resolve('scripts/rhine-experience-bootstrap.cjs'), '--mute-audio'], env })
const captures = []
const errors = []
try {
  const host = await app.firstWindow()
  await host.waitForFunction(() => !!window.api?.miniPlayer)
  await host.evaluate(() => {
    window.satelliteCommands = []
    window.api.miniPlayer.onCommand(command => window.satelliteCommands.push(command))
    window.api.desktopLyrics.onResyncRequested(() => {})
  })
  const state = { ...EMPTY_MINI_PLAYER_STATE, track: { id: 'test', title: '晨雾 / A Long Album Title', artist: 'RHINE TEST · 合成样本', album: 'Archive 01', duration: 180 }, duration: 180, currentTime: 42, isPlaying: false }
  await host.evaluate(state => {
    window.syntheticStateTimer = setInterval(() => window.api.miniPlayer.publishState(state), 100)
  }, state)
  const open = (kind, theme) => host.evaluate(({kind,theme}) => {
    if(kind === 'mini') return window.api.miniPlayer.open({theme})
    if(kind === 'tray') return window.api.window.showTrayPlayer({theme})
    return window.api.desktopLyrics.setEnabled(true, {theme})
  }, {kind,theme})
  for (const [kind, selector] of [['tray','.tray-player.ready'], ['lyrics','.dl-root'], ['mini','.mini-player-root.is-ready']]) {
    await host.evaluate(state => window.api.miniPlayer.publishState(state), state)
    const event = app.waitForEvent('window')
    await open(kind, 'rhine')
    const page = await event
    page.on('pageerror', e => errors.push(e.message))
    await page.locator(selector).waitFor()
    const bootstrap = kind === 'mini' ? await page.evaluate(() => window.api.miniPlayer.getBootstrap()) : null
    for (const [theme, ink] of [['rhine','#232722'], ['rhine-night','#e9eef2']]) {
      await open(kind, theme)
      await page.waitForFunction(ink => getComputedStyle(document.documentElement).getPropertyValue('--rhine-ink').trim() === ink, ink)
      const isolation = await page.evaluate(() => [typeof window.api.plugins, typeof window.api.settings])
      assert.deepEqual(isolation, ['undefined','undefined'])
      if(kind === 'mini') {
        assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).getPropertyValue('--mini-text').trim()), ink)
        assert.deepEqual((await page.evaluate(() => window.api.miniPlayer.getBootstrap())).settings.profiles, bootstrap.settings.profiles)
      }
      await page.screenshot({path:join(profile,kind+'-'+theme+'.png')})
      captures.push({kind,theme,path:join(profile,kind+'-'+theme+'.png')})
    }
    if(kind !== 'lyrics') {
      await page.getByRole('button',{name:'播放',exact:true}).click()
      await host.waitForFunction(() => window.satelliteCommands.some(c => c.type === 'toggle-play'))
      await host.evaluate(() => { window.satelliteCommands = [] })
    }
    await open(kind, 'default')
    await page.waitForFunction(() => !document.documentElement.classList.contains('rhine-experience-window'))
    if(kind === 'mini') await page.evaluate(() => window.api.miniPlayer.returnToMain())
    if(kind === 'tray') await page.evaluate(() => window.api.trayPlayer.hide())
    if(kind === 'lyrics') await host.evaluate(() => window.api.desktopLyrics.setEnabled(false))
    await host.bringToFront()
  }
  assert.deepEqual(errors, [])
  const result = {passed:true,profile,captures,checks:['day/night/default', 'play command forwarded', 'restricted preload', 'mini profiles preserved'],limitation:'Synthetic state validates window presentation and command routing; full audio playback is covered separately.'}
  await writeFile(join(profile,'result.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
} finally {
  const timer = setTimeout(() => app.process().kill(), 10000)
  await app.close()
  clearTimeout(timer)
}
