---
description: 从零在本地跑起 OpenPets 桌面应用所需的操作系统、Node/pnpm、平台依赖、可选工具链、环境变量与常见阻塞。
---

# 本地运行环境

这份文档只回答一件事：**把一个干净的机器准备到能跑起本仓库的桌面应用**。
它面向二次开发（改应用、做宠物、写插件），不是终端用户的安装说明
（用户直接下载 Release 即可，见 [Install](/install)）。

不依赖的东西先说清楚：没有数据库、没有 Docker、没有需要预先部署的后端。
默认宠物和官方插件随应用内置，**离线也能启动**；只有拉取公开目录（catalog）
和下载宠物/插件 ZIP 时才需要联网。

## 一、必须项

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| 操作系统 | macOS / Windows / Linux 桌面版 | 需要能创建透明、无边框、置顶窗口 |
| 图形会话 | 可用的桌面会话（Aqua / Windows 桌面 / X11 或 Wayland） | 纯 headless、无 `DISPLAY` 的 SSH 会话不能直接跑宠物窗口 |
| Node.js | `>= 20` | 根 `package.json` 的 `engines`；CI 实际使用 Node 22（Windows 打包）与 Node 24（Linux x64） |
| pnpm | `11.x` | 由根 `package.json` 的 `packageManager: pnpm@11.0.8` 固定，建议用 Corepack 自动匹配 |
| Git | 任意较新版本 | 仓库含两个插件子模块，完整插件集需要初始化 |
| 网络 | 首次安装需要 | npm registry、Electron 二进制、`sharp` 预编译包；之后可离线运行 |
| 磁盘 | 预留数 GB | `node_modules`、Electron 二进制、构建产物（`dist/`、`dist-electron/`） |

`sharp`、`electron` 都提供预编译产物，**不需要**本机的 C++ 编译器或 Python
构建链，也不需要 `npm rebuild`（打包配置里 `npmRebuild: false`）。

## 二、一次性准备

```bash
# 1. 启用 Corepack，让 pnpm 版本与仓库声明一致
corepack enable

# 2. 安装依赖（在仓库根目录）
pnpm install

# 3. 可选：初始化插件子模块，只有需要完整官方插件集时才需要
git submodule update --init --recursive
```

Electron 的二进制是**懒下载**的：`pnpm install` 不一定把它拉下来，第一次
`require('electron')` / 第一次启动应用时才真正下载。想提前排除网络问题，可以
先执行：

```bash
pnpm --filter @open-pets/desktop exec electron --version
```

如果下载失败，通常是网络或镜像问题，设置 `ELECTRON_MIRROR` 后重试即可。

## 三、平台差异

### macOS

- 日常开发只需要 Node + pnpm；Xcode Command Line Tools 只在本地打包
  （`pnpm package:desktop`，`electron-builder` 的 ad-hoc 签名）时才需要：
  `xcode-select --install`。
- 首次启动可能弹出麦克风权限（Talk/语音功能）与钥匙串相关提示，按需允许即可。
- 从网络下载的 Release 应用会被 Gatekeeper 加隔离属性，本地开发运行的
  不受影响；如需处理下载版，参考 [Install](/install)。

### Windows

- 发布产物为 x64；开发用 Node 22+ 即可，无需 Visual Studio Build Tools。
- **符号链接权限**：pnpm 的 workspace 链接和打包预检
  （`apps/desktop/scripts/check-windows-symlink-privilege.cjs`）需要创建符号
  链接的能力。请打开「设置 → 隐私和安全性 → 开发者选项 → 开发人员模式」，
  或以管理员身份运行终端，否则可能出现 `EPERM: operation not permitted,
  symlink`。
- 路径尽量不含空格或非 ASCII 字符，避免打包与原生模块加载的意外问题。

### Linux

Linux 是这里最需要注意的平台，主要因为**窗口定位**依赖 X11 语义。

- 应用启动时会通过引导进程强制使用 **`--ozone-platform=x11`（XWayland）**。
  这是有意为之：原生 Wayland 不允许客户端自行定位/置顶窗口，重力、拖拽、
  walkabout、跨屏移动都会失效。详见 [Desktop app](/desktop#linux-display-backend-ozonewayland)。
- 设置 `OPENPETS_ALLOW_WAYLAND=1` 可以恢复原生 Wayland，但会同时失去上述
  移动与置顶能力（启动时会打印一次警告）。
- 需要能正确合成的桌面环境；没有合成器时透明窗口可能显示为黑色矩形。
- 运行库（Debian/Ubuntu 系，包名随发行版版本略有差异）：

  ```bash
  sudo apt-get install -y \
    libgtk-3-0 libnss3 libasound2 libgbm1 libdrm2 \
    libxss1 libxtst6 libx11-xcb1 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxrandr2 libcups2 \
    libatk1.0-0 libatk-bridge2.0-0 libpango-1.0-0 libcairo2
  ```

  Ubuntu 24.04 上部分包名带 `t64` 后缀（例如 `libasound2t64`、
  `libgtk-3-0t64`），按提示替换即可。

- **沙箱**：Electron 自带的 `chrome-sandbox` 需要 root 所有且权限为 `4755`，
  否则会报 `SUID sandbox helper` 错误。开发时可修正该文件权限；如果发行版的
  AppArmor 限制了非特权 user namespace，也可临时用 `--no-sandbox` 启动
  （仅限本地开发，不要用于发布构建）。
- **可选：原生 layer-shell 后端**。实验性的 Wayland layer-shell 支持需要一个
  Rust 编译器（`cargo`）：

  ```bash
  pnpm --filter @open-pets/desktop build:wayland-helper
  ```

  这条链路只影响 Wayland 下的特殊窗口后端，普通开发不需要构建它。

## 四、可选工具链（按需，不影响主应用）

| 场景 | 额外需要 | 说明 |
| --- | --- | --- |
| 插件目录/官网数据（`web/`） | Bun + Nuxt | 独立工具链，从 `web/` 目录用 `bun` 运行，不使用 pnpm；当前检出未包含 `web/`，涉及 `pnpm plugins:package|publish|deploy` 等发布脚本时需要单独获取这部分源码 |
| 插件发布校验 | 上述 `web/` 源码 | `pnpm plugins:validate-release` / `plugins:validate-live` |
| Linux 原生 Wayland 后端 | Rust / `cargo` | 见上一节 |
| Linux 多桌面环境复现 | VMware Fusion + Vagrant | 仅当仓库包含 `infra/linux-vms/` 时可用；Windows/Linux 上无法使用该 macOS 专用流程 |

AI 能力（Pet Assistant / 语音）**不是**运行前提：没有配置 provider 时应用
仍可正常启动，只是相关功能不可用。

## 五、开发环境变量

全部可选，不设置也能跑。仅在启动命令前设置。

| 变量 | 作用 |
| --- | --- |
| `OPENPETS_RENDERER_URL` | 让 Electron 加载 Vite 开发服务器（默认由 `dev:control-center` 设为 `http://127.0.0.1:5173`） |
| `OPENPETS_DEV_ROUTE` | 开发期直接打开 Control Center 的指定路由：`dashboard` / `pets` / `integrations` / `plugins` / `settings` / `teams`（`providers` 直达 Settings 的 Providers 子页）；打包版忽略 |
| `OPENPETS_DEV_PLUGIN_ROOTS` | 冒号分隔的本地插件根目录列表，用于热加载未打包插件 |
| `OPENPETS_DISABLE_PLUGIN_CATALOG` | 设为 `1` 时不使用远程插件目录，只加载本地/内置插件 |
| `OPENPETS_LOG_LEVEL` | `debug` / `info` / `warn` / `error` |
| `OPENPETS_LOG_CONSOLE` | 设为 `1` 时把日志同时镜像到终端（开发模式默认已开启） |
| `OPENPETS_ALLOW_WAYLAND` | 设为 `1` 时放弃强制 XWayland（会失去窗口定位能力） |
| `OPENPETS_NATIVE_WAYLAND` | 设为 `1` 时请求原生 layer-shell 后端 |
| `OPENPETS_WHATS_NEW_PREVIEW` | 设为 `1` 时打开 What's New 预览 |
| `OPENPETS_TEAMS_API_URL` | 覆盖 Teams 后端地址（一般无需设置） |
| `OPENPETS_GITHUB_REPOSITORY` | 覆盖更新检查使用的 GitHub 仓库（默认 `OpenPetsHQ/openpets`） |
| `OPENPETS_WAYLAND_HELPER_DEBUG` | 设为 `1` 时输出原生 Wayland helper 的调试日志 |

端口占用：`dev:desktop:control-center` 固定使用 `127.0.0.1:5173` 的 Vite
服务器，被占用时需要先释放该端口。

## 六、启动与验证

```bash
# 最常用的开发启动：先构建 workspace 依赖，再启动 Electron
pnpm dev:desktop

# Control Center 前端热更新（Vite + Electron 并行）
pnpm dev:desktop:control-center

# 热加载官方 + 本地开发插件
pnpm dev:desktop:plugins

# 热加载 third-parties 下的插件目录
pnpm dev:desktop:third-parties

# 详细日志（终端 + 文件）
pnpm --filter @open-pets/desktop dev:debug
```

启动成功的标志：托盘出现图标、桌面上出现宠物；Control Center 可从托盘的
菜单打开。日志写入：

- macOS：`~/Library/Application Support/OpenPets/logs/openpets.log`
- Windows：`%APPDATA%\OpenPets\logs\openpets.log`
- Linux：`~/.config/OpenPets/logs/openpets.log`

注意 `pnpm dev:desktop` 会先执行一次 `pnpm build`（构建全部依赖包），所以
**首次启动明显更慢**；只想反复改主进程代码时可用
`pnpm --filter @open-pets/desktop dev:electron`。

提交前的最小验证：

```bash
pnpm --filter @open-pets/desktop check    # typecheck + build + tests
pnpm --filter @open-pets/desktop test     # 跨模块改动时再跑一次
git diff --check
```

## 七、常见阻塞对照表

| 现象 | 原因 / 处理 |
| --- | --- |
| `pnpm install` 报 `EPERM: symlink` | Windows 未开启开发人员模式，或未以管理员运行 |
| 首次启动卡在下载 Electron | 二进制懒下载；检查网络或设置 `ELECTRON_MIRROR` |
| `Missing X server or $DISPLAY` | 在无图形会话的 SSH 里启动；改到桌面会话中运行 |
| 宠物窗口透明区域是黑色 | Linux 桌面缺少合成器 |
| 宠物不能拖动 / 不落重力 | 运行在原生 Wayland；确认启动参数含 `--ozone-platform=x11`，不要设置 `OPENPETS_ALLOW_WAYLAND=1` |
| `SUID sandbox helper` 报错 | `chrome-sandbox` 权限不对；修正为 root 所有 `4755`，或本地开发临时 `--no-sandbox` |
| 宠物图片显示成默认猫 | CSP 未包含新的图片协议/来源，见 [Desktop app](/desktop) 的 CSP 说明 |
| `plugins:*` 脚本找不到 `web/` | 当前检出不含 `web/` 子工具链，需要单独获取 |
| 5173 端口被占用 | 关闭占用进程，或调整 Vite 端口并同步 `OPENPETS_RENDERER_URL` |

更多运行时问题见 [Troubleshooting](/troubleshooting)，构建、测试与发布门槛见
[Development](/development) 与 [Testing and validation](/testing-and-validation)。
