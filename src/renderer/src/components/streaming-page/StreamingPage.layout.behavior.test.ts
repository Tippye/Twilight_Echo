import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

test(
  'streaming detail covers clear the title bar at scroll top after navigating from a root page',
  { timeout: 60_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'twilight-streaming-layout-'))
    try {
      const appSource = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')
      const shellCss = parse(appSource)
        .descriptor.styles.filter((style) => !style.scoped)
        .map((style) => style.content)
        .join('\n')
      await writeFile(
        join(directory, 'entry.mjs'),
        `${runtime}\nconst shellStyle=document.createElement('style');shellStyle.textContent=${JSON.stringify(shellCss)};document.head.appendChild(shellStyle);`
      )
      await build({
        configFile: false,
        root: workspace,
        logLevel: 'error',
        plugins: [
          {
            name: 'streaming-layout-fixture',
            enforce: 'pre',
            resolveId(source) {
              if (/(?:^|[./])usePlayerStore(?:\.ts)?$/.test(source)) return '\0layout-player'
              return null
            },
            load(id) {
              return id === '\0layout-player'
                ? 'export const usePlayerStore = () => window.layoutPlayer'
                : null
            },
            transform(code, id) {
              if (!id.replaceAll('\\', '/').endsWith('/components/StreamingPage.vue')) return null
              // Supply loaded data through the real page's navigation state; all
              // rendering, scrolling, transitions and scoped styles stay real.
              return code.replace('</script>', `${fixtureAccess}\n</script>`)
            }
          },
          vue()
        ],
        resolve: {
          alias: {
            '@renderer': join(workspace, 'src/renderer/src'),
            vue: require.resolve('vue/dist/vue.esm-bundler.js')
          }
        },
        define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
        build: {
          outDir: join(directory, 'bundle'),
          emptyOutDir: true,
          minify: false,
          lib: {
            entry: join(directory, 'entry.mjs'),
            name: 'StreamingLayout',
            formats: ['iife'],
            fileName: 'runtime'
          }
        }
      })
      const files = await readdir(join(directory, 'bundle'))
      await writeFile(
        join(directory, 'index.html'),
        `<!doctype html><html data-theme="pureWhite"><head><meta charset="utf-8">${files
          .filter((f) => f.endsWith('.css'))
          .map((f) => `<link rel="stylesheet" href="bundle/${f}">`)
          .join(
            ''
          )}<style>body{margin:0}#caption{position:fixed;inset:0 0 auto;height:var(--te-titlebar-inset);z-index:9999;background:var(--te-app-bg)}#app{height:100vh}</style></head><body><div id="caption">Twilight Echo</div><div id="app"></div><script src="bundle/${files.find((f) => f.endsWith('.js'))}"></script></body></html>`
      )
      await writeFile(join(directory, 'runner.cjs'), runner)
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = await promisify(execFile)(
        require('electron'),
        [join(directory, 'runner.cjs'), directory],
        { windowsHide: true, timeout: 50_000, env, maxBuffer: 1024 * 1024 }
      )
      assert.match(result.stdout, /STREAMING_LAYOUT_OK/)
    } finally {
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))
      await rm(directory, { recursive: true, force: true })
    }
  }
)

const fixtureAccess = `
defineExpose({
  showFixtureDetail(kind: string, tracks: Track[], cover: string) {
    resetDetail({ animate: false })
    beginDetailTransition()
    const view: DetailView = kind === 'liked' ? { type: 'liked' }
      : kind === 'artist' ? { type: 'artist', artist: { id: 'fixture', name: '测试歌手', picUrl: cover, albumSize: 0, musicSize: tracks.length } }
      : kind === 'album' ? { type: 'album', providerId: 'ncm', album: { id: 'fixture', name: '测试专辑', cover, trackCount: tracks.length } }
      : { type: 'playlist', playlist: { id: 'fixture', name: '测试歌单', cover, trackCount: tracks.length } }
    pushDetail(view)
    detailTracks.value = tracks
  },
  resetFixtureDetail() { resetDetail({ animate: false }) }
})
`

const runtime = `
import {createApp,h,nextTick,ref} from 'vue'
import StreamingPage from '@renderer/components/StreamingPage.vue'
import '@renderer/assets/base.css'
import '@renderer/assets/primeicons.css'
const noop=()=>{};
window.api={
 data:{loadPlaybackBookmarks:async()=>null},
 providers:{list:async()=>[],call:async()=>[]},
 providerDownloads:{list:async()=>[],onChanged:()=>noop},
 ncmCloud:{onProgress:()=>noop}
};
window.layoutPlayer={currentTrack:ref(null),personalizedStreamSession:ref(null),personalizedStreamRemaining:ref(0),queue:ref([]),playTrack:noop,startPersonalizedStream:noop,appendPersonalizedStreamTracks:noop,formatTime:seconds=>Math.floor(seconds/60)+':00'};
const errors=[];
const page=ref(null),tab=ref('library');
let app;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const expect=(ok,label)=>{if(!ok)throw new Error(label)};
const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const paint=canvas.getContext('2d');paint.fillStyle='#718f9c';paint.fillRect(0,0,256,256);const cover=canvas.toDataURL();
const tracks=Array.from({length:100},(_,i)=>({id:'fixture-'+i,title:'歌曲 '+i,artist:'测试歌手',album:'测试专辑',duration:180,source:'ncm',ncmSongId:i+1,cover}));
const mount=async()=>{app?.unmount();app=createApp({render:()=>h(StreamingPage,{ref:page,active:true,menuOpen:false,hasPlayer:false,initialTab:tab.value})});app.config.errorHandler=error=>errors.push(String(error));app.mount('#app');await pause(250)};
window.checkStreamingLayout=async(kind,tone,search=false,caption=40,custom=false)=>{
 document.documentElement.dataset.theme=tone;
 if(custom)document.documentElement.dataset.teShellLayout='custom';else delete document.documentElement.dataset.teShellLayout;
 document.documentElement.style.setProperty('--te-titlebar-inset',caption+'px');
 Object.assign(document.querySelector('#app').style,{position:custom?'relative':'static',top:custom?caption+'px':'0',height:custom?'calc(100vh - '+caption+'px)':'100vh'});
 tab.value=search?'search':'library';await mount();
 expect(errors.length===0,errors.join(';'));
 page.value.showFixtureDetail(kind,tracks,cover);await nextTick();await pause(450);
 const scroll=document.querySelector('.streaming-content');
 scroll.scrollTop=500;scroll.dispatchEvent(new Event('scroll'));await pause(80);
 scroll.scrollTop=0;scroll.dispatchEvent(new Event('scroll'));await pause(80);
 const ring=document.querySelector('.stage-cover-ring');
 expect(ring,'missing '+kind+' cover');
 const top=ring.getBoundingClientRect().top,bottom=document.querySelector('#caption').getBoundingClientRect().bottom;
 expect(scroll.scrollTop===0,'fixture must be at scroll top');
 expect(top>=bottom+12,kind+' cover overlaps caption: cover '+top+', caption '+bottom);
 expect(!document.querySelector('.detail-back-button'),'duplicate detail back button');
 if(search)expect(document.querySelector('.streaming-search-box'),'detail removed search controls');
 else expect(!document.querySelector('.streaming-content-header'),'detail retained an empty header');
 expect(document.documentElement.scrollWidth<=innerWidth,'horizontal overflow');
 expect(errors.length===0,errors.join(';'));
 return {kind,tone,search,caption,top,bottom};
};
`

const runner = `
const {app,BrowserWindow}=require('electron');const path=require('node:path');const fs=require('node:fs');
const directory=process.argv.at(-1);app.setPath('userData',path.join(directory,'profile'));
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{backgroundThrottling:false,offscreen:true}});
try{await win.loadFile(path.join(directory,'index.html'));
for(const width of [1280,520])for(const tone of ['pureWhite','dark'])for(const kind of ['liked','playlist','album','artist']){
 win.setContentSize(width,900);const result=await win.webContents.executeJavaScript('window.checkStreamingLayout('+JSON.stringify(kind)+','+JSON.stringify(tone)+')');console.log(JSON.stringify(result));
 if(process.env.TWILIGHT_STREAMING_LAYOUT_EVIDENCE){fs.mkdirSync(process.env.TWILIGHT_STREAMING_LAYOUT_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.TWILIGHT_STREAMING_LAYOUT_EVIDENCE,tone+'-'+width+'-'+kind+'.png'),(await win.webContents.capturePage()).toPNG())}
}
win.setContentSize(1280,900);await win.webContents.executeJavaScript("window.checkStreamingLayout('playlist','pureWhite',true,56)");await win.webContents.executeJavaScript("window.checkStreamingLayout('liked','pureWhite',false,56)");
await win.webContents.executeJavaScript("window.checkStreamingLayout('playlist','pureWhite',false,56,true)");
console.log('STREAMING_LAYOUT_OK');app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}});
`
