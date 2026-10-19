import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ command }) => {
  // Development and explicitly requested evaluation packages expose manual
  // listening without asserting delivery acceptance. Use the same build value
  // for main and renderer so a usable selector cannot be silently forced off.
  const evaluation = command === 'serve' || process.env.TWILIGHT_AUTOMIX_EVALUATION === '1'
  const autoMixDefine = { __TWILIGHT_AUTOMIX_EVALUATION__: JSON.stringify(evaluation) }
  return {
    main: {
      define: autoMixDefine,
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/main/index.ts'),
            diagnosticWriter: resolve(__dirname, 'src/main/diagnostics/writerWorker.ts'),
            pluginHost: resolve(__dirname, 'src/main/plugins/host.ts'),
            audioEngineService: resolve(__dirname, 'src/main/audioEngineService.ts'),
            audioAnalysisService: resolve(__dirname, 'src/main/audioAnalysisService.ts'),
            libraryScanService: resolve(__dirname, 'src/main/library/libraryScanService.ts')
          }
        }
      }
    },
    preload: {},
    renderer: {
      define: autoMixDefine,
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src')
        }
      },
      publicDir: resolve('resources'),
      plugins: [vue()],
      build: {
        manifest: true,
        chunkSizeWarningLimit: 600,
        rollupOptions: {
          output: {
            manualChunks: {
              'locale-messages': [resolve('src/shared/i18n/messages/index.ts')],
              'media-providers': [resolve('src/renderer/src/providers/index.ts')],
              'playback-session': [
                resolve('src/renderer/src/app/playbackSessionWriter.ts'),
                resolve('src/renderer/src/app/usePlaybackSessionPersistence.ts')
              ],
              'listening-stats-storage': [
                resolve('src/renderer/src/stores/listeningStatsDatabase.ts')
              ],
              'vendor-vue': ['vue'],
              'vendor-music-metadata': ['music-metadata'],
              'vendor-qrcode': ['qrcode'],
              'vendor-xmldom': ['@xmldom/xmldom']
            }
          }
        }
      }
    }
  }
})
