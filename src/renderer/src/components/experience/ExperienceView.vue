<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import type { InstalledExperience } from '../../../../shared/pluginExperience.ts'
import { createExperienceBridge } from '../../extensions/experienceBridge'
const Console = defineAsyncComponent(() => import('./ExperienceConsole.vue'))
const props = defineProps<{ experience: InstalledExperience }>()
const emit = defineEmits<{ exit: [] }>()
const frame = ref<HTMLIFrameElement>()
const ready = ref(false),
  error = ref(''),
  panel = ref(''),
  tone = ref('day')
let dispose: (() => void) | undefined
let deadline: ReturnType<typeof setTimeout> | undefined
const inertState = new Map<HTMLElement, boolean>()
const api = window.api
function close() {
  emit('exit')
}
function handshake(event: MessageEvent) {
  if (
    event.source !== frame.value?.contentWindow ||
    event.origin !== `plugin-ui://${props.experience.pluginId}`
  )
    return
  if (event.data?.type !== 'twilight-experience-ready') return
  if ((event.data.bridgeVersion ?? 1) !== props.experience.bridgeVersion) { error.value = '界面桥接版本不匹配，请更新插件或宿主。'; return }
  const channel = new MessageChannel()
  dispose?.()
  dispose = createExperienceBridge(props.experience, channel.port1, close, (name) => {
    if (['settings', 'equalizer', 'dsp', 'plugins', 'theme', 'workshop'].includes(name))
      panel.value = name
  })
  event.source?.postMessage(
    { type: 'twilight-experience-connect', bridgeVersion: props.experience.bridgeVersion },
    { targetOrigin: event.origin, transfer: [channel.port2] }
  )
  ready.value = true
  error.value = ''
  clearTimeout(deadline)
}
function frameLoaded() {
  clearTimeout(deadline)
  if (ready.value) return
  deadline = setTimeout(() => {
    if (!ready.value) error.value = '界面未能连接。可以返回 Twilight Echo 后重试。'
  }, 20000)
}
function themeMessage(event: MessageEvent) {
  if (
    event.source === frame.value?.contentWindow &&
    event.origin === `plugin-ui://${props.experience.pluginId}` &&
    event.data?.type === 'twilight-experience-tone'
  )
    tone.value = event.data.tone === 'night' ? 'night' : 'day'
}
onMounted(() => {
  window.addEventListener('message', handshake)
  window.addEventListener('message', themeMessage)
  const shells = document.querySelectorAll<HTMLElement>('.app-shell, .settings-overlay-root')
  shells.forEach((el) => {
    inertState.set(el, el.inert)
    el.inert = true
  })
})
onBeforeUnmount(() => {
  clearTimeout(deadline)
  dispose?.()
  window.removeEventListener('message', handshake)
  window.removeEventListener('message', themeMessage)
  inertState.forEach((inert, el) => {
    el.inert = inert
  })
})
</script>

<template>
  <Teleport to="body">
    <section class="experience-window" :data-tone="tone" :data-bridge="experience.bridgeVersion" aria-label="莱茵生命音乐终端">
      <header class="experience-chrome">
        <button title="返回 Twilight Echo" aria-label="返回 Twilight Echo" @click="close">
          <i class="pi pi-arrow-left" />
        </button>
        <span>{{ experience.name }}</span>
        <div class="experience-drag" />
        <button title="最小化" aria-label="最小化" @click="api.window.minimize()">
          <i class="pi pi-minus" />
        </button>
        <button
          title="最大化 / 还原"
          aria-label="最大化 / 还原"
          @click="api.window.toggleMaximize()"
        >
          <i class="pi pi-window-maximize" />
        </button>
        <button title="关闭窗口" aria-label="关闭窗口" @click="api.window.close()">
          <i class="pi pi-times" />
        </button>
      </header>
      <iframe
        ref="frame"
        :src="experience.url"
        :title="experience.name"
        :inert="!!panel"
        sandbox="allow-scripts allow-same-origin"
        @load="frameLoaded"
      />
      <div v-if="error" class="experience-error" role="alert">
        <p>{{ error }}</p>
        <button @click="close">返回 Twilight Echo</button>
      </div>
      <Console
        v-if="panel"
        :panel="panel"
        :tone="tone"
        :manage-plugins="experience.permissions.includes('plugins:manage')"
        @navigate="panel = $event"
        @close="panel = ''"
      />
    </section>
  </Teleport>
</template>

<style scoped>
.experience-window {
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: #e8e5e1;
  color: #232722;
  display: flex;
  flex-direction: column;
}
.experience-window[data-tone='night'] {
  background: #080f19;
  color: #e8edf2;
}
.experience-chrome {
  height: 30px;
  flex: 0 0 30px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #8883;
  font: 11px var(--te-font-family, sans-serif);
}
.experience-chrome button {
  border: 0;
  color: inherit;
  background: transparent;
  width: 42px;
  height: 30px;
  cursor: pointer;
}
.experience-chrome button:hover {
  background: #8883;
}
.experience-window[data-bridge='2'] .experience-chrome {
  position: absolute;
  inset: 0 0 auto;
  z-index: 2;
  border-bottom: 0;
  background: transparent;
}
.experience-window[data-bridge='2'] .experience-chrome > span {
  display: none;
}
.experience-window[data-bridge='2'] iframe {
  height: 100%;
}
.experience-drag {
  flex: 1;
  height: 30px;
  -webkit-app-region: drag;
}
iframe {
  border: 0;
  width: 100%;
  flex: 1;
  min-height: 0;
}
.experience-error {
  position: absolute;
  inset: 30px 0 0;
  background: inherit;
  display: grid;
  place-content: center;
  gap: 24px;
  padding: 24px;
}
</style>
