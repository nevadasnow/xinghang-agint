import type * as React from 'react'

/**
 * 声明 Electron 的 `<webview>` 自定义元素，供 TSX 使用。
 *
 * React 自己不认识 <webview>（它是 Electron 在渲染进程里注入的自定义元素），
 * 不声明就会报 TS2339: Property 'webview' does not exist on type 'JSX.IntrinsicElements'。
 *
 * 属性按 Electron <webview> 的用法声明：src / partition / webpreferences / allowpopups
 * —— 都写成可选，避免漏传某一个就编译不过。
 */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        /** 形如 "contextIsolation=yes,nodeIntegration=no" */
        webpreferences?: string
        /** 空字符串即开启；本项目**不设**，弹窗一律 deny */
        allowpopups?: string
        useragent?: string
        /** 仅 Electron 内部使用，这里保留以免类型过窄 */
        preload?: string
        httpreferrer?: string
        disablewebsecurity?: string
      }
    }
  }
}

export {}
