import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const workspace = fileURLToPath(new URL('../../../../', import.meta.url))

test('mini player undo closes the customizer and restores settings and native window size', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-mini-player-undo-'))
  try {
    await build({
      configFile: false,
      root: workspace,
      logLevel: 'error',
      plugins: [vue()],
      resolve: { alias: { vue: require.resolve('vue/dist/vue.esm-bundler.js') } },
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        outDir: join(directory, 'bundle'),
        minify: false,
        lib: {
          entry: fileURLToPath(new URL('./miniPlayerUndo.fixture.mjs', import.meta.url)),
          name: 'MiniPlayerUndoTests',
          formats: ['iife'],
          fileName: 'runtime'
        }
      }
    })
    const files = await readdir(join(directory, 'bundle'))
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><html><head><meta charset="utf-8">${files
        .filter((file) => file.endsWith('.css'))
        .map((file) => `<link rel="stylesheet" href="bundle/${file}">`)
        .join(
          ''
        )}<style>html,body,#app{margin:0;width:100%;height:100%}*{box-sizing:border-box}</style></head><body><div id="app"></div><script src="bundle/${files.find((file) => file.endsWith('.js'))}"></script></body></html>`
    )
    await writeFile(
      join(directory, 'runner.cjs'),
      `const {app,BrowserWindow,ipcMain}=require('electron');
app.setPath('userData',require('node:path').join(__dirname,'profile'));
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,frame:false,useContentSize:true,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false,offscreen:true}});
 ipcMain.handle('mini-player-test:resize',async(_event,width,height)=>{
  win.setContentSize(width,height);
  const deadline=Date.now()+3000;
  while(Date.now()<deadline){
   const viewport=await win.webContents.executeJavaScript('[innerWidth,innerHeight]');
   if(viewport[0]===width&&viewport[1]===height)return;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error('mini player viewport did not reach '+width+'x'+height);
 });
 try{
  await win.loadFile(require('node:path').join(__dirname,'index.html'));
  await win.webContents.executeJavaScript("window.resizeMiniPlayerTest=(width,height)=>require('electron').ipcRenderer.invoke('mini-player-test:resize',width,height);undefined");
  console.log(await win.webContents.executeJavaScript('window.runMiniPlayerUndoTests()'));
  app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1)}
});`
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = await promisify(execFile)(require('electron'), [join(directory, 'runner.cjs')], {
      windowsHide: true,
      timeout: 60_000,
      env
    })
    assert.match(result.stdout, /MINI_PLAYER_UNDO_OK/)
    console.log(result.stdout.trim())
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.ok(basename(directory).startsWith('twilight-mini-player-undo-'))
    await rm(directory, { recursive: true, force: true })
  }
})
