"""Save bounded native lyric sources and copyright-limited public response evidence."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
WORK=Path(__file__).resolve().parent
PLUGIN=Path(r'E:\PycharmProjects\MusicAnyClient\Twilight-Echo-plugins\plugins\qqmusic-provider')
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def load(name):
    return json.loads((WORK/name).read_text(encoding='utf-8-sig'))
dossiers=[]
sources=[]
for name in ('qq-lyric-native-builder.json','qq-lyric-native-name-encoding.json'):
    d=load(name)
    n=d['data']['normalized_result']
    assert not n['native_value_flow']['truncated'] and n['native_value_flow']['omitted_operations_lower_bound']==0
    dossiers.append({'file':name,'sha256':sha(WORK/name),'target_sha256':d['data']['subject']['digest']['sha256'],
                     'evidence_id':d['data']['evidence_id'],'procedure':n['procedure']['address'],
                     'body_bytes':n['procedure']['body']['total_bytes'],'cli_exit':0,
                     'stderr_bytes':(WORK/(name[:-5]+'.stderr.log')).stat().st_size})
    sources.append({'evidence_id':d['data']['evidence_id'],'target_sha256':d['data']['subject']['digest']['sha256'],
                    'procedure':n['procedure'],'pseudocode':n['pseudocode'],'assembly':n['assembly'],
                    'callees':n['callees'],'callers':n['callers'],'referenced_strings':n['referenced_strings'],
                    'limitations':n['limitations']})
source_path=WORK/'qq-lyric-bounded-native-source.json'
source_path.write_text(json.dumps({'schema':'qq-lyric-bounded-native-source-v1','sources':sources},indent=2)+'\n',encoding='utf-8')
probe=load('qq-lyric-anonymous-probe.json')
assert probe['success'] and len(probe['http'])==1 and probe['http'][0]['status']==200
lyric=probe['fields']['lyric']
assert lyric['canonicalBase64'] and lyric['decodedUtf8'] and lyric['lrcTimestampMarker']
assert probe['fields']['crypt']['value']==probe['fields']['qrc']['value']==0
assert probe['fields']['trans']['empty'] and probe['fields']['roma']['empty']
record={
 'schema':'qq-windows-playlyric-native-findings-v1',
 'recorded_at_utc':datetime.now(timezone.utc).isoformat(),
 'scope':'Exactly2new native function dossiers, existing source/runtime request shapes, one anonymous official Windows plaintext-mode probe, two new pure production files. No account/native DLL execution or complete lyric text persisted.',
 'checkpoint':'20-checkpoint.md latest Windows provider activation/media integration section read; complete Windows adaptation/login/media/playback/queue goal remains open.',
 'dossiers':dossiers,
 'bounded_source':{'file':source_path.name,'sha256':sha(source_path)},
 'request_shapes':{'source':'qq-runtime-user-actions-v2-shapes.jsonl','filtered':'qq-lyric-request-shapes.json',
                   'filtered_sha256':sha(WORK/'qq-lyric-request-shapes.json'),'matching_shape_count':3,
                   'fields':'songID/songName/singerName/albumName/qrc/trans/roma/lrc_t/qrc_t/trans_t/roma_t/interval/type/crypt/ct/cv',
                   'types':'Three metadata strings; songID,flags,timestamps,interval,type,innerct/cv numbers. Outercomm ct/cv/patch strings19/2271/118.',
                   'limit':'Sanitized signing-input observations prove shape, not transport success/default caller values/account rights.'},
 'native_contract':{
  'key':'music.musichallSong.PlayLyricInfo.GetPlayLyricInfo','module':'music.musichallSong.PlayLyricInfo','method':'GetPlayLyricInfo',
  'locator':'Qualified/module/method literal initialization at1ee4/1f0b/1f32 constructs CString globals101a4e20/38/50. Actual builder references all3 at2dc55..5f then passes to existing envelope73e50. Literal/initializer alone was not treated as behavior.',
  'producer':'1002d750 (1347bytes), ECXowner,11caller stackparams, RET44. songID param1 unsigned32; mode param11. Ghidra EH injection warnings preserved; native pcode complete without truncation.',
  'names':'Three original wide CString args pass through Common EncodeBase641004a57d then QM::t2a into Jsonstdstring fields. Wide helper301bytes uses t2a→AnsiToUtf8→binary Base644a6aa; UTF8 target established. Specific internal ANSI/codepage replacement and binary alphabet/helper failure behavior not independently recovered.',
  'flags':'Mode0 or3 chooses localformat1 and emits qrc/trans/roma/crypt all0. Modes1/2/4 and every other mode choose localformat4 and emit all1. No real caller default inferred.',
  'signed_fields':'lrc_t/qrc_t/trans_t/roma_t/interval are caller-supplied signedint32 JsonValueH. ct literal19 signedint; cv unsigned main22*100+sub71=2271.',
  'type_boundary':'Native type is ClientSongType2ServerSongType(param2-1), export Common1002dc8e/IATProtocol101235cc; mapping body unexpanded. New pure API receives already-server wire type, not a claimed local enum conversion.'
 },
 'public_probe':{
  'file':'qq-lyric-anonymous-probe.json','sha256':sha(WORK/'qq-lyric-anonymous-probe.json'),
  'script':'qq-lyric-anonymous-probe.mjs','script_sha256':sha(WORK/'qq-lyric-anonymous-probe.mjs'),
  'command':r'node E:\PycharmProjects\MusicAnyClient\docs\aegis\work\2026-10-14-qqmusic-adaptation\qq-lyric-anonymous-probe.mjs',
  'http':'One HTTP200 official /cgi-bin/musics.fcg, signed Windows profile; itemRPC success through existing client parser.',
  'input':'Public songID97773/title晴天/singer周杰伦/album叶惠美/interval269/type0; explicitly native mode0 plaintext branch, timestamp0coldcompatchoice, public fixed probe device and session:null.',
  'response':'crypt0/qrc0. lyric canonicalBase64 string3400chars decoded2548bytes, strictUTF8 LRCtimestamptrue; metadata tag names ti/ar/al/by/offset only. trans/roma empty.',
  'lyric_encoded_sha256':lyric['sha256'],'lyric_decoded_sha256':lyric['decodedSha256'],
  'copyright_boundary':'Original response/decoded strings existed transiently to inspect structure and digest, then only type/length/hash/marker summaries serialized. No complete encoded lyrics, decoded text, line excerpts, QRC or introduction contents stored.',
  'limits':'One plaintext example proves response branch and accepted Unicode request, not original account, nonempty translation, enhancedcrypt1/QRC, word lyrics or full playback.'
 },
 'production':{
  'files':{name:sha(PLUGIN/name) for name in ('lib/windows/lyric-call.mjs','windows-lyric-call.test.mjs')},
  'builder':'buildWindowsPlayLyricInfoCall({songID,songName,singerName,albumName,interval,type,requestMode,lrc_t=0,qrc_t=0,trans_t=0,roma_t=0}); UInt32songID, Int32mode/type/times; metadata encodedUTF8Base64, numericinnerct19/cv2271, couplednative flags.',
  'decoder':'decodeWindowsPlayLyricResponse(data)→{lyrics,translatedLyrics,wordLyrics:null}; requires responsecrypt0/qrc0. Plain lyric/trans decode canonical standardBase64 (unpadded accepted) and fatalUTF8 with BOMpreserved/NULrejected. Empty/missing fields null; errors generic without source text. Enhanced response explicitly needs-source/rejected.',
  'adapter_policy':'4096UTF16unit metadata bound, well-formedUnicode/NUL rejection and directUnicodeUTF8 avoid guessing native ANSI lossiness; decoded field encodedcap4MiB, stricter canonicalBase64. Timestamp defaults0 coldrequest choice. No Android/Web request or decoding fallback.',
  'test_command':'node --test plugins/qqmusic-provider/windows-lyric-call.test.mjs','observed_tests':9,'observed_pass':9,'observed_fail':0,
  'test_authority':'Native static branches and recorded public request shape; only self-authored synthetic LRC/translation text for decoder tests, no copyrighted lyric fixture. Actual probe format inspection is independent of production decoder and does not claim that decoder was replayed against retained live text.',
  'recorded_request_comparison':'Independent no-network probe compared new builder mode0 output to all16 fields/module/method of the already accepted anonymous requestCall; exact object equality passed.',
  'test_setup_corrections':'First test omitted required Commdevice inputs, then mistakenly used string Commversion input; both were test-only setup errors corrected after reading current Commcontract. Lyric9tests freshpassed with numerical22/71 and channel0/OSversion.',
  'scope_preserved':'Only specified2production files written. Noindex/manifest/core/Git changes; root independent review/integration remains.'
 },
 'unknowns':['Native ClientSongType mapping and meaning/default of all caller mode/timestamp values.',
             'Exact native ANSI intermediary/codepage/nonrepresentable Unicode replacement and binaryBase64 helper error/linewrap policy.',
             'Encryptedcrypt1/QRC algorithms, framing, compression and SDK wordLyrics conversion; not guessed from other versions/open-source recipes.',
             'Nonempty trans field live plaintext framing/translation request flags; decoder structural contract tested only with authored synthetictext.',
             'Authenticated requests, real account, lyric rights/caller cache variations or complete modern media/playback acceptance.'],
 'procedure_index':{'file':'qq-lyric-native-procedure-index.json','sha256':sha(WORK/'qq-lyric-native-procedure-index.json'),
                    'observed':'Lyric-named index matched4exported interfaceconstructors only; actual unnamed builder selected through bounded ordinary PE CString global operands/EHentry and confirmed by new dossier.'},
 'no_private_reads_or_full_lyrics':True
}
out=WORK/'qq-lyric-findings.json'
out.write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'findings':str(out),'sha256':sha(out),'dossiers':2,'anonymous_calls':1,'tests_pass':9}))
