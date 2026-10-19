"""Build the Windows CPU/CUDA inference ZIP below the 2,000,000,000-byte asset limit.

Requires Python 3.11+ and the pinned standalone 7za.exe prepared by
prepare-automix-stem-zip-decoder.cjs. The source pack is never modified.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

LIMIT = 2_000_000_000
CHECKPOINT = 'models/955717e8-8726e21a.th'
CHECKPOINT_SHA256 = '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4'
ALT_NVRTC = 'runtime/Lib/site-packages/torch/lib/nvrtc64_120_0.alt.dll'


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def build(source, staging, output, seven):
    if staging.exists() or output.exists():
        raise ValueError('Staging and output must be new paths')
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    if (manifest['torchVersion'] != '2.8.0+cu128' or
            manifest['checkpointSha256'] != CHECKPOINT_SHA256):
        raise ValueError('This slimming profile requires the validated Torch 2.8/cu128 htdemucs pack')
    inventory = json.loads((source / 'package-files.json').read_text(encoding='utf-8'))
    primary = 'runtime/Lib/site-packages/torch/lib/nvrtc64_120_0.dll'
    if primary not in inventory['files']:
        raise ValueError('The primary NVRTC compiler must be retained')
    pack = staging / 'automix-enhancement'
    pack.mkdir(parents=True)
    for name, expected in inventory['files'].items():
        path = source / name
        if not path.resolve().is_relative_to(source.resolve()):
            raise ValueError('Invalid inventory path')
        if path.stat().st_size != expected['bytes'] or sha256(path) != expected['sha256']:
            raise ValueError(f'Source integrity mismatch: {name}')
        if name == ALT_NVRTC:
            continue
        target = pack / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    # PyTorch's Windows loader and caffe2_nvrtc import the primary filename.
    # The alternate DLL has no PE importers in this pinned runtime. Keep the
    # primary compiler, builtins, JIT linker, every GPU architecture and cuSOLVER.
    inventory['files'].pop(ALT_NVRTC, None)
    manifest.update(packageVersion='2.3', zipCompression='LZMA (ZIP method 14)',
                    minimumStemInstaller='zip-lzma-v1', removedRuntimeComponents=[ALT_NVRTC])
    (pack / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    inventory['files']['manifest.json'] = {
        'bytes': (pack / 'manifest.json').stat().st_size,
        'sha256': sha256(pack / 'manifest.json')}
    (pack / 'package-files.json').write_text(json.dumps(inventory, indent=2) + '\n', encoding='utf-8')
    if sha256(pack / CHECKPOINT) != CHECKPOINT_SHA256:
        raise ValueError('Unexpected model checkpoint')
    files = sorted(path for path in pack.rglob('*') if path.is_file())
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_name(output.name + '.partial.zip')
    if partial.exists():
        raise ValueError('Partial archive already exists')
    for method, selected in (
        ('LZMA', [path for path in files if path.stat().st_size > 1024 ** 2]),
        ('Deflate', [path for path in files if path.stat().st_size <= 1024 ** 2])
    ):
        listing = staging / f'{method}.txt'
        listing.write_text('\n'.join(path.relative_to(staging).as_posix() for path in selected) + '\n',
                           encoding='utf-8')
        command = [str(seven), 'a', '-tzip', f'-mm={method}', '-mx=7' if method == 'LZMA' else '-mx=9',
                   '-mmt=2', '-scsUTF-8', '-bsp0']
        if method == 'LZMA':
            command.append('-md=64m')
        subprocess.run(command + [str(partial), '@' + str(listing)], cwd=staging, check=True)
    return verify_and_publish(pack, partial, output, seven)


def verify_and_publish(pack, partial, output, seven):
    inventory = json.loads((pack / 'package-files.json').read_text(encoding='utf-8'))
    files = sorted(path for path in pack.rglob('*') if path.is_file())
    if partial.stat().st_size >= LIMIT:
        raise ValueError(f'ZIP exceeds the strict release asset limit: {partial.stat().st_size}')
    subprocess.run([str(seven), 't', '-bsp0', str(partial)], check=True)
    expected_files = {**inventory['files'], 'package-files.json': {
        'bytes': (pack / 'package-files.json').stat().st_size,
        'sha256': sha256(pack / 'package-files.json')}}
    methods = {}
    with zipfile.ZipFile(partial) as archive:
        if {entry.filename for entry in archive.infolist()} != {
                'automix-enhancement/' + name for name in expected_files}:
            raise ValueError('Archive entries differ from the staged inventory')
        for entry in archive.infolist():
            name = entry.filename.removeprefix('automix-enhancement/')
            if entry.compress_type not in (0, 8, 14):
                raise ValueError('Unexpected ZIP compression method')
            methods[str(entry.compress_type)] = methods.get(str(entry.compress_type), 0) + 1
            with archive.open(entry) as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            expected = expected_files[name]
            if entry.file_size != expected['bytes'] or digest != expected['sha256']:
                raise ValueError(f'ZIP integrity mismatch: {name}')
    partial.rename(output)
    report = {'archive': output.name, 'bytes': output.stat().st_size, 'limitBytes': LIMIT,
              'sha256': sha256(output), 'files': len(files),
              'unpackedBytes': sum(path.stat().st_size for path in files),
              'compressionMethods': methods, 'removedRuntimeComponents': [ALT_NVRTC],
              'modelSha256': CHECKPOINT_SHA256, 'cpuAndCudaRetained': True,
              'minimumStemInstaller': 'zip-lzma-v1'}
    output.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    output.with_suffix(output.suffix + '.sha256').write_text(
        f'{report["sha256"]}  {output.name}\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--stage', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seven', type=Path, default=Path(__file__).resolve().parent.parent /
                        'resources/automix-stems/7za.exe')
    args = parser.parse_args()
    print(json.dumps(build(args.source.resolve(), args.stage.resolve(), args.output.resolve(),
                           args.seven.resolve()), indent=2))
