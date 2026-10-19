import test from 'node:test'
import assert from 'node:assert/strict'
import { MusicBrainzProvider } from './musicbrainz.mjs'

const album = { id:'a',title:'Album',artist:'Artist',year:2001,tracks:[{id:'t',title:'Track'}],producers:[],rawGenres:[] }
test('ambiguous MusicBrainz editions remain unresolved rather than importing unrelated credits',async()=>{
  const provider=new MusicBrainzProvider({contact:'tests@example.org',fetcher:async()=>({ok:true,json:async()=>({releases:[{title:'Album','artist-credit':[{name:'Artist'}],'track-count':1,date:'2001',score:100},{title:'Album','artist-credit':[{name:'Artist'}],'track-count':1,date:'2001',score:100}]})})})
  const result=await provider.lookup(album)
  assert.equal(result.online.status,'uncertain')
  assert.deepEqual(result.producers,[])
})
test('matched release reuses upstream credits attribution and preserves externally imported text',async()=>{
  const calls=[]
  const provider=new MusicBrainzProvider({contact:'tests@example.org',fetcher:async(url,options)=>{calls.push({url:String(url),options});return {ok:true,json:async()=>({relations:[{type:'producer',artist:{id:'person',name:'Producer'}}],genres:[{name:'Ambient'}],media:[]})}}})
  const result=await provider.lookup({...album,online:{releaseId:'12345678-1234-1234-1234-123456789abc'},description:'Verified',descriptionSource:{name:'Source',url:'https://example.org',method:'external-ai'}})
  assert.equal(result.online.status,'matched')
  assert.equal(result.description,'Verified')
  assert.equal(result.producers[0].source,'MusicBrainz')
  assert.deepEqual(result.rawGenres,['Ambient'])
  assert.equal(calls.length,1)
  assert.equal(calls[0].options.redirect,'error')
  assert.match(calls[0].options.headers['User-Agent'],/tests@example.org/)
})
