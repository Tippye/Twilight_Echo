import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { compileStyle, parse } from '@vue/compiler-sfc'

const require = createRequire(import.meta.url)
test('appearance editor renders reversible drafts and wallpapers across tones, pages and materials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-appearance-'))
  try {
    const stylePaths = [
      'src/renderer/src/components/SideMenu.vue',
      'src/renderer/src/components/TitleBar.vue',
      'src/renderer/src/components/PlayingMusic.vue',
      'src/renderer/src/App.vue',
      'src/renderer/src/components/player-bar/PlayerBar.css',
      'src/renderer/src/components/LocalDashboard.css',
      'src/renderer/src/components/song-list/SongList.css',
      'src/renderer/src/components/streaming-page/StreamingPage.css',
      'src/renderer/src/components/settings-page/SettingsPage.css'
    ]
    const styles = await Promise.all(
      stylePaths.map(async (path) => {
        const source = await readFile(resolve(path), 'utf8')
        const css = path.endsWith('.vue')
          ? parse(source)
              .descriptor.styles.map((style) => style.content)
              .join('\n')
          : source
        const compiled = compileStyle({
          source: css,
          filename: path,
          id: 'data-v-fixture',
          scoped: true
        })
        assert.deepEqual(compiled.errors, [])
        return compiled.code
      })
    )
    await writeFile(join(directory, 'entry.ts'), runtime)
    await build({
      configFile: false,
      root: directory,
      logLevel: 'error',
      plugins: [vue()],
      define: { 'process.env.NODE_ENV': '"production"' },
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared'),
          vue: require.resolve('vue/dist/vue.esm-bundler.js'),
          'primeicons/primeicons.css': require.resolve('primeicons/primeicons.css')
        }
      },
      build: {
        outDir: 'bundle',
        minify: false,
        lib: {
          entry: join(directory, 'entry.ts'),
          name: 'AppearanceTest',
          formats: ['iife'],
          fileName: 'runtime'
        }
      }
    })
    const files = await readdir(join(directory, 'bundle'))
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><html data-te-motion="off"><head><meta charset="utf-8">${files
        .filter((file) => file.endsWith('.css'))
        .map((file) => `<link rel="stylesheet" href="bundle/${file}">`)
        .join(
          ''
        )}<style>${styles.join('\n')}body{margin:0}.fixture-content{position:absolute;left:280px;top:80px;color:var(--te-neutral-900)}.fixture-tile{width:240px;height:160px;padding:20px;box-sizing:border-box}.fixture-settings{position:fixed;inset:0;z-index:2000;isolation:isolate;background:var(--te-settings-bg)}.fixture-settings>.app-background-layer{z-index:-1}.fixture-player{isolation:isolate;z-index:1100}.fixture-player>.app-background-layer{z-index:-1}</style></head><body><div id="app"></div><script src="bundle/${files.find((file) => file.endsWith('.js'))}"></script></body></html>`
    )
    await writeFile(join(directory, 'runner.cjs'), runner)
    const result = await promisify(execFile)(
      require('electron'),
      ['--no-sandbox', join(directory, 'runner.cjs'), join(directory, 'index.html')],
      { windowsHide: true, timeout: 90_000 }
    )
    assert.match(result.stdout, /APPEARANCE_OK/)
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.ok(basename(directory).startsWith('twilight-appearance-'))
    await rm(directory, { recursive: true, force: true })
  }
})

const runner = `
const {app,BrowserWindow,protocol,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path');
protocol.registerSchemesAsPrivileged([{scheme:'background',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.setPath('userData',path.join(__dirname,'profile'));
app.commandLine.appendSwitch('force-color-profile','srgb');
app.whenReady().then(async()=>{
 const bytes=Buffer.alloc(1280*800*4);
 for(let y=0;y<800;y++)for(let x=0;x<1280;x++){const offset=(y*1280+x)*4;bytes[offset]=90;bytes[offset+1]=60;bytes[offset+2]=40;bytes[offset+3]=255}
 const wallpaper=nativeImage.createFromBitmap(bytes,{width:1280,height:800}).toPNG();
 protocol.handle('background',request=>request.url.includes('missing')?new Response('',{status:404}):new Response(wallpaper,{headers:{'content-type':'image/png'}}));
 // Pixel samples use content coordinates; native Windows borders must not shrink the viewport.
 const win=new BrowserWindow({show:false,width:1280,height:820,useContentSize:true,webPreferences:{contextIsolation:false,offscreen:true,backgroundThrottling:false}});
 // Keep crop coordinates in CSS pixels regardless of the Windows display scale.
 const capture=async()=>nativeImage.createFromBuffer(Buffer.from((await win.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',fromSurface:true})).data,'base64'));
 const capturePixel=async point=>{
  const image=await capture();
  const size=image.getSize();
  if(point.x+point.width>size.width||point.y+point.height>size.height)throw new Error('pixel sample lies outside the captured viewport: '+JSON.stringify(size));
  const pixel=image.crop(point).toBitmap();
  if(pixel.length<4)throw new Error('pixel sample is empty');
  return pixel;
 };
 try{
  await win.loadFile(process.argv.at(-1));
  win.webContents.debugger.attach('1.3');
  await win.webContents.executeJavaScript('window.runAppearanceTests()');
  await win.webContents.executeJavaScript('window.runRecipeRestoreTests()');
  for(const page of ['local','streaming','player','settings'])for(const blur of [0,30]){
   await win.webContents.executeJavaScript('window.prepareAppearancePixels('+JSON.stringify(page)+','+blur+')');
   const viewport=(await capture()).getSize();
   // Windows runners can clamp a hidden window to their smaller virtual display.
   for(const point of [{x:600,y:400,width:1,height:1},{x:viewport.width-10,y:400,width:1,height:1}]){
    const pixel=await capturePixel(point);
    if(Math.abs(pixel[0]-43)>3||Math.abs(pixel[1]-29)>3||Math.abs(pixel[2]-19)>3)throw new Error(page+' background brightness/dim or blur edge mismatch: '+[...pixel]);
   }
  }
  await win.webContents.executeJavaScript('window.prepareMissingBackground()');
  const fallback=await capturePixel({x:600,y:400,width:1,height:1});
  // Full-frame capture may round color channels; use the same tolerance as wallpaper samples.
  if(Math.abs(fallback[0]-86)>3||Math.abs(fallback[1]-52)>3||Math.abs(fallback[2]-18)>3)throw new Error('missing image did not fall back to solid color: '+[...fallback]);
  if(process.env.TWILIGHT_APPEARANCE_EVIDENCE_DIR){fs.mkdirSync(process.env.TWILIGHT_APPEARANCE_EVIDENCE_DIR,{recursive:true});for(const tone of ['pureWhite','dark']){await win.webContents.executeJavaScript('window.showAppearanceEvidence('+JSON.stringify(tone)+')');fs.writeFileSync(path.join(process.env.TWILIGHT_APPEARANCE_EVIDENCE_DIR,'appearance-'+tone+'.png'),(await win.webContents.capturePage()).toPNG())}win.setContentSize(620,820);await win.webContents.executeJavaScript('window.settleAppearance()');if(await win.webContents.executeJavaScript('document.querySelector(".appearance-editor").scrollWidth>document.querySelector(".appearance-editor").clientWidth+1'))throw new Error('narrow editor overflows');fs.writeFileSync(path.join(process.env.TWILIGHT_APPEARANCE_EVIDENCE_DIR,'appearance-narrow.png'),(await win.webContents.capturePage()).toPNG())}
  console.log('APPEARANCE_OK');app.exit(0)
 }catch(error){console.error(error.stack);app.exit(1)}
})
`

const runtime = `
import {createApp,h,nextTick,ref} from 'vue'
import Editor from '@renderer/components/BackgroundAppearanceCustomizer.vue'
import Background from '@renderer/components/AppBackgroundLayer.vue'
import '@renderer/assets/base.css'
import '@renderer/assets/appearance.css'
import 'primeicons/primeicons.css'
import {useSettingsStore} from '@renderer/stores/useSettingsStore.ts'
import {bootstrapThemeRuntime,useThemeStore,syncThemeSettingsAppearance,previewAppearance} from '@renderer/stores/useThemeStore.ts'
import {appearanceEditorOpen,appearanceFullWindowPreview,openAppearanceEditor} from '@renderer/composables/appearanceEditorState.ts'
import {applyAppearancePreset,cloneAppearance,defaultCardAppearance,normalizeAppBackgroundSettings} from '@shared/appAppearance.ts'
import {createDefaultThemeLibraryDocument} from '@shared/theme.ts'
const expect=(value,message)=>{if(!value)throw new Error(message)}
const settle=async()=>{await nextTick();for(let i=0;i<4;i++)await new Promise(resolve=>requestAnimationFrame(resolve))}
window.settleAppearance=settle
const page=ref('local'),writes=[];let failSave=false,failImport=false
window.api={settings:{get:async()=>snapshot(),onChanged:()=>()=>{},update:async patch=>{if(failSave)throw new Error('保存失败示例');writes.push(patch);confirmed={...confirmed,...patch};return snapshot()},importBackgroundImage:async()=> {if(failImport)throw new Error('图片导入失败示例');return 'background://wallpaper.png'}},themes:{onChanged:()=>()=>{},onSystemToneChanged:()=>()=>{}},plugins:{onChanged:()=>()=>{}}}
const settingsStore=useSettingsStore(),theme=useThemeStore()
let confirmed={...settingsStore.settings.value,theme:'dark',appBackground:normalizeAppBackgroundSettings({global:{kind:'image',image:'background://wallpaper.png'}}),cardAppearance:defaultCardAppearance(),surfaceMaterial:'standard'}
const snapshot=()=>({settings:confirmed,defaults:confirmed,paths:{},appVersion:'test',platform:'win32',windowTransparencySupported:false,restartReasons:[]})
const startup=()=>({systemTone:'dark',settings:snapshot(),themeBootstrap:{library:{version:2,revision:0,savedAt:new Date(0).toISOString(),data:createDefaultThemeLibraryDocument()}}})
createApp({setup(){return()=>h('div',[
 h(Background,{page:page.value}),
 h('div',{class:'app-shell'},[
  h('div',{class:'title-bar','data-v-fixture':''},'Twilight Echo'),
  h('div',{class:'side-menu','data-v-fixture':''},[h('strong','本地音乐')]),
  h('div',{class:'fixture-content home','data-v-fixture':''},[h('div',{class:'album-card fixture-tile','data-v-fixture':''},'夜航星'),h('div',{class:'context-menu'},'菜单保留底板')]),
  h('div',{class:'player-bar','data-v-fixture':'',style:{position:'fixed',bottom:'15px',left:'280px',width:'850px',height:'65px'}},'♫ 夜航星 ▶')]),
 page.value==='settings'?h('div',{class:'fixture-settings settings-overlay-root settings-overlay-root--active','data-v-fixture':''},[h(Background,{page:'settings',embedded:true})]):null,
 page.value==='player'?h('div',{class:'playing-music fixture-player','data-v-fixture':''},[h(Background,{page:'player',embedded:true}),h('div',{class:'backdrop','data-v-fixture':''},'旧封面背景')]):null,
 appearanceEditorOpen.value?h(Editor):null
])}}).mount('#app')
const button=(text)=>[...document.querySelectorAll('.appearance-editor button,.appearance-full-preview-toolbar button,.appearance-recipe-prompt button')].find(el=>el.textContent.trim()===text && el.checkVisibility())
window.runAppearanceTests=async()=>{
 settingsStore.hydrateStartupSnapshot(startup());await bootstrapThemeRuntime(startup());await settle()
 const cache=localStorage.getItem('twilight-echo:theme-runtime-cache:v1')
 openAppearanceEditor();await settle();expect(document.querySelector('[role=dialog]'),'editor not mounted')
 button('透明').click();document.querySelector('#background-dim').value=40;document.querySelector('#background-dim').dispatchEvent(new Event('input',{bubbles:true}));await settle()
 expect(writes.length===0,'draft persisted before save');expect(settingsStore.settings.value.surfaceMaterial==='standard','confirmed settings mutated')
 const controls=document.querySelector('.appearance-editor-controls');controls.scrollTop=240;const scroll=controls.scrollTop
 button('全窗口预览').click();await settle();expect(appearanceFullWindowPreview.value,'full preview not active');expect(document.documentElement.dataset.teSurfaceMaterial==='transparent','transparent runtime not applied')
 expect(localStorage.getItem('twilight-echo:theme-runtime-cache:v1')===cache,'preview polluted startup cache')
 expect(getComputedStyle(document.querySelector('.side-menu')).backdropFilter==='none','sidebar blur remains')
 expect(getComputedStyle(document.querySelector('.player-bar')).backgroundColor==='rgba(0, 0, 0, 0)','playbar still opaque')
 expect(getComputedStyle(document.querySelector('.context-menu')).backgroundColor!=='rgba(0, 0, 0, 0)','menu lost its readable plate')
 button('返回编辑').click();await settle();expect(document.querySelector('.appearance-editor-controls').scrollTop===scroll,'return to editor lost scroll');button('全窗口预览').click();await settle()
 button('取消').click();await settle();expect(writes.length===0,'cancel persisted');expect(document.documentElement.dataset.teSurfaceMaterial==='standard','cancel did not restore')
 openAppearanceEditor();await settle();button('透明').click();button('保存并使用').click();await settle();expect(writes.length===1,'save must write once');expect(confirmed.surfaceMaterial==='transparent','saved material missing');expect(!appearanceEditorOpen.value,'editor stayed open after save')
 openAppearanceEditor();await settle();button('毛玻璃').click();failSave=true;button('保存并使用').click();await settle();expect(document.querySelector('[role=alert]').textContent.includes('保存失败'),'save failure not visible');expect(appearanceEditorOpen.value,'failure discarded draft');failSave=false;button('保存并使用').click();await settle();expect(confirmed.cardAppearance.dark.backgroundOpacity===60,'retry lost draft');expect(writes.length===2,'retry wrote unexpected patches')
 openAppearanceEditor();await settle();const select=document.querySelector('[aria-label="背景应用范围"]');select.value='settings';select.dispatchEvent(new Event('change',{bubbles:true}));await settle();const inherit=document.querySelector('.appearance-checkbox input');inherit.checked=false;inherit.dispatchEvent(new Event('change',{bubbles:true}));await settle();expect(document.querySelector('#background-scale').value==='1','inheritance copy changed zoom');button('恢复当前项默认').click();await settle();expect(inherit.checked,'page reset did not restore inheritance');button('取消').click();await settle();expect(confirmed.appBackground.pages.settings.inherit,'cancel changed page inheritance')
 openAppearanceEditor();await settle();failImport=true;const input=document.querySelector('.appearance-file-input'),transfer=new DataTransfer();transfer.items.add(new File(['invalid'],'invalid.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await settle();expect(document.querySelector('[role=alert]').textContent.includes('图片导入失败'),'import error missing');expect(document.querySelector('.appearance-mini-window').style.getPropertyValue('--appearance-image').includes('wallpaper.png'),'import failure replaced draft image');expect(writes.length===2,'image import persisted settings');failImport=false;document.querySelector('[aria-label="取消并关闭"]').click();await settle();expect(!appearanceEditorOpen.value,'close did not cancel')
 settingsStore.hydrateStartupSnapshot(startup());await bootstrapThemeRuntime(startup());await settle();expect(document.documentElement.dataset.teCardCustom==='on','saved card profile lost after bootstrap');expect(getComputedStyle(document.documentElement).getPropertyValue('--te-card-blur').trim()==='20px','saved card blur not applied')
 const independent=cloneAppearance(confirmed);independent.appBackground.global.effects.dark.textTone='light';independent.appBackground.pages.streaming={...independent.appBackground.global,inherit:false,effects:{...independent.appBackground.global.effects,dark:{...independent.appBackground.global.effects.dark,textTone:'dark'}}};page.value='streaming';document.body.className='te-streaming-surface';await previewAppearance(independent);await settle();expect(getComputedStyle(document.querySelector('.side-menu')).getPropertyValue('--te-navigation-text').trim()==='#1a202c','streaming navigation inherited local text tone');expect(document.documentElement.dataset.theme==='dark','text tone switched whole theme');await previewAppearance(null)
 for(const tone of ['pureWhite','dark'])for(const material of ['theme','frosted','transparent','liquidGlass'])for(const currentPage of ['local','streaming','player','settings']){
  page.value=currentPage;document.body.className=currentPage==='streaming'?'te-streaming-surface':'te-local-surface';const draft=applyAppearancePreset(confirmed,material);draft.appBackground.global.effects[tone==='dark'?'dark':'light'].textTone=tone==='dark'?'light':'dark';await theme.setPreviewTone(tone);await previewAppearance(draft);await settle();expect(document.documentElement.dataset.teSurfaceMaterial===draft.surfaceMaterial,'material mismatch');const painter=[...document.querySelectorAll('.app-background-layer')].find(el=>el.dataset.backgroundPage===currentPage);expect(getComputedStyle(painter).display!=='none','missing painter '+currentPage);expect(getComputedStyle(painter.querySelector('.app-background-image')).backgroundImage.includes('wallpaper.png'),'page lost image');expect(getComputedStyle(painter.querySelector('.app-background-image')).filter.includes('brightness(1)'),'wrong effect')
 }
 await previewAppearance(null);await theme.setPreviewTone(null)
 const first=cloneAppearance(confirmed),second=cloneAppearance(confirmed);first.surfaceMaterial='transparent';second.surfaceMaterial='liquidGlass';await Promise.all([previewAppearance(first),previewAppearance(second)]);expect(document.documentElement.dataset.teSurfaceMaterial==='liquidGlass','old preview won race');await previewAppearance(null)
}
window.runRecipeRestoreTests=async()=>{
 const baseline=JSON.parse(JSON.stringify(confirmed))
 const waitFor=async(predicate,message)=>{for(let i=0;i<120;i++){await settle();if(predicate())return}throw new Error(message)}
 const upload=async()=>{
  const input=document.querySelector('.appearance-file-input'),transfer=new DataTransfer();transfer.items.add(new File(['image'],'wallpaper.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await waitFor(()=>document.querySelector('[role=alertdialog]'),'successful image import did not offer the recipe')
 }
 for(const tone of ['pureWhite','dark']){
  confirmed=JSON.parse(JSON.stringify(baseline));await settingsStore.loadSettings();await theme.setPreviewTone(tone);await settle();openAppearanceEditor();await settle()
  failImport=true;const input=document.querySelector('.appearance-file-input'),transfer=new DataTransfer();transfer.items.add(new File(['invalid'],'invalid.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await settle();expect(!document.querySelector('[role=alertdialog]'),'failed import opened a recommendation');failImport=false
  const savedWrites=writes.length
  await upload();expect(document.querySelector('[role=alertdialog]').contains(document.activeElement),'prompt did not receive focus');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await settle();expect(!document.querySelector('[role=alertdialog]')&&appearanceEditorOpen.value,'Escape closed the editor instead of the prompt')
  await upload();button('稍后设置').click();await settle();expect(!document.querySelector('[role=alertdialog]')&&appearanceEditorOpen.value,'later action discarded the editor');expect(document.querySelector('.appearance-mini-window').style.getPropertyValue('--appearance-image').includes('wallpaper.png'),'later action discarded the image draft')
  await upload();button('应用推荐').click();await waitFor(()=>button('透明')?.getAttribute('aria-pressed')==='true'&&!button('正在分析背景…'),'recipe did not finish');expect(!document.querySelector('[role=alertdialog]'),'apply action left the prompt open');expect(writes.length===savedWrites,'recipe persisted before save')
  button('保存并使用').click();await settle();expect(confirmed.surfaceMaterial==='transparent','recipe did not save');expect(confirmed.appBackground.global.customized,'recipe did not exercise custom image state')
  openAppearanceEditor();await settle();button('纯色').click();await settle();expect(button('跟随主题').getAttribute('aria-pressed')==='true','solid colour retained transparent material');expect(document.querySelector('#background-dim').value==='0','solid colour retained the image mask')
  page.value='player';button('全窗口预览').click();await settle();expect(document.documentElement.dataset.tePlayerCustomBackground==='off','default solid colour still suppressed the player artwork');expect(document.documentElement.dataset.tePlayerTextTone==='theme','player retained the image text tone');expect(getComputedStyle(document.querySelector('.fixture-player .backdrop')).display!=='none','player backdrop stayed hidden after switching to solid colour');expect(writes.length===savedWrites+1,'solid preview unexpectedly persisted')
  button('返回编辑').click();await settle();button('保存并使用').click();await settle();expect(confirmed.surfaceMaterial==='standard'&&!confirmed.appBackground.global.customized,'solid colour did not persist its restored state');expect(!confirmed.appBackground.global.image&&confirmed.appBackground.global.kind==='color','solid colour kept the image handle');for(const mode of ['light','dark'])expect(confirmed.appBackground.global.effects[mode].textTone==='theme','image text tone survived a restart')
  openAppearanceEditor();await settle();button('图片').click();await settle();await upload();button('应用推荐').click();await waitFor(()=>button('透明')?.getAttribute('aria-pressed')==='true'&&!button('正在分析背景…'),'second recipe did not finish');button('移除').click();await settle();expect(button('跟随主题').getAttribute('aria-pressed')==='true','remove image retained transparent material');button('取消').click();await settle()
 }
 // The affected saved configuration also occurs with the standard material.
 confirmed=JSON.parse(JSON.stringify(baseline));confirmed.surfaceMaterial='standard';confirmed.appBackground=normalizeAppBackgroundSettings({global:{customized:true,effects:{light:{textTone:'dark'}}}});await settingsStore.loadSettings();await theme.setPreviewTone('pureWhite');await settle();openAppearanceEditor();await settle();button('纯色').click();button('保存并使用').click();await settle();expect(!confirmed.appBackground.global.customized&&confirmed.appBackground.global.effects.light.textTone==='theme','selecting the existing solid mode did not repair the stale saved flags')
 confirmed=JSON.parse(JSON.stringify(baseline));await settingsStore.loadSettings();page.value='local';await theme.setPreviewTone(null);await settle()
}
window.prepareAppearancePixels=async(currentPage,blur)=>{
 page.value=currentPage;document.body.className=currentPage==='streaming'?'te-streaming-surface':currentPage==='settings'?'te-settings-surface':'te-local-surface';const draft=cloneAppearance(confirmed);draft.surfaceMaterial='transparent';draft.appBackground.global.effects.dark={...draft.appBackground.global.effects.dark,blur,brightness:80,dim:40};await theme.setPreviewTone('dark');await previewAppearance(draft);await settle()
}
window.prepareMissingBackground=async()=>{page.value='local';document.body.className='te-local-surface';const draft=cloneAppearance(confirmed);draft.surfaceMaterial='transparent';draft.appBackground.global.image='background://missing.png';draft.appBackground.global.dark='#123456';await previewAppearance(draft);await settle()}
window.showAppearanceEvidence=async tone=>{await previewAppearance(null);await theme.setPreviewTone(tone);openAppearanceEditor();await settle();const buttons=[...document.querySelectorAll('.appearance-preview-toolbar button')];buttons[tone==='dark'?1:0].click();await settle()}
`
