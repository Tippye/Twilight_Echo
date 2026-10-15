import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const workspace = fileURLToPath(new URL('../../../../../', import.meta.url))

test('quality select shows track availability, retains saved labels, rejects stale results, and presents provider errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-track-quality-'))
  const component = join(
    workspace,
    'src/renderer/src/components/player-bar/PlayerQualitySelect.vue'
  ).replaceAll('\\', '/')
  try {
    await writeFile(join(directory, 'entry.ts'), runtime.replace('__COMPONENT__', component))
    await build({
      configFile: false,
      logLevel: 'error',
      root: workspace,
      plugins: [
        {
          name: 'quality-test-fixtures',
          enforce: 'pre',
          resolveId(source, importer) {
            if (!importer?.replaceAll('\\', '/').startsWith(component)) return null
            if (source === '../../providers') return '\0quality-providers'
            if (source === '../../providers/mediaProvider.ts') return '\0quality-provider-types'
            if (source === '../../stores/usePlayerStore') return '\0quality-player'
            if (source === '../../stores/useAppNoticeStore') return '\0quality-notices'
            return null
          },
          load(id) {
            if (id === '\0quality-providers')
              return `
              export const syncPluginProviders=async()=>{};
              export const useMediaProviders=()=>({getForTrack:()=>window.fixture.provider,getGeneration:()=>window.fixture.generation});`
            if (id === '\0quality-provider-types')
              return 'export const isPluginProviderEnabled=health=>health?.pluginStatus!=="disabled";'
            if (id === '\0quality-player')
              return 'export const usePlayerStore=()=>({changePlaybackQuality:(...args)=>window.fixture.change(...args)});'
            if (id === '\0quality-notices')
              return 'export const useAppNoticeStore=()=>({pushNotice:notice=>window.fixture.notices.push(notice)});'
            return null
          }
        },
        vue()
      ],
      resolve: { alias: { vue: require.resolve('vue/dist/vue.runtime.esm-bundler.js') } },
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        outDir: join(directory, 'bundle'),
        emptyOutDir: true,
        minify: false,
        lib: {
          entry: join(directory, 'entry.ts'),
          name: 'QualityTest',
          formats: ['iife'],
          fileName: () => 'runtime.js'
        }
      }
    })
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script src="bundle/runtime.js"></script></body></html>'
    )
    await writeFile(join(directory, 'runner.cjs'), runner)
    const result = await promisify(execFile)(
      require('electron'),
      ['--no-sandbox', join(directory, 'runner.cjs'), join(directory, 'index.html')],
      { windowsHide: true, timeout: 45_000 }
    )
    assert.match(result.stdout, /TRACK_QUALITY_UI_OK/)
  } finally {
    const target = resolve(directory)
    assert.ok(target.startsWith(resolve(tmpdir()) + sep))
    await rm(target, { recursive: true, force: true })
  }
})

const runtime = `
import {createApp,h,ref,nextTick} from 'vue'
import QualitySelect from '__COMPONENT__'
const check=(value,message)=>{if(!value)throw Error(message)}
const flush=async()=>{for(let i=0;i<12;i++){await Promise.resolve();await nextTick()}}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const choices=[{value:'low',label:'Standard'},{value:'lossless',label:'Lossless'},{value:'spatial',label:'Spatial'}]
const track=ref({id:'public:first',source:'fixture',queueEntryId:'one',title:'Public fixture'})
let changed,querySignal,selectionSignal
window.api={plugins:{onChanged:callback=>{changed=callback;return()=>{changed=undefined}}}}
const f=window.fixture={generation:1,notices:[],quality:'spatial',
 query:async current=>({trackId:current.id,options:[
  {value:'low',label:'Standard',availability:'candidate'},
  {value:'lossless',label:'Lossless',availability:'unknown'},
  {value:'spatial',label:'Spatial',availability:'unavailable',reason:'当前歌曲未提供此音质'}]}),
 change:async()=>{throw Error("Error invoking remote method 'providers:call': Error: QQ音乐当前歌曲未提供所选音质")}}
f.provider={id:'fixture',getPlaybackQuality:async()=>({quality:f.quality,options:choices}),setPlaybackQuality:async()=>{},
 getTrackPlaybackQualities:(current,options)=>{querySignal=options?.signal;return f.query(current,options)}}
const app=createApp({render:()=>h(QualitySelect,{track:track.value})})
app.mount('#app')
const select=()=>document.querySelector('select')
const option=value=>select().querySelector('option[value="'+value+'"]')
const choose=async value=>{select().value=value;select().dispatchEvent(new Event('change',{bubbles:true}));await flush()}
window.runQualityTests=async()=>{
 await flush()
 check(select().value==='spatial','unavailable saved preference remains visibly selected')
 check(option('spatial').disabled&&option('spatial').textContent.includes('当前歌曲未提供此音质'),'unavailable option is disabled and explains why')
 check(option('lossless').textContent.includes('待验证')&&!option('lossless').disabled,'unknown remains attemptable and honestly labelled')
 check(!option('low').disabled,'candidate is selectable')
 await choose('low')
 check(f.notices.length===1&&f.notices[0].message==='QQ音乐当前歌曲未提供所选音质','provider copy survives without Electron IPC wrapper')
 for(const message of [
  'QQ 音乐音频请求失败（HTTP 403）','QQ 音乐音频请求失败（HTTP 401）',
  'QQ 音乐服务端拒绝所选音质（403）','QQ 音乐服务端拒绝所选音质（22）',
  'QQ 音乐所选音质的音频格式或解密验证失败'
 ]){
  f.change=async()=>{throw Error("Error invoking remote method 'providers:call': Error: "+message)}
  await choose('low')
  check(f.notices.at(-1).message===message,'HTTP/service codes must retain the provider media phase instead of becoming a login error')
 }

 const old=deferred(),baseQuery=f.query
 f.query=async()=>old.promise
 select().dispatchEvent(new Event('focus'));await flush()
 const oldSignal=querySignal
 f.query=baseQuery;f.quality='low'
 track.value={...track.value,id:'public:next',queueEntryId:'two'};await flush()
 check(oldSignal.aborted,'changing track cancels pending catalogue IPC')
 old.resolve({trackId:'public:first',options:[{value:'spatial',label:'Old',availability:'candidate'}]});await flush()
 check(select().value==='low'&&option('spatial').disabled,'old track response cannot replace next track choices')

 const heldSelection=deferred()
 f.change=async(_value,options)=>{selectionSignal=options.signal;return heldSelection.promise}
 await choose('lossless')
 f.quality='low';track.value={...track.value,queueEntryId:'duplicate'};await flush()
 check(selectionSignal.aborted,'duplicate queue entry cancels its old selection')
 heldSelection.resolve({quality:'lossless',options:choices});await flush()
 check(select().value==='low','old selection cannot overwrite the new entry preference display')

 const unrelated=deferred();let resumedSelections=0
 f.change=async(value,options)=>{
  selectionSignal=options.signal;f.quality=value;await unrelated.promise
  if(!options.signal.aborted)resumedSelections++
  return {quality:value,options:choices}
 }
 await choose('lossless')
 changed();await flush()
 check(!selectionSignal.aborted,'an unrelated plugin change cannot cancel the current provider selection')
 check(select().disabled,'unrelated change must retain the pending selection busy state')
 unrelated.resolve();await flush()
 check(resumedSelections===1&&select().value==='lossless','the same owner selection continues after an unrelated plugin event')

 const disabledSelection=deferred()
 f.change=async(value,options)=>{selectionSignal=options.signal;await disabledSelection.promise;return {quality:value,options:choices}}
 await choose('low')
 f.provider.health={pluginId:'fixture-plugin',pluginStatus:'disabled'};f.generation++;changed();await flush()
 check(selectionSignal.aborted&&!select(),'disabling the actual current provider still cancels its selection')
 disabledSelection.resolve();await flush()
 f.provider.health={pluginId:'fixture-plugin',pluginStatus:'enabled'};f.generation++;changed();await flush()
 check(select()&&!select().disabled,'re-enabled current provider refreshes its choices')

 const replacedSelection=deferred()
 f.change=async(value,options)=>{selectionSignal=options.signal;await replacedSelection.promise;return {quality:value,options:choices}}
 await choose('low')
 f.provider={...f.provider,health:{pluginId:'replacement-plugin',pluginStatus:'enabled'}};f.generation++;changed();await flush()
 check(selectionSignal.aborted,'replacing the current provider still cancels its selection')
 replacedSelection.resolve();await flush()

 const providerOld=deferred();f.query=async()=>providerOld.promise
 select().dispatchEvent(new Event('focus'));await flush()
 const providerSignal=querySignal
 f.generation++;f.query=baseQuery;changed();await flush()
 providerOld.resolve({trackId:track.value.id,options:[{value:'spatial',label:'Old provider',availability:'candidate'}]});await flush()
 check(providerSignal.aborted&&option('spatial').disabled,'provider change invalidates and cancels old account/provider response')

 delete f.provider.getTrackPlaybackQualities;changed();await flush()
 check([...select().options].every(item=>!item.disabled&&!item.textContent.includes('待验证')),'legacy provider keeps global quality choices')
 f.provider.getTrackPlaybackQualities=(current,options)=>{querySignal=options.signal;return new Promise(()=>{})}
 changed();await flush();const unmountSignal=querySignal
 const unmountedSelection=deferred()
 f.change=async(value,options)=>{selectionSignal=options.signal;await unmountedSelection.promise;return {quality:value,options:choices}}
 await choose('low');const unmountSelectionSignal=selectionSignal
 app.unmount();check(unmountSignal.aborted,'unmount cancels catalogue requests')
 check(unmountSelectionSignal.aborted,'unmount cancels the pending control selection')
 unmountedSelection.resolve();await flush()
 check(!changed,'unmount unsubscribes plugin listener')
 return 'TRACK_QUALITY_UI_OK'
}
`

const runner = `
const {app,BrowserWindow}=require('electron')
app.setPath('userData',require('node:path').join(__dirname,'profile'))
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1000,height:500,webPreferences:{contextIsolation:false,backgroundThrottling:false}})
 win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message)})
 try{
  await win.loadFile(process.argv.at(-1))
  const result=await win.webContents.executeJavaScript('window.runQualityTests().catch(error=>({error:error.stack}))')
  if(result?.error)throw Error(result.error)
  console.log(result)
  app.exit(0)
 }catch(error){console.error(error.stack);app.exit(1)}
})`
