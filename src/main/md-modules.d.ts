// .md 提示词资产导入声明：
// electron.vite.config.ts 中 mdRawPlugin 会把 .md 转成导出字符串的 JS 模块，
// 这里为 TS 提供类型声明。
declare module '*.md' {
  const content: string
  export default content
}
