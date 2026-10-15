"""Save full64 implementation/runtime evidence and existing-footer crosscheck."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
WORK = Path(__file__).resolve().parent
PLUGIN = Path(r'E:\PycharmProjects\MusicAnyClient\Twilight-Echo-plugins\plugins\qqmusic-provider')
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def load(name):
    return json.loads((WORK / name).read_text(encoding='utf-8-sig'))
d = load('qq-common-implementation-analysis.json')
n = d['data']['normalized_result']
assert n['procedure']['body']['total_bytes'] == 82 and n['assembly'][-1] == '0x10008da0: RET 0x10'
vectors = load('qq-common-file-transform-oracle-matrix-vectors.json')
processes = load('qq-common-file-transform-oracle-matrix-process.json')
fixture = WORK / 'qq-common-file-transform-native-v1.json'
assert fixture.read_bytes() == (PLUGIN / 'test/fixtures/windows-file-transform-native-v1.json').read_bytes()
record = {
 'schema': 'qq-common-file-transform-full64-findings-v1',
 'recorded_at_utc': datetime.now(timezone.utc).isoformat(),
 'authority': 'Root-assigned full64 mode1 pure port and explicitly permitted fixed-public originalDLL internal-helper oracle.',
 'static_helper': {'file': 'qq-common-implementation-analysis.json', 'file_sha256': sha(WORK / 'qq-common-implementation-analysis.json'),
                   'evidence_id': d['data']['evidence_id'], 'address': '0x10008d51', 'body_bytes': 82,
                   'abi': 'Stack-only stdcall4(offsetLow:uint32,offsetHigh:uint32,buffer:pointer,len:signedint32); EAXlen; RET16. Ghidra dummy ECX/EDX parameters are not native inputs.',
                   'algorithm': 'For each signed-positive loop index i, x=uint64(offset+signextend_int32(i)); if x>32767 unsignedmod32767, strict equality remains32767; XOR original fixedtable[(x*x+27)&255].',
                   'caller': 'Read1001384f: GetCurPosition→EDX:EAX actual physical cursor; SUB EAX,bytesRead/SBB EDX0; push len,buffer,high,low→8d51. GetCurPosition10013ab6 subtracts no header.'},
 'native_execution': {
  'commands': [r"pwsh -NoProfile -File 'E:\PycharmProjects\MusicAnyClient\docs\aegis\work\2026-10-14-qqmusic-adaptation\qq-common-file-transform-oracle.ps1' -RunLabel smoke -CaseIds 0",
               r"pwsh -NoProfile -File 'E:\PycharmProjects\MusicAnyClient\docs\aegis\work\2026-10-14-qqmusic-adaptation\qq-common-file-transform-oracle.ps1' -RunLabel matrix"],
  'target': r'E:\Program Files (x86)\QQMusic\QQMusic2271.18.09.14\QQMusicCommon.dll',
  'target_sha256': '4267e1c27f7251a31460613a97f5787fd7d9d0be3664e5e615251aba2780471f',
  'script_file': 'qq-common-file-transform-oracle.py', 'script_sha256': sha(WORK / 'qq-common-file-transform-oracle.py'),
  'runner_file': 'qq-common-file-transform-oracle.ps1', 'runner_sha256': sha(WORK / 'qq-common-file-transform-oracle.ps1'),
  'smoke': 'Case0 checks passed and exact output matched first64 of prior original wrapper case0/len512 before matrix.',
  'matrix_cases': 14, 'all_exit0_stderr0_no_timeout': all(p['exit_code'] == 0 and p['stderr_bytes'] == 0 and not p['timed_out'] for p in processes['processes']),
  'positions': [v['offset_unsigned_decimal'] for v in vectors['vectors']],
  'lengths': [v['length'] for v in vectors['vectors']],
  'all_returns_guards_twice_roundtrip': all(v['raw_return_values'] == [v['length']]*2 and all(v['data_guards_intact']) and v['twice_matches_public_input'] for v in vectors['vectors']),
  'no_thunk': 'ctypes WINFUNCTYPE direct4args; native module path/export RVAs/loaded table SHA and helper RET16 bytes verified.',
  'cleanup': 'Helper creates no SDK object or allocation, only caller-owned guarded Python buffer; fresh child lifetime cleans buffer/module and executes detach. Original heap/loader global init effects are not traced.',
  'loaded_table_sha256': '771a9b8588ec7cb87d033184d71b0025addea173f51bfb957d004a443f513ebf',
  'private_case_file_counts_after_exit': [len(p['private_case_files_after_exit']) for p in processes['processes']],
  'limits': ['DLL attach/detach/dependency initialization execute; private cwd/profile plus owned30s timeout is not OS containment.',
             'No native I/O/network/registry/process trace. Empty private folders after exit do not establish globally absent side effects.',
             'No account/cache/media/client execution; expected comes only from original helper output. Full64 transform does not identify a named format/container or prove playback.']
 },
 'new_pure_module': {
  'files': {name: sha(PLUGIN / name) for name in ['lib/windows/file-transform.mjs','windows-file-transform.test.mjs','test/fixtures/windows-file-transform-native-v1.json']},
  'api': 'transformWindowsFileData(buffer:Uint8Array,unsignedDecimalOffset:string): same buffer object, in place',
  'implementation': 'Reuse transformWindowsData and its sole table owner. Low unsigned domain<=32767 invokes existing helper preserving equality; high positions process remainder chunks ending at32766, never replaying the special low-domain32767; split before uint64 wrap then low-domain call. BigInt only for parsing/initial residue/wrap boundary; numeric old byte loop handles bounded chunks.',
  'validation': 'Reject nonbytes, length>INT32MAX, empty/nondecimal/negative/nonstring offsets and offsets>U64MAX before mutation. Non-digit scan rejects trailing JS-regex end-anchor line terminators; leading zeros accepted as decimal text.',
  'native_fixtures': {'new_full64_vectors':14, 'prior_signed_wrapper_vectors_reused':26,
                      'expected_source': 'Native output bytes copied, not produced by table/port math. Prior wrapper signed int32 is mapped to actual sign-extended unsigned64 helper input.'},
  'testing': {'command':'node --test plugins/qqmusic-provider/windows-file-transform.test.mjs plugins/qqmusic-provider/lib/windows/data-transform.test.mjs',
              'observed_tests':49, 'observed_pass':49, 'observed_fail':0,
              'coverage': 'Original full64 boundaries2^31/2^32/2^53/2^63/uint64wrap, 32800-byte case crossing wrap then32767 strict equality, all26 prior native wrapper vectors, Range-like segmentation, Uint8Array subviews/canaries, invalid-before-mutation.'},
  'scope_preserved': 'No existing module/index/manifest/core/Git changes; only the new module, test and fixture were written to production repository.'
 },
 'footer_crosscheck_existing_evidence': {
  'sources': ['qq-common-media-contract-open.json','qq-common-media-contract-position.json','qq-common-media-contract-read-extend.json','qq-common-media-format-extension.json','qq-common-media-read-analysis.json'],
  'musicex': 'ReadFileExtension reads final16 bytes: LE32 distance at0,LE32version1 at4, exact8byte musicex\\0 at8. It reads176 bytes from EOF-distance. Only distance192 makes this metadata directly precede the tail as canonical176+16. Native does not explicitly enforce distance192 or file bounds; safe proxy can constrain these bounds as adapter policy.',
  'filename': 'Metadata+0x48 is UTF16LE filename with forced NUL at+0xaa:50 UTF16 units including terminator, not50bytes. Additional forced NUL at+0x46. Native validates length>=4 and contains dot through unexpanded string helper.',
  'lookup': 'ReadExtend passes filename-derived CString to GetDownloadEKey→UTF8→SetEkey, sets trailerTrim192. It returns parser AL even if SetEkey false; parser success is not Ekey success and suppresses EOF-key fallback.',
  'fallback': 'Only when ReadExtend false, original Open accepts unsigned LE32 EOF key length L5..1023 ((L-5)<=1018), reads key bytes [EOF-4-L,EOF-4) into zeroed1024byte buffer, feeds KeyDec and sets trailerTrimL+4. It subtracts trim from saved size64 and seeks byte0. Range/file-size bounds and successful key decode are not proven by Open AL alone.',
  'range_start': 'GetCurPosition returns physical OS cursor. Read start=cursor-bytesRead64; no starting header subtraction.192 andL+4 constrain mode2 logical end, not offset origin. These mode2 trailer rules must not be imposed solely by the mode1 transform.',
  'unknowns': 'No real footer/media file, GetDownloadEKey owner, upstream real Ekey response linkage or actual playback examined here. No new REA dossiers or native footer/file execution.'
 },
 'artifact_hashes': {name: sha(WORK / name) for name in ['qq-common-file-transform-oracle-matrix-vectors.json','qq-common-file-transform-oracle-matrix-process.json','qq-common-file-transform-oracle-verification.json','qq-common-file-transform-native-v1.json']},
 'review_status': 'Implementation/tests completed; root independent integration review remains appropriate. Attempted reuse of completed child reviewer was rejected by agent thread limit; no new task/thread created.'
}
out = WORK / 'qq-common-file-transform-findings.json'
out.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'file':str(out),'sha256':sha(out),'native_matrix':14,'tests_pass':49}))
