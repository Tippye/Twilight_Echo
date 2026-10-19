import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { effectScope, nextTick, reactive, ref, watch } from 'vue'

const source = readFileSync(new URL('./StreamingPage.vue', import.meta.url), 'utf8')
const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)![1]
const ast = ts.createSourceFile('page.ts', script, ts.ScriptTarget.Latest, true)
const recoveryNodes = ast.statements.filter(
  (node) =>
    (ts.isFunctionDeclaration(node) &&
      ['refreshStreamingSurface', 'playbackNavigationPending'].includes(node.name?.text ?? '')) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ['lastMetadataNavigationKey', 'playbackNavigationInFlight'].includes(declaration.name.getText(ast))
    )) ||
    (ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(ast) === 'watch' &&
      ['ncmNavigationAvailable', '() => props.active'].includes(
        node.expression.arguments[0]?.getText(ast)
      ))
)
const code = ts.transpileModule(recoveryNodes.map((node) => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText

function fixture(t: { after: (fn: () => void) => void }) {
  const calls: string[] = []
  const ncmNavigationAvailable = ref(false)
  const activeProvider = ref('ncm')
  const props = reactive({
    active: true,
    metadataNavigationRequest: null as { key: number } | null
  })
  const bindings = {
    watch,
    ncmNavigationAvailable,
    activeProvider,
    props,
    NCM_PROVIDER_ID: 'ncm',
    activeTab: ref('library'),
    checkLogin: async () => {
      calls.push('login')
    },
    ensureLibraryLoaded: async () => {
      calls.push('library')
    },
    refreshExternalProviderState: async () => {
      calls.push('external')
    },
    loadRecommendations: async () => {
      calls.push('home')
    },
    discovery: {
      ensureLoaded: async () => {
        calls.push('discovery')
      }
    },
    isLoggedIn: ref(true),
    cloudSongs: ref([]),
    refreshCloudSongs: async () => {
      calls.push('cloud')
    }
  }
  const scope = effectScope()
  scope.run(() => runInNewContext(code, bindings))
  t.after(() => scope.stop())
  return { calls, ncmNavigationAvailable, activeProvider, props }
}

async function flush() {
  await nextTick()
  await new Promise<void>((done) => setImmediate(done))
}

test('late NCM registration restores the visible library without leaving the page', async (t) => {
  const f = fixture(t)
  f.ncmNavigationAvailable.value = true
  await flush()
  assert.deepEqual(f.calls, ['login', 'library'])
  f.ncmNavigationAvailable.value = false
  await flush()
  assert.deepEqual(f.calls, ['login', 'library'], 'disabling must not wake the plugin')
  f.ncmNavigationAvailable.value = true
  await flush()
  assert.deepEqual(f.calls, ['login', 'library', 'login', 'library'])
})

test('registration on an inactive page defers recovery until the user opens it', async (t) => {
  const f = fixture(t)
  f.props.active = false
  await flush()
  f.ncmNavigationAvailable.value = true
  await flush()
  assert.deepEqual(f.calls, [])
  f.props.active = true
  await flush()
  assert.deepEqual(f.calls, ['login', 'library'])
})

test('NCM registration leaves the selected external provider alone', async (t) => {
  const f = fixture(t)
  f.activeProvider.value = 'bili'
  f.ncmNavigationAvailable.value = true
  await flush()
  assert.deepEqual(f.calls, [])
})

function personalizedRefillFixture(t: { after: (fn: () => void) => void }) {
  const nodes = ast.statements.filter(
    (node) =>
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(ast) === 'watch' &&
      node.expression.arguments[0]?.getText(ast).includes('personalizedStreamRemaining')
  )
  assert.equal(nodes.length, 1)
  const code = ts.transpileModule(nodes[0].getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  const queue = ref(Array.from({ length: 10 }, (_, index) => ({ queueEntryId: `entry:${index}` })))
  const queueIndex = ref(0)
  const currentTrack = ref(queue.value[0])
  const personalizedStreamSession = ref<{ id: number; key: 'fm' | 'radar' } | null>(null)
  const personalizedStreamRemaining = ref(10)
  const personalizedStreamLoading = reactive({ fm: false, radar: false })
  const calls: Array<{ key: string; id: number }> = []
  const scope = effectScope()
  scope.run(() =>
    runInNewContext(code, {
      watch,
      currentTrack,
      personalizedStreamSession,
      personalizedStreamRemaining,
      personalizedStreamLoading,
      playbackStore: { queue, queueIndex },
      loadMorePersonalizedStream: (key: 'fm' | 'radar', session: { id: number }) => {
        calls.push({ key, id: session.id })
        personalizedStreamLoading[key] = true
      }
    })
  )
  t.after(() => scope.stop())
  return {
    queue,
    queueIndex,
    session: personalizedStreamSession,
    remaining: personalizedStreamRemaining,
    loading: personalizedStreamLoading,
    calls,
    setIndex: (index: number) => {
      queueIndex.value = index
      currentTrack.value = queue.value[index]
    }
  }
}

for (const key of ['fm', 'radar'] as const) {
  test(`${key} refills at the queue tail even after replaying previously played tracks`, async (t) => {
    const f = personalizedRefillFixture(t)
    f.session.value = { id: 1, key }
    f.remaining.value = 0
    await flush()
    assert.deepEqual(f.calls, [], 'an exhausted unplayed count must not refill a long queue')
    f.setIndex(6)
    await flush()
    assert.deepEqual(f.calls, [], 'four entries including the current track are above the limit')
    f.setIndex(7)
    await flush()
    assert.deepEqual(f.calls, [{ key, id: 1 }])
    f.setIndex(8)
    await flush()
    assert.equal(f.calls.length, 1, 'an active refill must prevent concurrent requests')
    f.queue.value.push(...[10, 11, 12].map((index) => ({ queueEntryId: `entry:${index}` })))
    f.remaining.value = 3
    f.loading[key] = false
    await flush()
    assert.equal(f.calls.length, 1, 'new queue entries restore enough playback runway')
    f.setIndex(10)
    await flush()
    assert.deepEqual(f.calls, [
      { key, id: 1 },
      { key, id: 1 }
    ])
  })
}

test('personalized refill ignores an invalid queue index and a completed session', async (t) => {
  const f = personalizedRefillFixture(t)
  f.queueIndex.value = -1
  f.session.value = { id: 1, key: 'fm' }
  f.remaining.value = 0
  await flush()
  assert.deepEqual(f.calls, [])
  f.session.value = null
  f.setIndex(9)
  await flush()
  assert.deepEqual(f.calls, [])
})

test('late provider registration does not refresh the root while playback metadata navigation is pending', async (t) => {
  const f = fixture(t)
  f.props.metadataNavigationRequest = { key: 1 }
  f.ncmNavigationAvailable.value = true
  await flush()
  assert.deepEqual(f.calls, [])
  f.props.metadataNavigationRequest = null
  f.props.active = false
  await flush()
  f.props.active = true
  await flush()
  assert.deepEqual(f.calls, ['login', 'library'])
})
