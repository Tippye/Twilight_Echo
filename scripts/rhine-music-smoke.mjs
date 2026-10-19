import { mkdir, writeFile, cp, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { checkRhineServices } from './rhine-services-checks.mjs'
const require = createRequire(import.meta.url)
const { _electron: electron } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const profile = resolve('.cache/rhine-music-v2-smoke-' + Date.now())
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
  const infoChunks = Object.entries({ INAM: 'Silent Test '+(index+1), IART: 'Rhine Test', IPRD: 'Archive '+(index+1), IGNR: 'Ambient', ICRD: '2026' }).map(([key,value])=>{const text=Buffer.from(value+'\0');const h=Buffer.alloc(8);h.write(key);h.writeUInt32LE(text.length,4);return Buffer.concat([h,text,...(text.length%2?[Buffer.alloc(1)]:[])]);});
  const info=Buffer.concat([Buffer.from('INFO'),...infoChunks]);const list=Buffer.alloc(8);list.write('LIST');list.writeUInt32LE(info.length,4);header.writeUInt32LE(data.length+36+list.length+info.length,4);
  await writeFile(filePath, Buffer.concat([header, data, list, info]))
  await writeFile(join(media, `silent-${index}.lrc`), '[00:00.00]Rhine Test\n[00:05.00]Silent playback')
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
const nativePackage = process.env.RHINE_TEST_NATIVE_PACKAGE === '1' && process.env.RHINE_TEST_PACKAGE;
const app = await electron.launch({ executablePath: nativePackage ? join(nativePackage,'TwilightEcho.exe') : require('electron'), args: [...(nativePackage ? ['--user-data-dir='+profile] : [resolve('scripts/rhine-experience-bootstrap.cjs')]), '--mute-audio', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...(process.env.RHINE_TEST_ANGLE ? ['--use-angle='+process.env.RHINE_TEST_ANGLE] : [])], env, timeout: 60000 })
const errors = []
let page
try {
  page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => { errors.push(error.stack || error.message); console.log('pageerror',error.stack); })
  page.on('console', message => { if (message.type() === 'error') console.log('renderer:', message.text().slice(0,400)) })
  await app.evaluate(({BrowserWindow}) => { for(const w of BrowserWindow.getAllWindows()) w.webContents.setBackgroundThrottling(false); });
  await page.waitForFunction(() => !!window.api?.plugins, { timeout: 60000 })
  const runtime = await app.evaluate(({app}) => ({packaged:app.isPackaged,profile:app.getPath('userData'),appPath:app.getAppPath()}));
  if(resolve(runtime.profile)!==profile)throw Error('Test profile isolation failed');
  if(nativePackage && !runtime.packaged)throw Error('Expected packaged executable');
  console.log('runtime',runtime);
  await app.evaluate(({ dialog }, packageFile) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [packageFile] })
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  }, packageFile)
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},join(profile,'agent.md'));
  const installation = await page.evaluate(() => window.api.plugins.chooseAndInstall('package'))
  console.log('package installed', installation.plugin.id)
  const enabled = await page.evaluate(id => window.api.plugins.enable(id), manifest.id)
  if(process.env.RHINE_TEST_QUALITY) {
    await page.evaluate(({id,quality})=>window.api.extensions.experiencePreferences(id, {
      localPreferences: {'rhine-music-preferences': JSON.stringify({quality})}
    }),{id:manifest.id,quality:process.env.RHINE_TEST_QUALITY});
  }
  console.log('enabled', enabled.id, enabled.status)
  console.log('experiences', await page.evaluate(() => window.api.extensions.experiences()))
  await page.getByText('莱茵生命', { exact: true }).first().dispatchEvent('click')
  console.log('entered', page.frames().map(frame => frame.url()))
  await page.bringToFront();
  const frame = page.frameLocator('.experience-window iframe')

  await frame.locator('#three-scene canvas').waitFor({timeout: 60000});
  if(process.env.RHINE_TEST_FULL_OPENING === '1') {
    const openingFrame = page.frames().find(frame => frame.url().startsWith('plugin-ui:'));
    await openingFrame.waitForFunction(() => Number(document.querySelector('.opening-stage')?.dataset.bootFrame) >= 605, undefined, { timeout: 60000 });
    const gated = await openingFrame.evaluate(() => ({inert:document.querySelector('#stage').inert, text:document.querySelector('.welcome-company').textContent}));
    if(!gated.inert || !gated.text.includes('TWILIGHT ECHO')) throw Error('Opening text/readiness isolation failed');
    await page.screenshot({path:join(profile,'twilight-opening.png')});
  } else if(await frame.locator('.opening-skip').isVisible()) await frame.locator('.opening-skip').click();
  await frame.locator('.rhine-loading').waitFor({state:'hidden',timeout:60000});
  if(await frame.locator('.music-boot-skip').isVisible()) await frame.locator('.music-boot-skip').click();
  await frame.locator('#stage[data-music-boot=done]').waitFor({timeout:30000});
  console.log('boot done');
  // The host adds one navigation control to the upstream portrait header.
  // Ensure it cannot displace settings or the persistent transport offscreen.
  await page.setViewportSize({width:900,height:1200});
  await frame.locator('#stage[data-layout="portrait"]').waitFor();
  await frame.locator('[data-action="settings"]').click();
  await frame.locator('[data-action="close-panel"]').click();
  const portraitControls = await frame.locator('.music-topnav').evaluate(nav => {
    const controls = [...nav.querySelectorAll('button')].filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && getComputedStyle(el).display !== 'none';
    });
    return controls.map(el => {const r=el.getBoundingClientRect();return {label:el.getAttribute('aria-label'),inside:r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight}});
  });
  if(portraitControls.some(c=>!c.inside))throw Error('Portrait controls clipped: '+JSON.stringify(portraitControls));
  await page.setViewportSize({width:1366,height:768});
  await frame.locator('.open-album').click({timeout:30000});
  console.log('open requested');
  await frame.locator('.track-row').first().waitFor({timeout:30000});
  await page.waitForTimeout(1800);
  await page.screenshot({path:join(profile,'music-detail.png')});
  if(await frame.locator('#play-pause').getAttribute('aria-pressed')==='true') throw Error('Browsing started playback');
  await frame.locator('.track-row').first().click();
  const child=page.frames().find(frame=>frame.url().startsWith('plugin-ui:'));
  await child.waitForFunction(()=>document.querySelector('.minimal-transport')?.dataset.transport==='playing' && Number(document.querySelector('.minimal-transport').dataset.position)>0,{timeout:30000});
  const read=()=>({transport:document.querySelector('.minimal-transport').dataset.transport,time:Number(document.querySelector('.minimal-transport').dataset.position),title:document.querySelector('#transport-track-label').textContent});
  const before=await child.evaluate(read);
  const isolation=await child.evaluate(()=>({api:typeof window.api,require:typeof require,origin:location.origin}));
  if(isolation.api!=='undefined'||isolation.require!=='undefined')throw Error('Isolation failed');
  await frame.locator('[data-action="settings"]').click();
  await frame.locator('#settings-tab-display').click();
  await frame.locator('#audio-backend').waitFor();
  if(!(await frame.locator('#audio-backend').innerText()).includes('Twilight Echo'))throw Error('Host audio output not shown');
  await page.screenshot({path:join(profile,'music-settings.png')});
  await frame.locator('[data-action="close-panel"]').click();
  await frame.locator('[data-action="back"]').click();
  await page.screenshot({path:join(profile,'music-shelf.png')});
  await page.waitForTimeout(700);
  const after=await child.evaluate(read);
  if(after.transport!=='playing'||after.time<=before.time)throw Error('Navigation interrupted music');
  await frame.getByRole('button',{name:'打开音乐工作台'}).click();
  await frame.locator('.host-track').first().waitFor();
  await frame.getByRole('tab',{name:'收藏与歌单'}).click();
  await frame.getByRole('textbox',{name:'歌单名称',exact:true}).fill('Smoke Playlist');
  await frame.getByRole('button',{name:'创建',exact:true}).click();
  await frame.locator('summary').filter({hasText:'Smoke Playlist'}).waitFor();
  await frame.getByRole('tab',{name:'声音与设备'}).click();
  await frame.getByLabel('前级增益（dB）').fill('-1');
  await frame.getByLabel('前级增益（dB）').dispatchEvent('change');
  await page.screenshot({path:join(profile,'workspace-audio.png')});
  await frame.getByRole('tab',{name:'DSP',exact:true}).click();
  await frame.getByRole('button',{name:'导出处理预设'}).waitFor();
  await frame.getByRole('tab',{name:'插件',exact:true}).click();
  await frame.getByRole('button',{name:'安装插件包'}).waitFor();
  await frame.getByRole('tab',{name:'下载',exact:true}).click();
  await frame.getByText('暂无下载任务',{exact:true}).waitFor();
  await checkRhineServices({page,frame,profile});
  await frame.getByRole('button',{name:'关闭工作台'}).click();
  await frame.getByRole('button',{name:'停止',exact:true}).click();
  await child.waitForFunction(()=>document.querySelector('.minimal-transport')?.dataset.transport==='idle');
  await frame.getByRole('button',{name:'打开音乐工作台'}).click();
  await frame.getByRole('tab',{name:'队列',exact:true}).click();
  await frame.locator('.host-track-name').first().click();
  await child.waitForFunction(()=>document.querySelector('.minimal-transport')?.dataset.transport==='playing');
  await frame.getByRole('button',{name:'关闭工作台'}).click();
  // Open through the plugin controls, then exercise the real host windows.
  await frame.locator('button[data-theme="night"]').click();
  await page.locator('.experience-window[data-tone="night"]').waitFor();
  await frame.getByRole('button',{name:'打开音乐工作台'}).click();
  await frame.getByRole('tab',{name:'应用设置',exact:true}).click();
  const satelliteResults = [];
  for (const [kind, label, root] of [
    ['tray-player', '托盘播放器', '.tray-player.ready'],
    ['desktop-lyrics', '桌面歌词', '.dl-root'],
    ['mini-player', '迷你播放器', '.mini-player-root.is-ready']
  ]) {
    const opened = app.waitForEvent('window');
    await frame.getByRole('button',{name:label,exact:true}).click();
    const satellite = await opened;
    await satellite.locator(root).waitFor();
    await satellite.waitForFunction(() => document.documentElement.classList.contains('rhine-experience-window') && document.documentElement.dataset.experienceTone === 'night');
    await satellite.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--rhine-ink').trim() === '#e9eef2');
    const isolation = await satellite.evaluate(() => ({ plugins: typeof window.api.plugins, settings: typeof window.api.settings }));
    if(isolation.plugins !== 'undefined' || isolation.settings !== 'undefined') throw Error('Satellite isolation failed');
    await satellite.waitForFunction(selector=>Number(getComputedStyle(document.querySelector(selector)).opacity)>=0.99,root);
    if(kind==='mini-player') {
      // Read the rendered text, not only its palette token, after Vue's
      // metadata entrance transition has completed.
      await satellite.waitForFunction(()=>{
        const meta=document.querySelector('.mini-track-meta'),title=document.querySelector('.mini-title'),artist=document.querySelector('.mini-artist');
        return meta && title && artist && getComputedStyle(meta).opacity==='1' && !meta.className.includes('swap-') && getComputedStyle(title).color==='rgb(233, 238, 242)' && getComputedStyle(artist).color==='rgb(156, 170, 189)';
      });
    }
    await satellite.screenshot({path:join(profile,kind+'-rhine-night.png')});
    if(kind==='tray-player') {
      await satellite.getByRole('button',{name:'暂停',exact:true}).click();
      await child.waitForFunction(()=>document.querySelector('.minimal-transport')?.dataset.transport==='paused');
      await satellite.getByRole('button',{name:'播放',exact:true}).click();
      await child.waitForFunction(()=>document.querySelector('.minimal-transport')?.dataset.transport==='playing');
      await page.evaluate(()=>window.api.window.showTrayPlayer());
    } else if(kind==='desktop-lyrics') {
      await satellite.waitForFunction(()=>document.querySelector('.dl-slots'));
      await page.evaluate(()=>window.api.desktopLyrics.setEnabled(true));
    } else {
      const skin = await satellite.locator(root).evaluate(el => getComputedStyle(el).getPropertyValue('--mini-text').trim());
      if(skin!=='#e9eef2')throw Error('Mini player profile overrode Rhine skin: '+skin);
      await page.evaluate(()=>window.api.miniPlayer.open());
    }
    await satellite.waitForFunction(()=>!document.documentElement.classList.contains('rhine-experience-window'));
    satelliteResults.push({kind, isolation, defaultRestored:true});
    if(kind==='tray-player')await satellite.evaluate(()=>window.api.trayPlayer.hide());
    if(kind==='desktop-lyrics')await page.evaluate(()=>window.api.desktopLyrics.setEnabled(false));
    if(kind==='mini-player')await satellite.evaluate(()=>window.api.miniPlayer.returnToMain());
    await page.bringToFront();
  }
  await frame.getByRole('button',{name:'关闭工作台'}).click();
  await page.locator('.experience-chrome button').first().click();
  await page.locator('.experience-window').waitFor({state:'detached'});
  if(errors.length)throw Error(errors.join('\n'));
  const result = {passed:true,profile,package:process.env.RHINE_TEST_PACKAGE || null,runtime:await app.evaluate(({app})=>({packaged:app.isPackaged,appPath:app.getAppPath(),profile:app.getPath('userData')})),quality:process.env.RHINE_TEST_QUALITY || 'original',angle:process.env.RHINE_TEST_ANGLE || 'default',before,after,isolation,portraitControls,satelliteResults};
  await writeFile(join(profile,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} catch(error) { console.error(error); if(page) { console.log(await page.locator('body').innerText({timeout:3000}).catch(()=>'')); for(const f of page.frames()) console.log('frame',f.url(),await f.locator('body').innerText({timeout:3000}).catch(()=>'')); await page.screenshot({path:join(profile,'failure.png'),timeout:10000}).catch(()=>{}); } throw error; } finally {const timer=setTimeout(()=>app.process().kill(),10000); await app.close(); clearTimeout(timer);}
