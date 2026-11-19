import { defineConfig } from "mygo-cli";

export default defineConfig({
  name: "滴答提醒",
  identifier: "com.dida.reminder",
  version: "0.1.1",
  // Windows 版本信息里的厂商与版权。留空会让未签名 exe 在安全软件的
  // 启发式评分里更可疑，补全后可降低误报概率。
  publisher: "dida-reminder",
  copyright: "Copyright © 2026 dida-reminder contributors",
  license: "MIT",
  // `mygo dev` runs devCommand and loads devUrl; `mygo build` runs
  // buildCommand and embeds frontendDist into the app.
  devUrl: "http://localhost:5173",
  devCommand: "bun run dev:web",
  buildCommand: "bun run build:web",
  frontendDist: "dist",
  bindings: "src/mygo.ts",
  out: "build",
});
