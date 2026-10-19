import { mkdir, writeFile, cp, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron: electron } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const profile = resolve('.cache/rhine-visual-evidence-' + Date.now())
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
const app = await electron.launch({ executablePath: require('electron'), args: [resolve('scripts/rhine-experience-bootstrap.cjs'), '--mute-audio', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...(process.env.RHINE_TEST_ANGLE ? ['--use-angle='+process.env.RHINE_TEST_ANGLE] : [])], env, timeout: 60000 })
const errors = []
let page
try {
  page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => { errors.push(error.stack || error.message); console.log('pageerror',error.stack); })
  page.on('console', message => { if (message.type() === 'error') console.log('renderer:', message.text().slice(0,400)) })
  await page.waitForFunction(() => !!window.api?.plugins, { timeout: 60000 })
  await app.evaluate(({ dialog }, packageFile) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [packageFile] })
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  }, packageFile)
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},join(profile,'agent.md'));
  const installation = await page.evaluate(() => window.api.plugins.chooseAndInstall('package'))
  console.log('package installed', installation.plugin.id)
  const enabled = await page.evaluate(id => window.api.plugins.enable(id), manifest.id)
  console.log('enabled', enabled.id, enabled.status)
  console.log('experiences', await page.evaluate(() => window.api.extensions.experiences()))
  await page.getByText('莱茵生命', { exact: true }).first().dispatchEvent('click')
  console.log('entered', page.frames().map(frame => frame.url()))
  const frame = page.frameLocator('.experience-window iframe')


  await frame.locator('#three-scene canvas').waitFor({timeout:60000});
  await frame.locator('#music-loading').waitFor({state:'hidden',timeout:60000});
  console.log('initial host scene ready');
  await page.locator('.experience-window iframe').evaluate(iframe=>{iframe.src=iframe.src+'?demo=1&scene=archive&lab=0';});
  await frame.locator('#stage.theme-motion-ready').waitFor({timeout:60000});
  await frame.locator('#music-loading').waitFor({state:'hidden',timeout:60000});
  console.log('host demo scene ready');
  const sizes = [[1920,1080],[2100,900],[1366,768],[2560,1440],[900,1200]];
  const captures=[];
  for(const [width,height] of sizes){
    await page.setViewportSize({width,height});
    for(const theme of ['day','night']){
      // CDP viewport emulation can place these buttons outside the physical
      // desktop at 2560px. Invoke their real handler for visual capture only;
      // the interaction smoke separately uses ordinary pointer clicks.
      await frame.locator('button[data-theme="'+theme+'"]').dispatchEvent('click');
      await frame.locator('#stage[data-theme="'+theme+'"]').waitFor();
      await page.waitForTimeout(3000);
      const pluginFile=join(profile,'plugin-'+width+'x'+height+'-'+theme+'.png');
      await page.locator('.experience-window iframe').screenshot({path:pluginFile});
      captures.push({width,height,theme,pluginFile});
      console.log('captured plugin',width,height,theme);
    }
  }
  // Release the first WebGL scene before loading the reference. Two full
  // quality scenes compete for GPU memory and obscure the actual comparison.
  await page.locator('.experience-chrome button').first().click();
  await page.locator('.experience-window').waitFor({state:'detached'});
  const referenceEvent=app.waitForEvent('window');
  await app.evaluate(({BrowserWindow})=>{
    const win=new BrowserWindow({width:1920,height:1080,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    globalThis.rhineReferenceWindow=win;
    void win.loadURL("http://127.0.0.1:5322/?demo=1&scene=archive&lab=0");
  });
  const reference=await referenceEvent;
  await reference.locator('#stage.theme-motion-ready').waitFor({timeout:60000});
  await reference.locator('#music-loading').waitFor({state:'hidden',timeout:60000});
  for(const capture of captures){
    const {width,height,theme}=capture;
    await reference.setViewportSize({width,height});
    await reference.locator('button[data-theme="'+theme+'"]').dispatchEvent('click');
    await reference.locator('#stage[data-theme="'+theme+'"]').waitFor();
    await reference.waitForTimeout(3000);
    capture.upstreamFile=join(profile,'upstream-'+width+'x'+height+'-'+theme+'.png');
    await reference.screenshot({path:capture.upstreamFile});
    console.log('captured upstream',width,height,theme);
  }
  await writeFile(join(profile,'captures.json'),JSON.stringify({reference:'a889801f',data:'bundled demo covers',captures,angle:process.env.RHINE_TEST_ANGLE || 'default',limitation:'Natural idle motion is not clock-synchronized. These captures are visual inspection evidence, not a frame-accurate acceptance report.'},null,2));
  console.log(JSON.stringify({profile,captures:captures.length},null,2));
}catch(error){
  if(page)await page.screenshot({path:join(profile,'failure.png'),timeout:5000}).catch(()=>{});
  console.error('Visual evidence failed; no acceptance report produced.',profile);
  throw error;
}finally{const timer=setTimeout(()=>app.process().kill(),10000);await app.close();clearTimeout(timer);}
