<script setup lang="ts">
import { computed, ref } from 'vue'
import { useExtensionRegistry } from '../../extensions/registry'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { startupExperienceKey } from '../../../../shared/pluginExperience.ts'

const { settings, updateSettings, relaunch, restartReasons } = useSettingsStore()
const { uiContributions } = useExtensionRegistry()
const saving = ref(false)
const error = ref('')
const options = computed(() =>
  uiContributions.value.flatMap((page) =>
    page.experience
      ? [
          {
            value: startupExperienceKey({
              pluginId: page.pluginId,
              experienceId: page.experience.id
            }),
            label: page.experience.name,
            selection: { pluginId: page.pluginId, experienceId: page.experience.id }
          }
        ]
      : []
  )
)
const selected = computed(() => startupExperienceKey(settings.value.startupExperience))
const unavailable = computed(
  () => !!selected.value && !options.value.some((option) => option.value === selected.value)
)

async function changeExperience(event: Event): Promise<void> {
  const input = event.target as HTMLSelectElement
  const value = input.value
  input.value = selected.value
  if (saving.value || value === selected.value) return
  const option = options.value.find((entry) => entry.value === value)
  if (value && !option) return
  saving.value = true
  error.value = ''
  try {
    await updateSettings({ startupExperience: option?.selection ?? null })
    if (
      restartReasons.value.includes('完整界面') &&
      window.confirm(
        `已保存完整界面：${option?.label ?? 'Twilight Echo 默认界面'}。重启后生效，当前播放将中断。现在重启吗？取消可稍后重启。`
      )
    ) {
      await relaunch()
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    saving.value = false
    input.value = selected.value
  }
}
</script>

<template>
  <div id="setting-startup-experience" data-setting-id="startup-experience" class="setting-item">
    <div class="setting-copy">
      <strong id="startup-experience-label">完整界面</strong>
      <span v-if="unavailable">所选插件未启用或已移除，启动时将使用默认界面。</span>
      <span v-else-if="!options.length"
        >暂无可用界面，请在插件管理中安装并启用莱茵生命等完整界面插件。</span
      >
      <span v-else>重启后生效。插件主题仅应用于 Twilight Echo 原界面。</span>
      <span v-if="error" role="alert">{{ error }}</span>
    </div>
    <select
      class="preview-select wide"
      aria-labelledby="startup-experience-label"
      :value="selected"
      :disabled="saving"
      @change="changeExperience"
    >
      <option value="">Twilight Echo 默认界面</option>
      <option v-if="unavailable" :value="selected" disabled>所选界面暂不可用</option>
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </div>
</template>
