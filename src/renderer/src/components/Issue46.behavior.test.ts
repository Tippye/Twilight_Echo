import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { buildMediaPartRows, MEDIA_PART_PAGE_SIZE } from './streaming-page/mediaPartRows.ts'

const require = createRequire(import.meta.url)
const run = promisify(execFile)

async function component(file: string, name: string): Promise<string> {
  const source = await readFile(new URL(file, import.meta.url), 'utf8')
  const { descriptor } = parse(source, { filename: file })
  let script = ts.transpileModule(
    compileScript(descriptor, { id: name, inlineTemplate: true }).content,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }
  ).outputText
  script = script.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_match, bindings: string, path: string) =>
      `const { ${bindings.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')} } = ${path === 'vue' ? 'Vue' : 'window.fixture'};`
  )
  script = script.replace(
    /import\s+(\w+)\s+from\s*['"][^'"]+['"];?/g,
    'const $1 = window.fixture.$1;'
  )
  script = script.replace('export default', `window.fixture.${name} =`)
  script = script.replace(/^import\s+['"][^'"]+\.css['"];?\s*$/gm, '')
  assert.doesNotMatch(script, /^import /m)
  return `(() => { ${script} })();`
}

test('real Vue login ignores stale QR replies and list links navigate without playing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'te-issue46-ui-'))
  try {
    const vue = await readFile(require.resolve('vue/dist/vue.global.prod.js'), 'utf8')
    const classifications = ts.transpileModule(
      await readFile(
        new URL('./streaming-page/ncmAlbumClassification.ts', import.meta.url),
        'utf8'
      ),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
    ).outputText
    const scripts = await Promise.all([
      component('./TrackInfoDialog.vue', 'TrackInfoDialog'),
      component('./ExplicitBadge.vue', 'ExplicitBadge'),
      component('./streaming-page/NcmAlbumFilters.vue', 'NcmAlbumFilters'),
      component('./streaming-page/SavedMusicCollections.vue', 'SavedMusicCollections'),
      component('./streaming-page/StreamingSocialStage.vue', 'StreamingSocialStage'),
      component('./streaming-page/StreamingDetailStage.vue', 'DetailStage'),
      component('./LoginPage.vue', 'LoginPage')
    ])
    const html = join(directory, 'fixture.html')
    const runner = join(directory, 'runner.cjs')
    await writeFile(
      html,
      `<!doctype html><html><body><div id="login"></div><div id="list"></div><div id="saved"></div><script>${vue}</script><script>
      const { ref, computed } = Vue;
      const MEDIA_PART_PAGE_SIZE = ${MEDIA_PART_PAGE_SIZE};
      Vue.Transition = { setup: (_props, { slots }) => () => slots.default?.() };
      const replies = [];
      const savedAlbums = [], savedArtists = [];
      const provider = { id: 'ncm', name: 'NetEase', capabilities: ['login'], supportedMethods: ['fetchSavedAlbums', 'fetchSavedArtists'], ui: {} };
      window.fixture = {
        buildMediaPartRows: ${buildMediaPartRows.toString()}, MEDIA_PART_PAGE_SIZE,
        QRCode: { toDataURL: async () => 'data:image/png;base64,AA==' },
        AnimatedInput: { template: '<input />' }, CoverImg: { template: '<img />' },
        useBackHandler: () => {},
        useEscapeToClose: () => {},
        NativeDialogTransition: Vue.Transition,
        useNativeDialog: dialog => { Vue.onMounted(() => dialog.value?.showModal()); Vue.onBeforeUnmount(() => dialog.value?.close()); },
        useMediaProviders: () => ({ get: () => ({ fetchSavedAlbums: () => new Promise(resolve => savedAlbums.push(resolve)), fetchSavedArtists: () => new Promise(resolve => savedArtists.push(resolve)) }) }),
        createVisibilityPollingController: () => ({ onVisibilityChange() {} }),
        useNcmStore: () => ({ checkLogin: async () => {} }),
        useProviderStore: () => ({ providers: ref([provider]), syncProviders: async () => {}, hasProvider: () => true, getProvider: () => provider, checkLogin: async () => ({ loggedIn: false, profile: null }), getQrLogin: () => new Promise(resolve => replies.push(resolve)) }),
        useProgressiveList: source => ({ visibleItems: computed(source), visibleStart: ref(0), paddingTop: ref(0), totalHeight: computed(() => source().length * 64), listRef: () => {} })
      };
      (() => { const exports = {}; ${classifications}; Object.assign(window.fixture, exports); })();
      ${scripts.join('\n')}
      const tick = async () => { for (let i = 0; i < 2; i++) { await Vue.nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); } };
      const check = (value, message) => { if (!value) throw Error(message) };
      window.runChecks = async () => {
        let loggedIn = 0;
        const login = Vue.createApp(fixture.LoginPage, { initialProviderId: 'ncm', onLoginSuccess: () => loggedIn++ });
        login.mount('#login'); await tick();
        check(replies.length === 1, 'QR request started');
        const back = [...document.querySelectorAll('#login button')].find(el => el.textContent.includes('全部平台'));
        check(back, 'platform back button'); back.click(); await tick();
        replies[0]({ key: 'expired-session', imageDataUrl: 'data:image/png;base64,AA==' }); await tick();
        check(document.querySelector('#login .stage-title').textContent.includes('选择你的音乐平台'), 'stale QR must not replace platform picker');
        check(loggedIn === 0, 'stale request must not navigate to streaming');
        login.unmount();
        let played = 0, artist = 0, album = 0, selectedArtist = null;
        const track = { id: 'ncm:1', title: 'Song', artist: 'Artist / Guest', artists: [{id:'artist-1', name:'Artist'}, {id:'artist-2', name:'Guest'}], album: 'Album', duration: 180, cover: null };
        const list = Vue.createApp(fixture.DetailStage, { kind: 'playlist', title: 'Playlist', trackCountLabel: '1', tracks: [track], isSelected: () => false, isTrackLiked: () => false, isLiking: () => false, formatTime: () => '3:00', onTrackClick: () => played++, onPlayTrack: () => played++, onOpenArtist: (row, selected) => { check(row.id === track.id, 'artist link retains the original track'); artist++; selectedArtist = selected; }, onOpenAlbum: () => album++ });
        list.mount('#list'); await tick();
        document.querySelector('.row-title').click(); await tick();
        check(document.querySelector('dialog[open]'), 'song title opens information');
        document.querySelector('.track-info-close').click(); await tick();
        check(!document.querySelector('dialog'), 'close button removes song information');
        document.querySelector('.row-title').click(); await tick();
        document.querySelector('dialog').dispatchEvent(new Event('cancel', { cancelable: true })); await tick();
        check(!document.querySelector('dialog'), 'cancel removes song information');
        document.querySelector('.row-artist').click();
        document.querySelector('.stage-row .col-album button').click();
        document.querySelector('.row-artist').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        check(artist === 1 && album === 1 && played === 0, 'metadata links must not play');
        check(selectedArtist.id === 'artist-1', 'first artist keeps its provider ID');
        document.querySelectorAll('.row-artist')[1].click();
        check(artist === 2 && selectedArtist.id === 'artist-2' && played === 0, 'each artist navigates independently without playback');
        document.querySelector('.row-play-btn').click(); check(played === 1, 'play button still plays');
        list.unmount();
        const biliState = Vue.reactive({ liked: true, loading: false });
        let favoriteClicks = 0;
        const biliTrack = { ...track, id: 'bili:BV1:1', source: 'bili' };
        const biliList = Vue.createApp(fixture.DetailStage, {
          kind: 'playlist', title: 'Bilibili Favorites', trackCountLabel: '1', tracks: [biliTrack],
          isExternal: true, showTrackLikes: true, favoriteProviderLabel: 'Bilibili',
          isSelected: () => false, isTrackLiked: row => row.id === biliTrack.id && biliState.liked,
          isLiking: () => biliState.loading, formatTime: () => '3:00',
          onTrackClick: () => played++, onPlayTrack: () => played++,
          onLikeTrack: row => { check(row.id === biliTrack.id, 'heart identifies the video part'); favoriteClicks++; biliState.loading = true; }
        });
        biliList.mount('#list'); await tick();
        const heart = document.querySelector('#list .row-like');
        check(heart && heart.classList.contains('liked'), 'Bilibili favorites render red hearts');
        check(heart.title === '在Bilibili取消收藏' && heart.getAttribute('aria-pressed') === 'true', 'favorite label and accessibility state');
        check(!document.querySelector('#list .stage-list').classList.contains('no-like'), 'like column keeps the correct grid');
        heart.click(); await tick();
        check(favoriteClicks === 1 && played === 1, 'favorite click does not start playback');
        check(heart.disabled && heart.querySelector('.pi-spinner'), 'pending favorite write disables the heart');
        biliState.loading = false; biliState.liked = false; await tick();
        check(!heart.classList.contains('liked') && heart.title === '在Bilibili收藏', 'successful unfavorite clears the heart');
        biliList.unmount();
        const detailState = Vue.reactive({ kind: 'album', isExplicit: true });
        const albumDetail = Vue.createApp({ setup: () => () => Vue.h(fixture.DetailStage, {
          ...detailState, title: 'Explicit album', trackCountLabel: '0', tracks: [],
          isSelected: () => false, isTrackLiked: () => false, isLiking: () => false, formatTime: () => ''
        }) });
        albumDetail.mount('#list'); await tick();
        check(document.querySelector('#list .stage-title-row .explicit-badge')?.getAttribute('aria-label') === 'Explicit 内容', 'album details expose an accessible explicit badge');
        detailState.isExplicit = false; await tick();
        check(!document.querySelector('#list .explicit-badge'), 'clean album details have no explicit badge');
        detailState.kind = 'playlist'; detailState.isExplicit = true; await tick();
        check(!document.querySelector('#list .explicit-badge'), 'album badges do not mark playlists');
        albumDetail.unmount();
        let openedCollection;
        const artistAlbums = Vue.createApp(fixture.StreamingSocialStage, {
          kind: 'artist', title: 'Artist', activeTab: 'albums',
          collections: [{ id: 1, name: 'Explicit album', isExplicit: true }, { id: 2, name: 'Clean album', isExplicit: false }, { id: 3, name: 'Unknown album' }],
          onCollectionClick: item => openedCollection = item
        });
        artistAlbums.mount('#list'); await tick();
        check(document.querySelectorAll('#list .stage-collection-card .explicit-badge').length === 1, 'only flagged artist albums show E');
        document.querySelector('#list .explicit-badge').click();
        check(openedCollection.id === 1 && openedCollection.isExplicit, 'opening an artist album retains the explicit flag');
        artistAlbums.unmount();
        let openedAlbum = null, openedArtist = null;
        const saved = Vue.createApp(fixture.SavedMusicCollections, { userId: 1, providerId: 'ncm', onOpenAlbum: item => openedAlbum = item, onOpenArtist: item => openedArtist = item });
        saved.mount('#saved'); await tick();
        const albumItems = Array.from({ length: 60 }, (_, id) => ({
          id, name: 'Album ' + id, cover: null, trackCount: 1,
          releaseType: id < 50 ? '专辑' : id < 55 ? 'EP' : id < 59 ? 'Single' : undefined,
          isExplicit: id === 0 || id === 50 ? true : id === 1 ? false : undefined
        }));
        savedAlbums[0](albumItems); await tick();
        check(document.querySelectorAll('#saved .saved-grid button').length === 40, 'saved collections render a bounded first batch');
        document.querySelector('#saved .saved-grid button').click();
        check(openedAlbum.id === 0 && openedAlbum.isExplicit, 'saved album opens album detail with its explicit flag');
        check(document.querySelectorAll('#saved .explicit-badge').length === 1, 'only flagged saved albums show E');
        check(!document.querySelector('#saved .ncm-album-filters select'), 'release types do not use a dropdown');
        check(document.querySelectorAll('#saved .ncm-album-filters input[type=radio]').length === 5, 'all release types are directly visible as radios');
        const setAlbumFilter = async value => {
          const radio = [...document.querySelectorAll('#saved .ncm-album-filters input[type=radio]')].find(input => input.value === value);
          check(radio, 'release radio exists: ' + value); radio.click(); await tick();
          check(radio.checked && document.querySelectorAll('#saved .ncm-album-filters input:checked').length === 1, 'exactly one release type remains selected');
        };
        await setAlbumFilter('EP');
        check(document.querySelectorAll('#saved .saved-grid button').length === 5, 'classification filters the whole collection before pagination');
        check(document.querySelector('#saved .saved-grid button').textContent.includes('Album 50'), 'EPs beyond the first page remain discoverable');
        check(document.querySelector('#saved .saved-album-classification').textContent.trim() === 'EP', 'cards show only the release type');
        check(document.querySelectorAll('#saved .explicit-badge').length === 1, 'filtered saved albums retain E');
        await setAlbumFilter('');
        check(document.querySelectorAll('#saved .saved-grid button').length === 40, 'clearing filters restores the bounded collection');
        document.querySelector('#saved .saved-music > button').click(); await tick();
        check(document.querySelectorAll('#saved .saved-grid button').length === 60, 'show more uses the filtered count');
        await setAlbumFilter('专辑');
        check(document.querySelectorAll('#saved .saved-grid button').length === 40, 'changing classification resets the display limit');
        await setAlbumFilter(fixture.UNKNOWN_NCM_ALBUM_CLASSIFICATION);
        check(document.querySelectorAll('#saved .saved-grid button').length === 1, 'missing classifications stay accessible');
        check(!document.querySelector('#saved .saved-album-classification'), 'missing data does not invent a label');
        await setAlbumFilter('');
        const selectSaved = text => [...document.querySelectorAll('#saved header button')].find(button => button.textContent.trim() === text).click();
        selectSaved('歌手'); await tick();
        selectSaved('专辑'); await tick();
        savedArtists[0]([{ id: 9, name: 'Stale artist', picUrl: null }]); await tick();
        check(!document.querySelector('#saved').textContent.includes('Stale artist'), 'late collection replies cannot replace the active category');
        savedAlbums[1]([]); await tick();
        check(document.querySelector('#saved').textContent.includes('暂无收藏专辑'), 'empty collections are visible');
        selectSaved('歌手'); await tick();
        savedArtists[1]([{ id: 10, name: 'Saved artist', picUrl: null }]); await tick();
        document.querySelector('#saved .saved-grid button').click();
        check(openedArtist.id === 10, 'saved artist opens artist detail');
        saved.unmount();
        const otherSaved = Vue.createApp(fixture.SavedMusicCollections, { userId: 1, providerId: 'qq' });
        otherSaved.mount('#saved'); await tick();
        savedAlbums[2](albumItems); await tick();
        check(document.querySelectorAll('#saved .saved-grid button').length === 40, 'other providers retain their saved album grid');
        check(!document.querySelector('#saved .ncm-album-filters'), 'classification controls are exclusive to NCM');
        check(!document.querySelector('#saved .saved-album-classification'), 'classification labels are exclusive to NCM');
        check(!document.querySelector('#saved .explicit-badge'), 'album badges are exclusive to NCM');
        otherSaved.unmount();
        const firstType = ref(''), secondType = ref('');
        const radioGroups = Vue.createApp({ setup: () => () => Vue.h('div', [firstType, secondType].map(type => Vue.h(fixture.NcmAlbumFilters, {
          albums: albumItems, releaseType: type.value, 'onUpdate:releaseType': value => type.value = value
        }))) });
        radioGroups.mount('#saved'); await tick();
        const groups = document.querySelectorAll('#saved .ncm-album-filters');
        check(groups[0].querySelector('input').name !== groups[1].querySelector('input').name, 'radio groups have separate names');
        groups[0].querySelector('input').focus();
        window.verifyKeyboardSelection = async () => {
          await tick();
          check(firstType.value === '专辑', 'right arrow selects the next release type');
          check(secondType.value === '' && groups[1].querySelector('input').checked, 'keyboard selection leaves the other group unchanged');
          radioGroups.unmount();
        };
        return 'passed';
      };
    </script></body></html>`
    )
    await writeFile(
      runner,
      `const { app, BrowserWindow } = require('electron'); app.whenReady().then(async () => { const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, backgroundThrottling: false } }); try { await win.loadFile(process.argv.at(-1)); await win.webContents.executeJavaScript('window.runChecks()'); win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' }); await win.webContents.executeJavaScript('window.verifyKeyboardSelection()'); console.error('ISSUE46_UI_OK'); app.exit(0); } catch (error) { console.error(error); app.exit(1); } });`
    )
    const { stderr } = await run(require('electron') as string, ['--no-sandbox', runner, html], {
      windowsHide: true,
      timeout: 60000
    })
    assert.match(stderr, /ISSUE46_UI_OK/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
