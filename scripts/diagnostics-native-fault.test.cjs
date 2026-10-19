const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { createServer } = require('node:http')

test('native journal keeps sampling when synchronous control/RPC is blocked; service termination leaves evidence', async (t) => {
  const addon = path.resolve(
    process.env.TAE_AUDIO_NODE ||
      'node_modules/.cache/diagnostics-final/native/twilight_audio_node.node'
  )
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'twilight-native-fault-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const { configureDiagnosticLogger } = await import('../src/main/diagnostics/logger.ts')
  const { observeUtilityProcess } = await import('../src/main/diagnostics/utilityObservation.ts')
  const events = []
  configureDiagnosticLogger({}, (event) => events.push(event))
  const server = createServer(() => {}) // Deliberately never send response headers.
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const audio = require(process.argv[1]);
    process.on('message', message => {
      if (message.kind !== 'request') return;
      audio.SetDiagnosticContext(JSON.stringify(message.diagnosticContext));
      try { audio.Play(message.args[0], 0); process.send({kind:'response', requestId:message.requestId, ok:true}); }
      catch (error) { process.send({kind:'response', requestId:message.requestId, ok:false, error:String(error)}); }
    });
    process.send({kind:'ready'});
  `,
      addon
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        TAE_DIAGNOSTICS_DIR: directory,
        TWILIGHT_LOG_SESSION_ID: 'native-fault',
        TAE_SERVICE_GENERATION: '19',
        PATH: `${path.dirname(addon)};${process.env.PATH}`
      }
    }
  )
  t.after(() => {
    if (child.exitCode === null && !child.killed) child.kill()
  })
  observeUtilityProcess(child, 'native-fault')
  await new Promise((resolve, reject) => {
    child.on('message', (message) => {
      if (message.kind === 'ready') resolve()
    })
    child.on('error', reject)
    child.on('exit', (code) => reject(new Error(`early exit ${code}`)))
  })
  child.send({
    kind: 'request',
    requestId: 'blocked-request',
    method: 'Play',
    args: [`http://127.0.0.1:${server.address().port}/blocked?token=secret`]
  })
  await new Promise((resolve) => setTimeout(resolve, 4200))
  const native = []
  for (const name of await fs.readdir(directory))
    for (const line of (await fs.readFile(path.join(directory, name), 'utf8')).trim().split('\n'))
      native.push(JSON.parse(line))
  const health = native.filter((event) => event.event === 'health.sample')
  assert.ok(health.length >= 4, `only ${health.length} health samples`)
  assert.ok(health.every((event) => event.serviceGeneration === 19))
  assert.ok(health.at(-1).details.clockAgeMs > 2000)
  assert.equal(typeof health.at(-1).details.streamToken, 'number')
  assert.ok(!JSON.stringify(native).includes('token=secret'))
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  await exited
  assert.ok(
    events.some(
      (event) =>
        event.event === 'utility.exit' &&
        event.details.unfinished.some((item) => item.requestId === 'blocked-request')
    )
  )
})
