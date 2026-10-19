const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../../../..')
const ts = require(root + '/node_modules/typescript')
const { parse } = require(root + '/node_modules/@vue/compiler-sfc')

test('cover metadata supports native drag selection and copying without navigation', () => {
  const source = fs.readFileSync(root + '/src/renderer/src/components/PlayingMusic.vue', 'utf8')
  const { descriptor } = parse(source)
  const script = descriptor.scriptSetup.content
  const ast = ts.createSourceFile('playing.ts', script, ts.ScriptTarget.Latest, true)
  const names = ['metadataPointerStart', 'metadataDragged', 'beginMetadataSelection', 'trackMetadataSelection', 'canOpenMetadataLink', 'appearanceMenuOpen', 'appearanceMenuPosition', 'metadataCopyText', 'openAppearanceMenu', 'closeAppearanceMenu', 'openMetadataCopyMenu', 'copyMetadataText']
  const nodes = ast.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(ast))))
  )
  const logic = ts.transpileModule(nodes.map(n => n.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  const template = descriptor.template.content.match(/<div\s+class="cover-meta"[\s\S]*?<\/div>/)[0] + descriptor.template.content.match(/<div\s+v-if="appearanceMenuOpen"[\s\S]*?<\/div>/)[0]
  const css = descriptor.styles.map(s => s.content).join('\n')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-metadata-copy-'))
  fs.copyFileSync(root + '/node_modules/vue/dist/vue.global.js', path.join(directory, 'vue.js'))
  const html = `<!doctype html><html><head><style>*{user-select:none;-webkit-user-select:none}body{background:#222;color:white} ${css} .cover-meta{position:absolute;left:30px;top:30px;width:700px;animation:none!important}.track-title{display:block}.cover-metadata-link{font-size:20px}</style></head><body><div id="app"></div><script src="vue.js"></script><script>const ref=Vue.ref;const pushNotice=()=>{};${logic}
  window.opens=[];
  Vue.createApp({setup(){return {currentTrack:{title:'Title example 测试',album:'Album example 专辑'},currentArtists:[{name:'Artist example 歌手'},{name:'Second artist'}],emit:(...args)=>opens.push(args),beginMetadataSelection,trackMetadataSelection,canOpenMetadataLink,openMetadataCopyMenu,appearanceMenuOpen,appearanceMenuPosition,metadataCopyText,copyMetadataText,customizeLyricsAppearance:()=>{},customizePlayerAppearance:()=>{}}},template:${JSON.stringify('<div class="playback-cover-view">' + template + '</div>')}}).mount('#app');
  window.points=selector=>{const el=document.querySelector(selector),node=el.firstChild,range=document.createRange();range.selectNodeContents(el);const rect=range.getBoundingClientRect();return {x:Math.round(rect.left+3),y:Math.round(rect.top+rect.height/2),end:Math.round(rect.right-3)}};
  </script></body></html>`
  fs.writeFileSync(path.join(directory, 'index.html'), html)
  fs.writeFileSync(path.join(directory, 'runner.cjs'), `const {app,BrowserWindow,clipboard}=require('electron');const assert=require('node:assert/strict');
  app.setPath('userData',__dirname+'/profile');
  app.whenReady().then(async()=>{const previousClipboard=clipboard.readText();const win=new BrowserWindow({show:false,width:1000,height:650,webPreferences:{contextIsolation:false,backgroundThrottling:false}});win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));win.webContents.session.setPermissionCheckHandler(()=>false);
  const js=code=>win.webContents.executeJavaScript(code);const pause=()=>new Promise(r=>setTimeout(r,80));
  const input=(type,x,y,extra={})=>win.webContents.sendInputEvent({type,x,y,...extra});
  win.webContents.on('console-message',event=>console.error(event.message));
  try{await win.loadFile(__dirname+'/index.html');await win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  for(const selector of ['.track-title','.track-artist .cover-metadata-link','.track-album .cover-metadata-link']){
    await js('getSelection().removeAllRanges();opens.length=0');const p=await js('points('+JSON.stringify(selector)+')');
    input('mouseDown',p.x,p.y,{button:'left',clickCount:1});await new Promise(r=>setTimeout(r,450));
    for(let x=p.x;x<=p.end;x+=4)input('mouseMove',x,p.y,{button:'left',buttons:['left']});
    input('mouseUp',p.end,p.y,{button:'left',clickCount:1});await pause();
    const selected=await js('getSelection().toString()');assert.ok(selected.length>2,'native selection absent: '+selector);assert.equal(await js('opens.length'),0,'drag navigated: '+selector);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'C',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'C',modifiers:['control']});await pause();assert.equal(clipboard.readText(),selected,'Ctrl+C failed: '+selector);
    await js('document.querySelector('+JSON.stringify(selector)+').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:500,clientY:300}))');await pause();assert.equal(await js('document.querySelector(".player-appearance-menu").textContent.trim()'),'复制','wrong menu after selection');await js('document.querySelector(".player-appearance-menu button").click()');await pause();assert.equal(clipboard.readText(),selected,'menu did not copy selection');
  }
  // Native Range rectangles can describe different font runs on the same line.
  // Verify the intended styles instead of assuming two rectangles are two lines.
  await js('document.querySelector(".track-title").style.width="120px"');
  const geometry=await js('(()=>{const el=document.querySelector(".track-title"),style=getComputedStyle(el);return {radius:style.borderRadius,lineHeight:style.lineHeight,wrapped:el.getBoundingClientRect().height>parseFloat(style.fontSize)*1.5}})()');
  assert.equal(geometry.radius,'0px');assert.equal(geometry.lineHeight,'normal');assert.equal(geometry.wrapped,true);
  for(const selector of ['.track-artist .cover-metadata-link','.track-album .cover-metadata-link']){
    await js('getSelection().removeAllRanges();opens.length=0');const p=await js('points('+JSON.stringify(selector)+')');input('mouseDown',p.x,p.y,{button:'left',clickCount:1});input('mouseUp',p.x,p.y,{button:'left',clickCount:1});await pause();assert.equal(await js('opens.length'),1,'normal click failed: '+selector);
    await js('opens.length=0;document.querySelector('+JSON.stringify(selector)+').focus()');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});await pause();assert.equal(await js('opens.length'),1,'keyboard failed: '+selector);
  }
  await js('getSelection().removeAllRanges();document.querySelector(".track-album .cover-metadata-link").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:500,clientY:300}))');await pause();await js('document.querySelector(".player-appearance-menu button").click()');await pause();assert.equal(clipboard.readText(),'Album example 专辑','whole album copy failed');
  clipboard.writeText(previousClipboard);console.log('METADATA_COPY_OK');app.exit(0)}catch(error){clipboard.writeText(previousClipboard);console.error(error.stack);app.exit(1)}})`)
  const electron = require(root + '/node_modules/electron')
  const output = execFileSync(electron, [path.join(directory, 'runner.cjs')], { windowsHide: true, encoding:'utf8', timeout:30000 })
  assert.match(output, /METADATA_COPY_OK/)
})
