import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import vue from '@vitejs/plugin-vue'
import { parse } from '@vue/compiler-sfc'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const workspace = fileURLToPath(new URL('../../../../../', import.meta.url))

test('workshop authoring and isolated previews work through Electron DOM interactions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-workshop-ui-'))
  try {
    await build({
      configFile: false,
      logLevel: 'error',
      root: workspace,
      plugins: [vue()],
      resolve: {
        alias: {
          '/icon.png': join(workspace, 'resources/icon.png'),
          '@renderer': join(workspace, 'src/renderer/src'),
          '@shared': join(workspace, 'src/shared'),
          vue: require.resolve('vue/dist/vue.esm-bundler.js')
        }
      },
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        outDir: join(directory, 'bundle'),
        emptyOutDir: true,
        minify: false,
        lib: {
          entry: fileURLToPath(new URL('./workshopBehavior.fixture.mjs', import.meta.url)),
          name: 'WorkshopTest',
          formats: ['iife'],
          fileName: 'runtime'
        }
      }
    })
    const files = await readdir(join(directory, 'bundle'))
    const app = parse(
      await readFile(join(workspace, 'src/renderer/src/App.vue'), 'utf8')
    ).descriptor
    const shellStyles = app.styles.map((style) => style.content).join('\n')
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><html><head><meta charset="utf-8">${files
        .filter((file) => file.endsWith('.css'))
        .map((file) => `<link rel="stylesheet" href="bundle/${file}">`)
        .join(
          ''
        )}<style>${shellStyles}body{margin:0}#app{height:100vh}</style></head><body><div id="app"></div><script>window.addEventListener('unhandledrejection',e=>console.error('UNHANDLED '+e.reason?.stack));window.__businessWrites=[];window.api=new Proxy({}, {get:(_target,domain)=>new Proxy({}, {get:(_object,method)=>String(method).startsWith('on')?()=>()=>{}:async()=>{if(/^(set|save|update|play|pause|seek|loadQueue|next|prev|toggle)/.test(String(method)))window.__businessWrites.push(String(domain)+'.'+String(method));if(domain==='data'&&method==='loadLyricsManagement')return {version:1,revision:0,savedAt:new Date(0).toISOString(),data:{version:1,tracks:{}}};return []}})})</script><script src="bundle/${files.find((file) => file.endsWith('.js'))}"></script></body></html>`
    )
    await writeFile(
      join(directory, 'runner.cjs'),
      `const {app,BrowserWindow}=require('electron');app.setPath('userData',require('node:path').join(__dirname,'profile'));app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{contextIsolation:false,backgroundThrottling:false,offscreen:true}});win.webContents.on('console-message',event=>console.error(event.message));let inputTimer;try{await win.loadFile(process.argv.at(-1));win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});inputTimer=setInterval(async()=>{const request=await win.webContents.executeJavaScript('window.__workshopPointerQueue?.shift()');if(request){win.webContents.sendInputEvent(request.event);await win.webContents.executeJavaScript('window.__workshopPointerDone('+request.id+')')}},10);await win.webContents.executeJavaScript('window.runWorkshopTests()');if(process.env.TWILIGHT_WORKSHOP_SCREENSHOT)require('node:fs').writeFileSync(process.env.TWILIGHT_WORKSHOP_SCREENSHOT,(await win.webContents.capturePage()).toPNG());clearInterval(inputTimer);console.log('WORKSHOP_UI_OK');app.exit(0)}catch(error){clearInterval(inputTimer);console.error(error.stack);app.exit(1)}})`
    )
    const result = await promisify(execFile)(
      require('electron'),
      ['--no-sandbox', join(directory, 'runner.cjs'), join(directory, 'index.html')],
      { windowsHide: true, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }
    )
    assert.match(result.stdout, /WORKSHOP_UI_OK/)
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))
    await rm(directory, { recursive: true, force: true })
  }
})
