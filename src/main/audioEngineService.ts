import { initializeUtilityDiagnostics } from './diagnostics/utility.ts'
import { observeDiagnosticOperation } from './diagnostics/observation.ts'
import { writeDiagnostic } from './diagnostics/logger.ts'
import type { DiagnosticContext } from '../shared/diagnostics.ts'
import {
  describeNativeBindingFailure,
  loadNativeBindingWithDiagnostics
} from './audio/nativeBinding.ts'
import type { NativeAudioBinding } from './audio/audioEngineTypes.ts'
import {
  createAudioServiceCapabilities,
  REQUIRED_AUDIO_SERVICE_DSP_METHODS,
  type AudioServiceCapabilities
} from '../shared/audioServiceContract.ts'

type AudioServiceRequest = {
  diagnosticContext?: DiagnosticContext
  kind: 'request'
  requestId: string
  method: keyof NativeAudioBinding
  args: unknown[]
}

type AudioServiceMessage = AudioServiceRequest | { kind: 'ping'; requestId: string }

type AudioServiceResponse = {
  kind: 'response'
  requestId: string
  ok: boolean
  value?: unknown
  error?: string
}

type ParentPort = {
  postMessage: (
    message:
      | AudioServiceResponse
      | { kind: 'pong'; requestId: string }
      | { kind: 'ready'; capabilities: AudioServiceCapabilities }
      | { kind: 'fatal'; error: string }
  ) => void
  on: (event: 'message', listener: (message: AudioServiceMessage) => void) => void
}

type ElectronParentPort = {
  postMessage: ParentPort['postMessage']
  on: (event: 'message', listener: (event: { data: AudioServiceMessage }) => void) => void
}

type NodeIpcProcess = {
  send?: ParentPort['postMessage']
  on?: (event: 'message', listener: (message: AudioServiceMessage) => void) => void
}

const maybeElectronParentPort = (process as unknown as { parentPort?: ElectronParentPort })
  .parentPort
const maybeNodeIpc = process as unknown as NodeIpcProcess
const parentPort: ParentPort | null = maybeElectronParentPort
  ? {
      postMessage: (message) => maybeElectronParentPort.postMessage(message),
      on: (_event, listener) =>
        maybeElectronParentPort.on('message', (event) => listener(event.data))
    }
  : typeof maybeNodeIpc.send === 'function' && typeof maybeNodeIpc.on === 'function'
    ? {
        postMessage: (message) => {
          maybeNodeIpc.send?.(message)
        },
        on: (_event, listener) => maybeNodeIpc.on?.('message', listener)
      }
    : null

if (!parentPort) {
  throw new Error('Twilight audio engine service must run with Electron parentPort or Node IPC')
}

const servicePort = parentPort
initializeUtilityDiagnostics('twilight-audio-engine')
const nativeLoad = loadNativeBindingWithDiagnostics()
const native = nativeLoad.binding
const nativeMethods = native
  ? Object.getOwnPropertyNames(native).filter(
      (method) => typeof native[method as keyof NativeAudioBinding] === 'function'
    )
  : []
const missingDspMethods = REQUIRED_AUDIO_SERVICE_DSP_METHODS.filter(
  (method) => typeof native?.[method] !== 'function'
)
const nativeContractError = !native
  ? describeNativeBindingFailure(nativeLoad)
  : missingDspMethods.length > 0
    ? `native audio binding is missing required DSP methods: ${missingDspMethods.join(', ')}`
    : ''

if (nativeContractError) {
  servicePort.postMessage({ kind: 'fatal', error: nativeContractError })
} else {
  servicePort.postMessage({
    kind: 'ready',
    capabilities: {
      ...createAudioServiceCapabilities(nativeMethods),
      nativeRuntime: nativeLoad.runtime
    }
  })
}

servicePort.on('message', (message) => {
  if (message.kind === 'ping') {
    servicePort.postMessage({ kind: 'pong', requestId: message.requestId })
    return
  }
  if (message.kind !== 'request') return
  void observeDiagnosticOperation(
    'audio.native',
    String(message.method),
    () => handleRequest(message),
    message.args,
    { ...message.diagnosticContext, requestId: message.requestId }
  )
})

async function handleRequest(message: AudioServiceRequest): Promise<void> {
  if (!native || nativeContractError) {
    writeDiagnostic('audio.native', 'binding.unavailable', { error: nativeContractError }, 'error')
    post({
      kind: 'response',
      requestId: message.requestId,
      ok: false,
      error: nativeContractError || '未加载 twilight_audio_node.node'
    })
    return
  }
  try {
    ;(
      native as NativeAudioBinding & { SetDiagnosticContext?: (json: string) => void }
    ).SetDiagnosticContext?.(
      JSON.stringify({ ...message.diagnosticContext, requestId: message.requestId })
    )
    if (
      message.method === 'AnalyzeBpm' ||
      message.method === 'AnalyzeLoudness' ||
      message.method === 'AnalyzeAutoMix'
    ) {
      throw new Error(`${String(message.method)} must use the isolated audio analysis service`)
    }
    const method = native[message.method]
    if (typeof method !== 'function') {
      throw new Error(`原生音频服务不支持方法：${String(message.method)}`)
    }
    const value = (method as (...args: unknown[]) => unknown)(...message.args)
    post({ kind: 'response', requestId: message.requestId, ok: true, value })
  } catch (error) {
    writeDiagnostic('audio.native', 'call.failed', { method: message.method, error }, 'error')
    post({
      kind: 'response',
      requestId: message.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    ;(
      native as NativeAudioBinding & { SetDiagnosticContext?: (json: string) => void }
    ).SetDiagnosticContext?.('{}')
  }
}

function post(message: AudioServiceResponse): void {
  servicePort.postMessage(message)
}
