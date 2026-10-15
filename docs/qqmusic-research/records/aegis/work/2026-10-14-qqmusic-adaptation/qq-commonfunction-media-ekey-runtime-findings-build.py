"""Record actual controlled execution and its limits; no new native execution."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
WORK = Path(__file__).resolve().parent
def sha(name):
    return hashlib.sha256((WORK / name).read_bytes()).hexdigest()
def load(name):
    return json.loads((WORK / name).read_text(encoding='utf-8-sig'))
vectors = load('qq-commonfunction-media-ekey-oracle-matrix-vectors.json')
processes = load('qq-commonfunction-media-ekey-oracle-matrix-process.json')
assert vectors['all_children_succeeded'] and vectors['case_count'] == 6
assert all(p['exit_code'] == 0 and not p['timed_out'] and p['stderr_bytes'] == 0 for p in processes['processes'])
result = {
 'schema': 'qq-commonfunction-media-ekey-controlled-runtime-findings-v1',
 'recorded_at_utc': datetime.now(timezone.utc).isoformat(),
 'target': r'E:\Program Files (x86)\QQMusic\QQMusic2271.18.09.14\CommonFunction.dll',
 'original_dll_sha256': 'a28ebdd9eda2d3dfbfc540578681bc71425136858e29bc07a22ead142510187d',
 'authority': 'User-approved Windows adaptation route1 and original-DLL fixed-public-input oracle; root technical ABI/ownership review authorized this smoke then matrix execution.',
 'executed_commands': [
  r"pwsh -NoProfile -File 'E:\PycharmProjects\MusicAnyClient\docs\aegis\work\2026-10-14-qqmusic-adaptation\qq-commonfunction-media-ekey-oracle.ps1' -RunLabel smoke -CaseIds 0",
  r"pwsh -NoProfile -File 'E:\PycharmProjects\MusicAnyClient\docs\aegis\work\2026-10-14-qqmusic-adaptation\qq-commonfunction-media-ekey-oracle.ps1' -RunLabel matrix"
 ],
 'script': {'file': 'qq-commonfunction-media-ekey-oracle.py', 'sha256': sha('qq-commonfunction-media-ekey-oracle.py')},
 'runner': {'file': 'qq-commonfunction-media-ekey-oracle.ps1', 'sha256': sha('qq-commonfunction-media-ekey-oracle.ps1')},
 'technical_preflight_review': {'file': 'qq-commonfunction-media-ekey-harness-review.json', 'sha256': sha('qq-commonfunction-media-ekey-harness-review.json'),
                               'note': 'Initial stack-slot/span mistakes corrected before any target execution; historical preparation failures preserved in static findings.'},
 'native_evidence': {
  'smoke': 'Case0 succeeded, then independent raw check confirmed native inverse status1, matching positive lengths/public plaintext, guards, two KeyDec exact public key results, release and before/after artifact hash before matrix execution.',
  'matrix': 'Six fresh hidden x86 Python children N16/301/512 × V1/V2. All exit0, stderr0, no30s timeout; every positive native cipher inverse preflight/canary check and two native KeyDec checks passed; original SDK release and matching CRT free returned.',
  'seed_signed64': vectors['vectors'][0]['native_seed_values_signed64'],
  'seed8_hex': vectors['vectors'][0]['native_seed_hex'],
  'v2_derived_native_keys_hex_words1_words2': vectors['vectors'][1]['derived_v2_keys_hex'],
  'static_derivation_equality': True,
  'hash_before_after': 'Original absolute-path target SHA256 matched before and after all six case calls.',
  'encoded_sizes_ascii': [len(bytes.fromhex(row['encoded_ekey_hex'])) for row in vectors['vectors']],
  'key_lengths': [row['public_key_length'] for row in vectors['vectors']],
  'floating_controls': [{'case_id': row['case_id'], 'before': row['floating_controls_before'], 'after': row['floating_controls_after']} for row in vectors['vectors']],
  'private_case_files_after_exit': [len(row['private_case_files_after_exit']) for row in processes['processes']],
  'expected_independence': 'Input plaintext is fixed public key chosen before native calls. Cipher/framing forward generation and inverse preflight use original DLL primitives only. Fixture expected bytes are copied from original KeyDec first output, not calculated from a port/table.'
 },
 'artifacts': {name: sha(name) for name in [
  'qq-commonfunction-media-ekey-oracle-smoke-process.json', 'qq-commonfunction-media-ekey-oracle-smoke-vectors.json',
  'qq-commonfunction-media-ekey-oracle-matrix-process.json', 'qq-commonfunction-media-ekey-oracle-matrix-vectors.json',
  'qq-commonfunction-media-ekey-native-v1.json', 'qq-commonfunction-media-ekey-oracle-verification.json',
  'qq-commonfunction-media-ekey-abi-pe.json', 'qq-commonfunction-media-ekey-base64.json']},
 'raw_captures': 'qq-commonfunction-media-ekey-oracle-runtime-smoke/case-00.stdout.jsonl and runtime-matrix/case-00..05.stdout.jsonl, corresponding stderr files and per-child complete commands/paths/module inventory/phase records preserved. Process metadata records raw SHA256.',
 'fixture_schema': {'schema': 'qq-commonfunction-media-ekey-native-fixture-v1',
                    'file': 'qq-commonfunction-media-ekey-native-v1.json',
                    'vector_fields': ['case_id','version','key_length','encoded_ekey_hex','internal_key_hex'],
                    'top_level_provenance': ['authority','source_file','source_sha256','original_dll_sha256','native_seed_signed64','native_seed_hex','static_and_native_v2_keys_hex']},
 'observations_vs_inference': {
  'observed': 'The original KeyDec decodes these six original-generated well-formed public V1/V2 Ekeys to the chosen internal key; seed bytes and V2 keys come from original code. Native Base64 decoder writes correct owned raw bytes/NUL on these cases.',
  'supported_inference': 'A bounded pure V1/V2 decoder using the recovered seed, key derivation, Base64 and TEA inverse has an independent native-output oracle for these tested cases.',
  'unknown': 'Real response Ekey ownership, GetDownloadEKey linkage, named format/container boundaries, actual authorized media data and player decode/playback remain outside this experiment.'
 },
 'runtime_limits': [
  'Original DLL initialization and process detach inevitably execute. Public calls/owned buffer bounds/timeout limit requested work; no native OS containment is provided.',
  'No OS I/O, registry, network or child-process trace collected. Empty private profile/cwd folders after exit do not prove absence of side effects elsewhere.',
  'Module inventory interval includes Python/psapi imports; loaded-module differences do not attribute every module solely to target.',
  'Only fixed bounded original-generated positive V1/V2 inputs. No malformed, short, private Ekey, account, cache, real media, or QQ executable was used.',
  'Native KeyDec failure/allocator/corrupt-input contracts are not established by valid success cases; a safe port should reject failed framing before exposing output.',
  'No production or Git changes. Prior stream V1 script/vectors remain SHA-pinned unchanged.'
 ]
}
out = WORK / 'qq-commonfunction-media-ekey-runtime-findings.json'
out.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'file': str(out), 'sha256': sha(out.name), 'cases': 6, 'encoded_sizes_ascii': result['native_evidence']['encoded_sizes_ascii']}))
