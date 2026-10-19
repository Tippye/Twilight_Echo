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
import { build } from 'vite'

const require = createRequire(import.meta.url)
const workspace = fileURLToPath(new URL('../../../../../', import.meta.url))

test(
  'video disclosure, 20-part paging, playback, locating and themes work in the real detail stage',
  { timeout: 60_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'twilight-video-parts-'))
    try {
      await writeFile(join(directory, 'entry.mjs'), runtime)
      await build({
        configFile: false,
        root: workspace,
        publicDir: false,
        logLevel: 'error',
        plugins: [
          {
            name: 'parts-dialog-stub',
            enforce: 'pre',
            resolveId(source) {
              return source.endsWith('/TrackInfoDialog.vue') ? '\0parts-dialog' : null
            },
            load(id) {
              return id === '\0parts-dialog' ? 'export default {render:()=>null}' : null
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
        define: { 'process.env.NODE_ENV': '"production"' },
        build: {
          outDir: join(directory, 'bundle'),
          lib: {
            entry: join(directory, 'entry.mjs'),
            name: 'PartsFixture',
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
          )}<style>body{margin:0;background:var(--te-app-bg);font:14px system-ui}#app{height:100vh;overflow:auto;padding:32px;box-sizing:border-box}.detail-stage{max-width:1040px;margin:auto}@media(max-width:640px){#app{padding:16px}}</style></head><body><div id="app"></div><script src="bundle/${files.find((f) => f.endsWith('.js'))}"></script></body></html>`
      )
      await writeFile(join(directory, 'runner.cjs'), runner)
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = await promisify(execFile)(
        require('electron'),
        [join(directory, 'runner.cjs'), directory],
        { windowsHide: true, timeout: 45_000, env, maxBuffer: 1024 * 1024 }
      )
      assert.match(result.stdout, /VIDEO_PARTS_OK/)
      const checks = JSON.parse(await readFile(join(directory, 'checks.json'), 'utf8'))
      assert.equal(checks.played, 'bili:BVfixture:21')
      assert.equal(checks.queueIndex, 20)
    } finally {
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))
      await rm(directory, { recursive: true, force: true })
    }
  }
)

const runtime = `
import {createApp,h,ref,nextTick} from 'vue';
import Stage from '@renderer/components/streaming-page/StreamingDetailStage.vue';
import '@renderer/assets/base.css';
import '@renderer/assets/primeicons.css';
const cover='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#293c3c"/><circle cx="150" cy="150" r="100" fill="none" stroke="#cab791" stroke-width="2"/><circle cx="150" cy="150" r="72" fill="none" stroke="#cab791"/><text x="150" y="144" text-anchor="middle" font-family="serif" font-size="28" fill="#f0e4ce">CLASSICAL</text><text x="150" y="177" text-anchor="middle" font-family="serif" font-size="18" fill="#cab791">COLLECTION</text></svg>');
const titles=['巴赫：哥德堡变奏曲 · Aria 咏叹调','贝多芬：第九交响曲 第四乐章 · Presto — Allegro assai','莫扎特：A大调单簧管协奏曲 K.622 — Adagio','德彪西：贝加莫组曲 · 月光 Clair de lune','拉赫玛尼诺夫：第二钢琴协奏曲 · Adagio sostenuto'];
const tracks=Array.from({length:47},(_,i)=>({id:'bili:BVfixture:'+(i+1),filePath:'bili:BVfixture:'+(i+1),title:'古典音乐珍藏 · 47部作品 - '+titles[i%5],artist:'古典音乐档案馆',album:'午后古典',cover,duration:180+i*13,source:'bili',mediaPart:{groupId:'bili:BVfixture',groupTitle:'古典音乐珍藏 · 从巴赫到拉赫玛尼诺夫',title:titles[i%5],index:i+1,count:47}}));
const single={...tracks[0],id:'bili:single:1',title:'肖邦 · 夜曲 Op.9 No.2',mediaPart:undefined};
const query=ref(''),sort=ref('default'),current=ref(tracks[40].id),shown=ref([...tracks,single]);
const errors=[],events=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const expect=(ok,label)=>{if(!ok)throw new Error(label)};
const app=createApp({render:()=>h(Stage,{kind:'playlist',title:'午后古典',cover,description:'Bilibili 收藏夹 · 在熟悉的旋律里，发现每一个乐章。',trackCountLabel:'2 个视频',tracks:shown.value,query:query.value,sort:sort.value,currentTrackId:current.value,canLocate:true,isExternal:true,showTrackLikes:true,favoriteProviderLabel:'Bilibili',isSelected:()=>false,isTrackLiked:()=>true,isLiking:()=>false,formatTime:s=>Math.floor(s/60)+':'+String(s%60).padStart(2,'0'),onPlayTrack:(t,i)=>events.push([t.id,i]),onLikeTrack:t=>events.push(['like',t.id]),onTrackContextMenu:(t,i)=>events.push(['context',t.id,i]),'onUpdate:query':value=>{query.value=value;shown.value=value?[tracks[26]]:[...tracks,single]}})});
app.config.errorHandler=e=>errors.push(String(e));app.mount('#app');
const find=s=>document.querySelector(s);
const click=async s=>{expect(find(s),'missing '+s);find(s).click();await nextTick();await pause(90)};
const top=async()=>{find('#app').scrollTop=0;await pause(90)};
const pager=async()=>{const list=find('.stage-rows');find('#app').scrollTop=list.offsetTop+21*64-300;await pause(90);expect(find('.part-pager'),'missing pager')};
window.checkParts=async()=>{
 await pause(150);expect(!find('.part-track'),'starts collapsed');expect(find('.part-count').textContent==='47 P','part count');
 await click('.part-disclosure');expect(find('.part-track[data-part-index="1"]'),'expands P1');expect(!find('[data-part-index="21"]'),'does not leak next page');
 await pager();expect(find('.part-range').textContent.includes('1–20 / 47'),'first page range');expect(find('[aria-label="上一页分P"]').disabled,'first page bound');
 await click('[aria-label="下一页分P"]');expect(find('[data-part-index="21"]'),'second page begins at P21');
 await click('[data-part-index="21"] .row-play-btn');expect(events[0][0]===tracks[20].id&&events[0][1]===20,'correct original playback index');
 await click('[data-part-index="21"] .row-like');expect(events.at(-1)[1]===tracks[20].id,'favorite targets P21');
 find('[data-part-index="21"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));expect(events.at(-1)[2]===20,'context menu index');
 await pager();const select=find('[aria-label="选择分P页码"]');select.value='2';select.dispatchEvent(new Event('change',{bubbles:true}));await pause(100);
 expect(find('[data-part-index="41"]'),'last page P41');expect(!find('[data-part-index="48"]'),'no extra part');
 expect(find('[aria-label="下一页分P"]').disabled,'last page bound');expect(find('.part-range').textContent.includes('41–47 / 47'),'last range');
 await click('.part-collapse');expect(!find('.part-track'),'collapses from footer');await click('.part-disclosure');expect(find('[data-part-index="41"]'),'retains page after folding');
 await click('.part-disclosure');await click('[aria-label="定位正在播放的歌曲"]');expect(find('[data-part-index="41"].playing'),'locate unfolds and pages');
 const input=find('.track-search input');input.value='月光';input.dispatchEvent(new Event('input',{bubbles:true}));await pause(100);expect(find('[data-part-index="27"]'),'matching part revealed automatically');
 await click('[aria-label="定位正在播放的歌曲"]');expect(find('[data-part-index="41"].playing'),'locate clears filter and selects correct page');
 expect(errors.length===0,errors.join(';'));return {played:events[0][0],queueIndex:events[0][1]};
};
window.preparePartsScreenshot=async(tone,expanded)=>{
 document.documentElement.dataset.theme=tone;await top();
 const button=find('.part-disclosure');if((button.getAttribute('aria-expanded')==='true')!==expanded)await click('.part-disclosure');
 if(expanded){const select=find('[aria-label="选择分P页码"]');if(select){select.value='2';select.dispatchEvent(new Event('change',{bubbles:true}));await pause(100)}}
 await top();expect(document.documentElement.scrollWidth<=innerWidth,'horizontal overflow');
 for(const row of document.querySelectorAll('.part-video-row,.part-pager,.part-track'))expect(Math.abs(row.getBoundingClientRect().height-64)<1,'virtual row height');
 expect(errors.length===0,errors.join(';'));
};
`

const runner = `
const {app,BrowserWindow}=require('electron');const path=require('node:path'),fs=require('node:fs');
const directory=process.argv.at(-1);app.setPath('userData',path.join(directory,'profile'));
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{backgroundThrottling:false,offscreen:true}});
try{await win.loadFile(path.join(directory,'index.html'));const checks=await win.webContents.executeJavaScript('window.checkParts()');fs.writeFileSync(path.join(directory,'checks.json'),JSON.stringify(checks));
for(const width of [1280,520])for(const tone of ['pureWhite','dark'])for(const expanded of [true,false]){
 win.setContentSize(width,1000);await win.webContents.executeJavaScript('window.preparePartsScreenshot('+JSON.stringify(tone)+','+expanded+')');
 if(process.env.TWILIGHT_PARTS_EVIDENCE){fs.mkdirSync(process.env.TWILIGHT_PARTS_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.TWILIGHT_PARTS_EVIDENCE,tone+'-'+width+'-'+(expanded?'expanded':'collapsed')+'.png'),(await win.webContents.capturePage()).toPNG())}
}
console.log('VIDEO_PARTS_OK');app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}});
`
