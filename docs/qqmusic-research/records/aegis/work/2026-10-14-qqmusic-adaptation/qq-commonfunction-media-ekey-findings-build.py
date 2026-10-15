"""Save bounded static Ekey evidence and prepared-oracle state; no DLL execution."""
import hashlib
import json
from pathlib import Path
WORK = Path(__file__).resolve().parent
def sha(name):
    return hashlib.sha256((WORK / name).read_bytes()).hexdigest()
name = 'qq-commonfunction-media-ekey-base64.json'
d = json.loads((WORK / name).read_text())
n = d['data']['normalized_result']
assert d['data']['subject']['digest']['sha256'] == 'a28ebdd9eda2d3dfbfc540578681bc71425136858e29bc07a22ead142510187d'
assert n['procedure']['address'] == '0x10001370' and n['procedure']['body']['total_bytes'] == 306
assert not n['native_value_flow']['truncated'] and n['native_value_flow']['omitted_operations_lower_bound'] == 0
source = {'schema': 'qq-commonfunction-media-ekey-bounded-source-v1', 'evidence_id': d['data']['evidence_id'],
          'target_sha256': d['data']['subject']['digest']['sha256'], 'procedure': n['procedure'],
          'pseudocode': n['pseudocode'], 'assembly': n['assembly'], 'callees': n['callees'],
          'limitations': n['limitations']}
(WORK / 'qq-commonfunction-media-ekey-source.json').write_text(json.dumps(source, indent=2) + '\n', encoding='utf-8')
record = {
 'schema': 'qq-commonfunction-media-ekey-static-preparation-findings-v1',
 'scope': 'One new decoder dossier, reuse of same-hash seed conversion/derive/TEA evidence, bounded PE ABI sidecar and prepared public oracle. No DLL execution in this slice.',
 'target': r'E:\Program Files (x86)\QQMusic\QQMusic2271.18.09.14\CommonFunction.dll',
 'target_sha256': d['data']['subject']['digest']['sha256'],
 'new_dossier': {'address': '0x10001370', 'evidence_id': d['data']['evidence_id'], 'body_bytes': 306,
                 'file': name, 'sha256': sha(name), 'stderr_bytes': (WORK / 'qq-commonfunction-media-ekey-base64.stderr.log').stat().st_size,
                 'cli_exit': 0, 'native_value_flow_truncated': False, 'omitted_operations_lower_bound': 0},
 'normalized_source': {'file': 'qq-commonfunction-media-ekey-source.json', 'sha256': sha('qq-commonfunction-media-ekey-source.json')},
 'observations': [
  {'addresses': ['0x10001380','0x10001388','0x10001491','0x100014a1'],
   'statement': 'Base64 decoder takes ECX destination, EDX source and plain RET. It scans byte-table values until >=64, decodes groups and residual sextets, writes a terminating NUL at the output cursor. It has no length/capacity parameter or explicit invalid-input rejection. Canonical input alphabet/padding mapping verified from all256 actual table bytes.'},
  {'address': '0x1000cab1', 'statement': 'Actual15-byte dispatcher MOV ECX1, MOVSD XMM5[EBA8], JMP CADC. Same recovered CADC core param1=1 uses signed64 domain and returns finite truncation toward zero; this selects the correct seed conversion rather than CAC0 unsigned stream conversion.'},
  {'addresses': ['0x100055d5','0x10005614','0x10005627','0x1000563f'],
   'statement': 'Full original seed path and interleave confirmed: nonnegative i0..7→SSE double plus0→multiply0.1→add106→native _libm_sse2_tan_precise→absolute mask→multiply100→CAB1 signed64→AL. These seed bytes occupy assembled key even positions; decoded first8 occupy odd positions.'},
  {'addresses': ['0x100054b8','0x100054f3','0x10005548','0x1000557a','0x100055b0'],
   'statement': 'V2 inverse uses derived words1 key then words2 key, then Base64-decodes the inner text. Forward input order is originala45a(V1 Base64 ASCII,words2), then originala45a(result,words1), then marker at offset0 and canonical Base64. Marker search is strstr but actual payload offset remains decoded+18.'},
  {'addresses': ['0x100017e0','0x10005380','0x1000bd0c','0x1000bab0'],
   'statement': 'Ord9 releases only native factory KeyDec: passes this ECX/flag1 through vtable+4; destructor frees native+4 then sized delete12, RET4. Original derived keys use matching target CRT free IAT. Python buffers are never passed to native free.'}
 ],
 'derived_decoder_length': 'For nonnegative small scanned sextet count n, return reduces to floor(3*n/4). Count mod4=1 produces no residual byte and no strict canonical rejection. Valid canonical input only is planned; this inference is not a runtime malformed-input oracle.',
 'prepared_oracle': {
  'script': 'qq-commonfunction-media-ekey-oracle.py', 'script_sha256': sha('qq-commonfunction-media-ekey-oracle.py'),
  'runner': 'qq-commonfunction-media-ekey-oracle.ps1', 'runner_sha256': sha('qq-commonfunction-media-ekey-oracle.ps1'),
  'default_describe_exit': 0, 'runner_parse_only': 'passed', 'not_executed': True,
  'case_count': 6, 'cases': 'Public N16/301/512, each valid native-forward-generated V1/V2; no short/malformed Ekey.',
  'input_generation': 'Original full seed path and derive9f40/a45a; each layer originala695 preflight must return1 and reproduce plaintext before KeyDec. Base64 generation is Python canonical encoding of owned bytes, not an expected-output implementation.',
  'expected_independence': 'Fixed public internal key chosen before native calls. Original KeyDec output bytes captured independently twice. No JS/provider/original oracle expectations imported.',
  'guards': 'Encoded input including NUL and all caller-owned native primitive input/output buffers have canaries. Native decoder pointer/length checked exact known public key length before read. Own thunk memory readback recorded before RX.',
  'planned_command_smoke': r'pwsh -NoProfile -File E:\PycharmProjects\MusicAnyClient\docs\aegis\work\2026-10-14-qqmusic-adaptation\qq-commonfunction-media-ekey-oracle.ps1 -RunLabel smoke -CaseIds 0',
  'planned_command_matrix_after_smoke': r'pwsh -NoProfile -File E:\PycharmProjects\MusicAnyClient\docs\aegis\work\2026-10-14-qqmusic-adaptation\qq-commonfunction-media-ekey-oracle.ps1 -RunLabel matrix',
  'runtime_outputs_when_executed': ['qq-commonfunction-media-ekey-oracle-smoke-process.json','qq-commonfunction-media-ekey-oracle-smoke-vectors.json','qq-commonfunction-media-ekey-oracle-matrix-process.json','qq-commonfunction-media-ekey-oracle-matrix-vectors.json'],
  'child_boundary': 'Fresh x86 child per case, hidden window, private cwd/profile/TEMP,30s owned-tree timeout, refuse evidence overwrite. Original attach/detach execute; no OS containment/side-effect trace assertion.'
 },
 'independent_review': {'forward_plan_report': 'qq-commonfunction-media-ekey-forward-review.json',
                         'harness_report': 'qq-commonfunction-media-ekey-harness-review.json',
                         'status': 'Fresh corrected harness source SHA643497cab011e1b4bc174b483b2e167982f0949b05ad090698bda6e30920f1cc independently reviewed without execution. No remaining static ABI/length/ownership blocker; actual runtime is still unexecuted.'},
 'preparation_failures': [
  'Initial decoder JSON read occurred while CLI stdout remained empty; read raised JSONDecodeError. Waited actual process completion, then valid complete dossier parsed; CLI exit0/stderr0.',
  'Own PE destructor assertion first used56bytes and failed before DLL load/output. Actual body58 corrected; evidence preserves this failure.',
  'Independent review caught initial six-arg CIPHER thunk one-stack-slot error (+20/+1c/+18 instead of +1c/+18/+14). Corrected before any native execution. Current six-arg bridge verified fresh by follow-up review.',
  'Independent review corrected seed capture label by expanding63 to67bytes so MOV AL at5614 is actually included.'
 ],
 'unknowns': ['No actual native seed output or valid KeyDec success captured yet.',
              'No malformed/base64 truncation, out-of-range Ekey, allocator failure, original private cache/media or account invocation.',
              'Native KeyDec unsafe arbitrary input/failure semantics are not recommended adapter behavior.',
              'Real GetEVkey Ekey response ownership, container boundaries and modern format/media playback still unproven by this slice.']
}
out = WORK / 'qq-commonfunction-media-ekey-findings.json'
out.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'findings': str(out), 'sha256': sha(out.name), 'not_executed': True}))
