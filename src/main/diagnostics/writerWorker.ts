import { parentPort, workerData } from 'node:worker_threads'
import { DiagnosticStore } from './store.ts'

const store = new DiagnosticStore(workerData)
const port = parentPort!
let chain = store.initialize()
let failure: string | null = null
chain.then(
  () => port.postMessage({ kind: 'ready' }),
  (error) => {
    failure = String(error)
    port.postMessage({ kind: 'ready', error: failure })
  }
)
port.on('message', (message) => {
  chain = chain
    .catch(() => undefined)
    .then(async () => {
      const { id, kind } = message
      try {
        if (kind === 'write') {
          if (failure) await store.initialize()
          await store.append(message.lines)
          failure = null
          port.postMessage({ kind: 'ack', id, lastWriteAt: store.lastWriteAt })
          return
        }
        let value: unknown
        if (kind === 'status') value = { ...(await store.status()), error: failure }
        else if (kind === 'snapshot') value = await store.snapshot(message.destination)
        else if (kind === 'clear') {
          await store.clearHistory()
          value = await store.status()
        } else if (kind === 'flush') await store.flush()
        else throw new Error('Unknown diagnostic writer request')
        port.postMessage({ kind: 'result', id, value })
      } catch (error) {
        failure =
          error instanceof Error
            ? `${(error as NodeJS.ErrnoException).code ?? 'WRITE_FAILED'}: ${error.message}`
            : String(error)
        port.postMessage({ kind: 'failure', id, error: failure })
      }
    })
})
setInterval(() => {
  chain = chain
    .catch(() => undefined)
    .then(() => store.prune())
    .catch((error) => {
      failure = String(error)
      port.postMessage({ kind: 'failure', error: failure })
    })
}, 60000).unref()
