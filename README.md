# 滴答提醒 (Dida Reminder)

一个 Windows 桌面计时提醒小工具：毛玻璃（Liquid Glass）界面、九种提醒类型、独立置顶弹窗，到点只弹出提醒卡片，主界面不会抢焦点。常驻系统托盘，安静地待在后台。

![界面截图](docs/screenshot.png)

## 功能

- **九种提醒类型**：间隔重复、倒计时、单次定时、每小时、每天、工作日、每周、每月、每年。
- **列表管理**：暂停 / 恢复 / 编辑 / 删除、按状态筛选（全部 / 进行中 / 已暂停 / 已过期），双击行快速暂停或恢复。
- **独立置顶弹窗**：提醒到点时只把小弹窗置顶到最前，主窗口保持原位；带提示音、超时计时与「5 分钟后再响」贪睡。
- **托盘常驻**：关闭主窗口只是隐藏到托盘；托盘与右键菜单提供新建、测试提醒、全部暂停 / 恢复、删除全部（带确认）、开机自启、退出。
- **开机自启**：一键开关登录时自动启动。
- **单层窗口 chrome**：隐藏系统标题栏，标题栏与窗口控件画在毛玻璃内部，整窗为一块连续玻璃表面（保留原生圆角、阴影与缩放边）。
- **键盘可达**：对话框焦点圈闭、Esc 关闭、Ctrl+Enter 保存，控件均有 aria 标签。

## 下载

前往 [Releases](../../releases) 页面下载 Windows 版：

- `DidaReminder-<版本>-windows-amd64-setup.exe`：安装版，写入开始菜单与卸载项。
- `DidaReminder-<版本>-windows-amd64-portable.exe`：免安装便携版，双击即用。
- `SHA256SUMS.txt`：上述文件的 SHA256 校验和，用于核对完整性。

仅支持 Windows 10/11（x64），依赖系统自带的 WebView2 运行时。

## 安全软件提示说明（360 / 火绒 / Defender）

本工具开源、**无任何联网代码**（不下载、不上传、不自动更新）。首次运行若被 360 等提示「可疑程序 / 正在创建 BITS 任务」，原因与处理如下。

**为什么会报**

- 界面依赖系统自带的 **Microsoft Edge WebView2 运行时**。它是「常青（Evergreen）」组件，由微软自己的更新服务在后台自动更新，下载更新时会用到 Windows 的 **BITS（后台智能传输）/ 传递优化**。安全软件的行为启发式把「创建 BITS 任务」沿进程树归因到刚启动的本工具上——但真正创建任务的是微软签名的 `msedgewebview2.exe`，并非本工具。
- 本工具目前**未做代码签名**，且经微信/浏览器下载的文件带有「网络来源标记（Mark-of-the-Web）」，这两点会放大启发式的可疑评分。

**怎么处理（终端用户）**

1. 在拦截弹窗点 **允许操作**：放行的是微软 WebView2 组件的自更新，安全。
2. 把本工具加入安全软件的 **信任区 / 白名单**，避免每次启动都拦：
   - 360 安全卫士：木马查杀 → 信任区 → 添加文件，选中本 exe。
   - 火绒：安全设置 → 信任区 → 添加。
3. 若仍被反复拦截，先按下方方法核对 SHA256，确认与官方发布一致后再放行。

**校验文件完整性**

每个 Release 附带 `SHA256SUMS.txt`。下载后在文件所在目录运行（PowerShell，文件名替换为实际下载的版本）：

```powershell
Get-FileHash .\DidaReminder-0.1.1-windows-amd64-portable.exe -Algorithm SHA256
```

把输出的 Hash 与 `SHA256SUMS.txt` 中对应行比对，一致即未被篡改。

**官方下载渠道**

仅从本仓库 [Releases](../../releases) 下载，请勿使用第三方网盘或他人转发的可执行文件。

**误报申诉与长期根治**

- 360 官方误报反馈（免费，1–2 个工作日处理）：<https://open.soft.360.cn/report.php>，提交 exe、误报截图与软件说明即可。
- 彻底降低启发式误报的根本办法是 **代码签名证书**（OV/EV）。本项目为个人开源小工具，暂未签名；遇到安全软件提示欢迎通过 Issue 反馈。

## 从源码构建

需要 [Go](https://go.dev/)、[Bun](https://bun.sh/)（或 Node.js）与 Windows 构建环境。

```bash
bun install        # 安装前端依赖
bun run dev        # 开发模式（热更新）
bun run build      # 生成 build/windows-amd64/ 下的 exe 与安装包
bun run typecheck  # 前端类型检查
go test ./...      # 后端测试
```

构建产物位于 `build/windows-amd64/`。

## 技术栈

- **后端**：Go + [MyGo](https://github.com/egoist/mygo) 0.8.3（窗口、托盘、菜单、定时引擎、持久化）。
- **前端**：React 18 + TypeScript + Vite，运行于 WebView2；毛玻璃视觉为纯 CSS（backdrop-filter）。
- **通信**：MyGo 类型化 IPC，`src/mygo.ts` 由 `mygo generate` 自动生成。

## 许可证

[MIT](LICENSE)