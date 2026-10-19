const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')

async function checksum(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--installer')) {
    throw new Error('Usage: node scripts/prepare-qqmusic-release.cjs [--installer <path>]')
  }
  const host = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const plugin = JSON.parse(
    await fs.readFile(
      path.join(root, 'integrations/qqmusic/plugins/qqmusic-provider/plugin.json'),
      'utf8'
    )
  )
  const installerName = `${host.name}-${host.version}-setup.exe`
  const installer = args.length ? path.resolve(args[1]) : path.join(root, 'dist', installerName)
  if (path.basename(installer) !== installerName || !(await fs.stat(installer)).isFile()) {
    throw new Error(`Expected installer ${installerName}; build the Windows app first`)
  }
  const packed = spawnSync(
    process.execPath,
    [
      path.join(root, 'integrations/qqmusic/scripts/pack-plugin.cjs'),
      'qqmusic-provider',
      '--twilight-root',
      root
    ],
    { cwd: root, stdio: 'inherit', env: { ...process.env, TWILIGHT_ECHO_ROOT: root } }
  )
  if (packed.error) throw packed.error
  if (packed.status !== 0) throw new Error('QQ Music plugin packaging failed')

  const pluginName = `${plugin.id}-${plugin.version}.tep`
  const output = path.join(root, 'release', `qqmusic-${host.version}`)
  const sources = [installer, path.join(root, 'integrations/qqmusic/packages', pluginName)]
  await fs.mkdir(output, { recursive: true })
  const assets = []
  for (const source of sources) {
    const name = path.basename(source)
    const sha256 = await checksum(source)
    const destination = path.join(output, name)
    await fs.copyFile(source, destination)
    if ((await checksum(destination)) !== sha256)
      throw new Error(`Copy verification failed: ${name}`)
    assets.push({ name, bytes: (await fs.stat(destination)).size, sha256 })
  }
  const manifest = {
    hostVersion: host.version,
    pluginId: plugin.id,
    pluginVersion: plugin.version,
    requiredHost: plugin.engines.twilightEcho,
    assets
  }
  const manifestName = 'release-manifest.json'
  await fs.writeFile(path.join(output, manifestName), `${JSON.stringify(manifest, null, 2)}\n`)
  const checksums = assets.map((asset) => `${asset.sha256}  ${asset.name}`)
  checksums.push(`${await checksum(path.join(output, manifestName))}  ${manifestName}`)
  await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`)
  console.log(`Release assets prepared in ${output}`)
  console.log(
    'Upload the installer, plugin, release-manifest.json and SHA256SUMS.txt to one Release.'
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
