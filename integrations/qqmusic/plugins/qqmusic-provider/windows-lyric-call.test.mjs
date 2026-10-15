import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWindowsComm } from './lib/windows/comm.mjs'
import { buildWindowsPlayLyricInfoCall, decodeWindowsPlayLyricResponse,
  WINDOWS_PLAY_LYRIC_REQUEST_KEY } from './lib/windows/lyric-call.mjs'

const input = { songID:97773, songName:'晴天', singerName:'周杰伦', albumName:'叶惠美',
  interval:269, type:0, requestMode:0 }
// Self-authored public synthetic text; no copyrighted lyric fixture is stored.
const text = '[ti:Public test]\n[00:00.01]A public test line\n'
const translated = '[00:00.01]A translated test line\n'
const encoded = value => Buffer.from(value,'utf8').toString('base64')

test('Windows producer uses its qualified key and numeric inner desktop profile', () => {
  const call = buildWindowsPlayLyricInfoCall(input)
  assert.equal(WINDOWS_PLAY_LYRIC_REQUEST_KEY, `${call.module}.${call.method}`)
  assert.deepEqual(call.param, { songID:97773, songName:'5pm05aSp', singerName:'5ZGo5p2w5Lym',
    albumName:'5Y+25oOg576O', qrc:0, trans:0, roma:0, lrc_t:0, qrc_t:0, trans_t:0, roma_t:0,
    interval:269, type:0, crypt:0, ct:19, cv:2271 })
  const comm = buildWindowsComm({ uin:'0', versionMain:22, versionSub:71, guid:'public-guid',
    openid:'', accessToken:'', accessTokenExpiresAt:'0', unionId:'', musickey:'', tmeLoginType:2,
    channelId:0,encodedOsVersion:'Windows%2010' })
  assert.equal(typeof comm.ct,'string')
  assert.equal(comm.cv,'2271')
  assert.equal(typeof call.param.ct,'number')
})
test('native mode0/3 couples four zero flags and every other mode couples ones', () => {
  for (const mode of [0,3,1,2,4,-1,0x7fffffff]) {
    const flags = mode === 0 || mode === 3 ? 0 : 1
    const { param } = buildWindowsPlayLyricInfoCall({ ...input,requestMode:mode })
    assert.deepEqual([param.crypt,param.qrc,param.trans,param.roma],[flags,flags,flags,flags])
  }
})
test('native UInt32 songID and signed fields retain their boundary types', () => {
  const { param } = buildWindowsPlayLyricInfoCall({ ...input,songID:0xffffffff,lrc_t:-0x80000000,
    qrc_t:0x7fffffff,trans_t:-1,roma_t:1,interval:0x7fffffff,type:-0x80000000 })
  assert.equal(param.songID,4294967295)
  assert.equal(param.lrc_t,-2147483648)
  assert.equal(param.qrc_t,2147483647)
})
test('metadata text and numeric errors never include supplied private values', () => {
  for (const [field,value] of [['songID',-1],['songID',4294967296],['songID','97773'],
    ['requestMode',undefined],['requestMode',1.5],['interval',Infinity],['type',2147483648],
    ['songName','PRIVATE_VALUE\0'],['singerName','\ud800'],['albumName','x'.repeat(4097)]]) {
    assert.throws(()=>buildWindowsPlayLyricInfoCall({ ...input,[field]:value }),error=>!error.message.includes('PRIVATE_VALUE'))
  }
})
test('plaintext Base64 UTF8 maps the SDK lyric fields without mutating response', () => {
  const data = { crypt:0,qrc:0,lyric:encoded(text),trans:encoded(translated),roma:'' }
  const before = structuredClone(data)
  assert.deepEqual(decodeWindowsPlayLyricResponse(data),{ lyrics:text,translatedLyrics:translated,wordLyrics:null })
  assert.deepEqual(data,before)
  assert.equal(decodeWindowsPlayLyricResponse({ ...data,lyric:encoded(text).replace(/=+$/,'') }).lyrics,text)
})
test('empty or absent plaintext values return null without inventing word lyrics', () => {
  assert.deepEqual(decodeWindowsPlayLyricResponse({ crypt:0,qrc:0,lyric:'',trans:'' }),
    { lyrics:null,translatedLyrics:null,wordLyrics:null })
  assert.deepEqual(decodeWindowsPlayLyricResponse({ crypt:0,qrc:0 }),
    { lyrics:null,translatedLyrics:null,wordLyrics:null })
})
test('encrypted or QRC responses fail explicitly before exposing a plaintext result', () => {
  for (const data of [null,[],{}, { crypt:1,qrc:1,lyric:encoded(text) }, { crypt:0,qrc:1,lyric:encoded(text) }]) {
    assert.throws(()=>decodeWindowsPlayLyricResponse(data))
  }
})
test('malformed canonical Base64, invalid UTF8 and oversized text are rejected generically', () => {
  for (const lyric of ['PRIVATE_VALUE!', 'AB==', 'AA=', 'AA===', '/w==', 'AA==', encoded(text)+'\n',
    'A'.repeat(4*1024*1024+1)]) {
    assert.throws(()=>decodeWindowsPlayLyricResponse({ crypt:0,qrc:0,lyric }),
      error=>error.message==='QQ 音乐歌词响应无效')
  }
})
test('UTF8 BOM and non-ASCII synthetic text preserve valid Unicode bytes', () => {
  const unicode = '\ufeff[00:00.01]公开测试文本\n'
  assert.equal(decodeWindowsPlayLyricResponse({ crypt:0,qrc:0,lyric:encoded(unicode) }).lyrics,unicode)
})
