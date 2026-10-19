import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// 将 .md 提示词资产转换为字符串模块（等同 vite 的 ?raw 行为），
// 让 main 进程能 import 到提示词文件内容，避免运行时读盘。
function mdRawPlugin(): Plugin {
  return {
    name: 'md-raw-assets',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('.md')) {
        return {
          code: `export default ${JSON.stringify(code)};`,
          map: null
        }
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [mdRawPlugin()],
    build: {
      outDir: 'out/main'
    }
  },
  preload: {
    build: {
      outDir: 'out/preload'
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      outDir: 'out/renderer'
    }
  }
})
