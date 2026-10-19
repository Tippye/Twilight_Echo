<script setup lang="ts">
import { appearanceEditorOpen, appearanceEditorArea } from '../composables/appearanceEditorState.ts'
import { useBackgroundAppearanceEditor } from '../composables/useBackgroundAppearanceEditor.ts'
import CardAppearanceSettings from './settings-page/CardAppearanceSettings.vue'
import LiquidGlassSettings from './settings-page/LiquidGlassSettings.vue'
import EditableRangeValue from './EditableRangeValue.vue'
const {
  state,
  dialogRef,
  bodyRef,
  fileInput,
  target,
  previewPage,
  tone,
  importing,
  matching,
  recipePromptOpen,
  recipePromptRef,
  busy,
  advancedOpen,
  pageOptions,
  materials,
  activeBackground,
  inherited,
  effect,
  activeMaterial,
  previewStyle,
  editableBackground,
  setEffect,
  setInheritance,
  chooseImage,
  importImage,
  removeImage,
  resetCurrent,
  selectMaterial,
  useTransparentRecipe,
  dismissRecipePrompt,
  applyRecipeFromPrompt,
  setBackgroundKind,
  fullPreview,
  cancel,
  save,
  ranges
} = useBackgroundAppearanceEditor()
</script>
<template>
  <Teleport to="body">
    <div v-if="appearanceEditorOpen" v-show="!state.fullWindow" class="appearance-editor-backdrop">
      <section
        :ref="
          (element) => {
            dialogRef = element as HTMLElement | null
          }
        "
        class="appearance-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appearance-title"
        tabindex="-1"
      >
        <header class="appearance-editor-header">
          <div>
            <h2 id="appearance-title">背景与界面材质</h2>
            <p>搭配你的背景，预览满意后保存。</p>
          </div>
          <button
            type="button"
            class="appearance-icon-button"
            aria-label="取消并关闭"
            :disabled="state.saving || busy"
            @click="cancel"
          >
            <i class="pi pi-times" />
          </button>
        </header>
        <div class="appearance-editor-layout">
          <aside class="appearance-preview-panel">
            <div class="appearance-preview-toolbar">
              <select v-model="previewPage" aria-label="预览页面">
                <option v-for="page in pageOptions" :key="page.value" :value="page.value">
                  {{ page.label }}
                </option>
              </select>
              <div class="appearance-segment" role="group" aria-label="编辑与预览主题">
                <button
                  v-for="mode in ['light', 'dark'] as const"
                  :key="mode"
                  type="button"
                  :aria-pressed="tone === mode"
                  @click="tone = mode"
                >
                  {{ mode === 'light' ? '浅色' : '深色' }}
                </button>
              </div>
            </div>
            <div
              class="appearance-mini-window"
              :style="previewStyle"
              :data-preview-material="state.draft.surfaceMaterial"
            >
              <div class="app-background-layer app-background-layer--preview" aria-hidden="true">
                <div class="app-background-image" />
                <div class="app-background-dim" />
              </div>
              <div class="appearance-mini-title">Twilight Echo <span>⌕ ⚙</span></div>
              <div class="appearance-mini-body">
                <nav class="appearance-mini-sidebar">
                  <strong>♫ 本地音乐</strong><span>♧ 歌手</span><span>◉ 专辑</span
                  ><span>♡ 我的收藏</span>
                </nav>
                <div class="appearance-mini-content">
                  <h3>{{ pageOptions.find((page) => page.value === previewPage)?.label }}</h3>
                  <template v-if="previewPage === 'settings'"
                    ><div class="appearance-mini-card">外观设置<small>文字与背景预览</small></div>
                    <div class="appearance-mini-card">
                      播放设置<small>保留清晰的操作反馈</small>
                    </div></template
                  ><template v-else-if="previewPage === 'player'"
                    ><div class="appearance-mini-cover">♫</div>
                    <strong>夜航星</strong>
                    <p>在夜色中听见回响</p></template
                  ><template v-else
                    ><div
                      v-for="(title, index) in ['夜航星', 'MASAYUME CHASING', '如诗一般的形容你']"
                      :key="title"
                      class="appearance-mini-track"
                    >
                      <span
                        class="appearance-mini-art"
                        :style="{ background: ['#566b8a', '#936373', '#4e827b'][index] }"
                        >♫</span
                      ><span
                        ><strong>{{ title }}</strong
                        ><small>{{ ['未知歌手', 'BoA', '周杰伦'][index] }}</small></span
                      ><small>03:40</small>
                    </div>
                    <div class="appearance-mini-card">
                      我的歌单 <small>卡片外观预览</small>
                    </div></template
                  >
                </div>
              </div>
              <div class="appearance-mini-player">
                <span>♫ 夜航星</span><strong>⏮ ▶ ⏭</strong><span>☷</span>
              </div>
            </div>
            <p class="appearance-preview-hint">
              {{
                state.draft.surfaceMaterial === 'transparent'
                  ? '背景上保留文字、封面和操作反馈；菜单与弹窗保留底板。'
                  : '缩略图展示主要搭配，全窗口预览可查看实际界面。'
              }}
            </p>
            <button
              type="button"
              class="appearance-recipe"
              :disabled="inherited || state.saving || busy"
              @click="useTransparentRecipe"
            >
              <i class="pi pi-eye" /> {{ matching ? '正在分析背景…' : '图片通透推荐搭配' }}
            </button>
          </aside>
          <div
            :ref="
              (element) => {
                bodyRef = element as HTMLElement | null
              }
            "
            class="appearance-editor-controls"
          >
            <nav class="appearance-section-links" aria-label="编辑区域">
              <button
                v-for="area in ['background', 'material', 'advanced'] as const"
                :key="area"
                type="button"
                :aria-pressed="appearanceEditorArea === area"
                @click="appearanceEditorArea = area"
              >
                {{ { background: '背景', material: '界面材质', advanced: '高级设置' }[area] }}
              </button>
            </nav>
            <section id="appearance-background" class="appearance-control-section">
              <h3>背景</h3>
              <p class="appearance-section-description">
                图片、颜色和文字搭配。当前编辑{{ tone === 'light' ? '浅色' : '深色' }}模式。
              </p>
              <label class="appearance-field"
                >应用范围<select v-model="target" aria-label="背景应用范围">
                  <option value="global">统一背景</option>
                  <option v-for="page in pageOptions" :key="page.value" :value="page.value">
                    {{ page.label }}单独覆盖
                  </option>
                </select></label
              >
              <label v-if="target !== 'global'" class="appearance-checkbox"
                ><input
                  type="checkbox"
                  :checked="inherited"
                  :disabled="state.saving"
                  @change="setInheritance"
                />继承统一背景</label
              >
              <fieldset :disabled="inherited || state.saving || busy">
                <div class="appearance-segment">
                  <button
                    v-for="kind in ['color', 'image'] as const"
                    :key="kind"
                    type="button"
                    :aria-pressed="activeBackground.kind === kind"
                    @click="setBackgroundKind(kind)"
                  >
                    {{ kind === 'color' ? '纯色' : '图片' }}
                  </button>
                </div>
                <label class="appearance-color-field"
                  >{{ activeBackground.kind === 'image' ? '图片回退底色' : '背景颜色'
                  }}<input
                    type="color"
                    :value="activeBackground[tone]"
                    @input="editableBackground()[tone] = ($event.target as HTMLInputElement).value"
                  /><code>{{ activeBackground[tone] }}</code></label
                >
                <div v-if="activeBackground.kind === 'image'" class="appearance-image-actions">
                  <button type="button" @click="chooseImage">
                    <i class="pi pi-image" />{{
                      activeBackground.image ? '更换图片' : '选择图片'
                    }}</button
                  ><button type="button" :disabled="!activeBackground.image" @click="removeImage">
                    移除</button
                  ><small>JPG / PNG / WebP · 最大 20MB</small>
                </div>
                <div
                  v-for="field in ['blur', 'dim', 'brightness', 'scale'] as const"
                  :key="field"
                  class="appearance-slider"
                >
                  <label :for="`background-${field}`">{{ ranges[field].label }}</label
                  ><EditableRangeValue
                    :value="effect[field]"
                    v-bind="ranges[field]"
                    :aria-label="ranges[field].label"
                    @change="setEffect(field, $event)"
                  /><input
                    :id="`background-${field}`"
                    type="range"
                    v-bind="ranges[field]"
                    :value="effect[field]"
                    @input="setEffect(field, Number(($event.target as HTMLInputElement).value))"
                  />
                </div>
                <div class="appearance-field">
                  文字明暗
                  <div class="appearance-segment">
                    <button
                      v-for="text in ['theme', 'light', 'dark'] as const"
                      :key="text"
                      type="button"
                      :aria-pressed="effect.textTone === text"
                      @click="setEffect('textTone', text)"
                    >
                      {{ { theme: '跟随主题', light: '浅色', dark: '深色' }[text] }}
                    </button>
                  </div>
                </div>
              </fieldset>
            </section>
            <section id="appearance-material" class="appearance-control-section">
              <h3>界面材质</h3>
              <p class="appearance-section-description">用于主界面，菜单和弹窗始终保持可读。</p>
              <div class="appearance-material-options">
                <button
                  v-for="material in materials"
                  :key="material.value"
                  type="button"
                  :aria-pressed="activeMaterial === material.value"
                  :disabled="state.saving || busy"
                  @click="selectMaterial(material.value)"
                >
                  <i :class="material.icon" />{{ material.label }}
                </button>
              </div>
            </section>
            <section id="appearance-advanced" class="appearance-control-section">
              <button
                type="button"
                class="appearance-advanced-trigger"
                :aria-expanded="advancedOpen"
                @click="advancedOpen = !advancedOpen"
              >
                <h3>高级设置</h3>
                <i :class="advancedOpen ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
              </button>
              <div v-if="advancedOpen">
                <fieldset :disabled="inherited || state.saving || busy">
                  <div
                    v-for="field in ['positionX', 'positionY'] as const"
                    :key="field"
                    class="appearance-slider"
                  >
                    <label :for="`background-${field}`">{{ ranges[field].label }}</label
                    ><EditableRangeValue
                      :value="effect[field]"
                      v-bind="ranges[field]"
                      @change="setEffect(field, $event)"
                    /><input
                      :id="`background-${field}`"
                      type="range"
                      v-bind="ranges[field]"
                      :value="effect[field]"
                      @input="setEffect(field, Number(($event.target as HTMLInputElement).value))"
                    />
                  </div>
                </fieldset>
                <fieldset :disabled="state.saving || busy">
                  <CardAppearanceSettings
                    v-model="state.draft"
                    v-model:tone="tone"
                  /><LiquidGlassSettings v-model="state.draft" v-model:tone="tone" />
                </fieldset>
              </div>
            </section>
          </div>
        </div>
        <p v-if="state.error" class="appearance-error" role="alert">{{ state.error }}</p>
        <footer class="appearance-editor-footer">
          <button type="button" :disabled="state.saving || busy" @click="resetCurrent">
            恢复当前项默认</button
          ><button type="button" :disabled="state.saving || busy" @click="fullPreview(true)">
            全窗口预览</button
          ><span /><button type="button" :disabled="state.saving || busy" @click="cancel">
            取消</button
          ><button
            type="button"
            class="appearance-save"
            :disabled="state.saving || busy"
            @click="save"
          >
            {{ importing ? '导入中…' : state.saving ? '保存中…' : '保存并使用' }}
          </button>
        </footer>
        <input
          :ref="
            (element) => {
              fileInput = element as HTMLInputElement | null
            }
          "
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="appearance-file-input"
          @change="importImage"
        />
      </section>
    </div>
    <div
      v-if="appearanceEditorOpen && !state.fullWindow && recipePromptOpen"
      class="appearance-recipe-prompt-backdrop"
      @click.self="dismissRecipePrompt"
    >
      <section
        class="appearance-recipe-prompt"
        :ref="
          (element) => {
            recipePromptRef = element as HTMLElement | null
          }
        "
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="appearance-recipe-prompt-title"
        aria-describedby="appearance-recipe-prompt-description"
        tabindex="-1"
      >
        <div class="appearance-recipe-prompt-icon" aria-hidden="true">
          <i class="pi pi-sparkles" />
        </div>
        <div class="appearance-recipe-prompt-copy">
          <h2 id="appearance-recipe-prompt-title">图片已更换</h2>
          <p id="appearance-recipe-prompt-description">
            要不要使用图片通透推荐搭配？我会根据图片明暗自动选择文字颜色和保护遮罩，让主页卡片与设置文字更清晰。
          </p>
        </div>
        <div class="appearance-recipe-prompt-actions">
          <button type="button" class="appearance-recipe-prompt-later" @click="dismissRecipePrompt">
            稍后设置
          </button>
          <button type="button" class="appearance-save" @click="applyRecipeFromPrompt">
            <i class="pi pi-eye" aria-hidden="true" /> 应用推荐
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="appearanceEditorOpen && state.fullWindow"
      class="appearance-full-preview-toolbar"
      role="region"
      aria-label="临时外观预览"
    >
      <span>外观预览 · 尚未保存</span
      ><button type="button" :disabled="state.saving" @click="fullPreview(false)">返回编辑</button
      ><button type="button" :disabled="state.saving" @click="cancel">取消</button
      ><button type="button" class="appearance-save" :disabled="state.saving" @click="save">
        {{ state.saving ? '保存中…' : '保存并使用' }}
      </button>
    </div>
  </Teleport>
</template>
<style src="./settings-page/BackgroundAppearanceCustomizer.css" />
