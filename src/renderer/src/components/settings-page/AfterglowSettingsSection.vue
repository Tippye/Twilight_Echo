<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { describeAfterglowError } from '../../../../shared/afterglowMode.ts'
import type { AfterglowAutoEntry, AfterglowModeStatus } from '../../types/settings'

const { settings, updateSettings } = useSettingsStore()
const status = ref<AfterglowModeStatus | null>(null)
const busy = ref(false)
const message = ref('')

const active = computed(() => status.value?.active === true)
const autoEntry = computed<AfterglowAutoEntry>(() => settings.value.afterglowAutoEntry ?? 'off')
const restoreHint = computed(() =>
  (status.value?.restoreAccelerator ?? 'CommandOrControl+Shift+E').replace(
    'CommandOrControl',
    'Ctrl/⌘'
  )
)

async function refreshStatus(): Promise<void> {
  try {
    status.value = await window.api.app.afterglow.getStatus()
  } catch {
    status.value = null
  }
}

onMounted(() => {
  void refreshStatus()
})

async function enterAfterglow(): Promise<void> {
  busy.value = true
  message.value = ''
  try {
    const next = await window.api.app.afterglow.enter()
    status.value = next
    if (next.active) {
      message.value = `已进入余晖模式。用托盘或 ${next.restoreAccelerator.replace('CommandOrControl', 'Ctrl/⌘')} 恢复界面。`
    } else if (next.error) {
      message.value = `当前播放不满足进入条件：${describeAfterglowError(next.error)}。界面保持常驻。`
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
    void refreshStatus()
  }
}

function setAutoEntry(value: string): void {
  void updateSettings({ afterglowAutoEntry: value as AfterglowAutoEntry })
}
</script>

<template>
  <div class="setting-list">
    <div
      data-setting-id="afterglow-auto-entry"
      id="setting-afterglow-auto-entry"
      class="setting-item"
    >
      <div class="setting-copy">
        <strong>余晖模式（Afterglow）</strong>
        <span>
          界面卸载、内存释放，音乐由原生音频引擎继续播放；托盘、媒体键和系统媒体控制仍可操作。
          恢复快捷键 {{ restoreHint }}（若被占用会改用回退组合）。要求原生输出；本地文件与 CUE
          可完整续播，在线队列由后台按需解析并续接，解析失败/断网时播完已加载窗口后自动恢复界面。
        </span>
        <small v-if="active" class="setting-hint">当前处于余晖模式，界面已卸载。</small>
        <small v-else-if="status?.error && !message" class="setting-hint">
          上次操作未完成：{{ describeAfterglowError(status.error) }}
        </small>
        <small v-if="message" class="setting-hint">{{ message }}</small>
      </div>
      <button
        type="button"
        class="soft-button"
        :disabled="busy || active"
        @click="void enterAfterglow()"
      >
        {{ busy ? '进入中…' : active ? '已卸载界面' : '立即进入' }}
      </button>
    </div>
    <div
      data-setting-id="afterglow-auto-trigger"
      id="setting-afterglow-auto-trigger"
      class="setting-item"
    >
      <div class="setting-copy">
        <strong>自动进入</strong>
        <span>
          在最小化或隐藏到托盘时自动卸载界面。关闭按钮行为为「退出」时不生效；关闭到迷你播放器时也不生效。
        </span>
      </div>
      <select
        class="preview-select"
        :value="autoEntry"
        aria-label="余晖模式自动进入"
        @change="setAutoEntry(($event.target as HTMLSelectElement).value)"
      >
        <option value="off">关闭</option>
        <option value="minimize">仅最小化时</option>
        <option value="hide">仅隐藏到托盘时</option>
        <option value="minimizeOrHide">最小化或隐藏时</option>
      </select>
    </div>
  </div>
</template>
