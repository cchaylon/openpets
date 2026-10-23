---
description: 本地跑起 OpenPets 桌面应用所需的环境、平台依赖、可选工具链与常见阻塞。
---

# 本地运行环境

面向二次开发（改应用、做宠物、写插件），不是终端用户的安装说明（见
[Install](/install)）。不需要数据库、Docker 或任何后端服务；默认宠物与官方
插件随应用内置。

## 一、必须项

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| 操作系统 | macOS / Windows / Linux 桌面版 | 需要图形会话和支持透明置顶窗口的桌面环境 |
| Node.js | `>= 20` | 根 `package.json` 的 `engines`；CI 使用 Node 22 / 24 |
| pnpm | `11.x` | 由 `packageManager: pnpm@11.0.8` 固定，建议用 Corepack 自动匹配 |

`sharp`、`electron` 都提供预编译产物，**不需要**本机的 C++ 编译器、Python
构建链或 `npm rebuild`。

## 二、一次性准备

```bash
corepack enable
pnpm install

# 可选：只有需要完整官方插件集时才初始化子模块
git submodule update --init --recursive
```

Electron 二进制是**懒下载**的：第一次 `require('electron')` / 启动应用时才真正
下载。想提前验证，可执行 `pnpm --filter @open-pets/desktop exec electron --version`；
下载失败通常是镜像问题，设置 `ELECTRON_MIRROR` 后重试。

## 三、平台差异

### macOS

- 日常开发只需 Node + pnpm；只有本地打包（`pnpm package:desktop`）才需要
  Xcode Command Line Tools：`xcode-select --install`。
- 首次启动可能弹出麦克风与钥匙串权限提示，按需允许。

### Windows

- 发布产物为 x64；开发无需 Visual Studio Build Tools。
- pnpm 的 workspace 链接与打包预检需要创建符号链接的能力：打开「开发人员
  模式」或以管理员身份运行终端，否则会报 `EPERM: operation not permitted,
  symlink`。

### Linux

- 启动时会强制使用 `--ozone-platform=x11`（XWayland）：原生 Wayland 不允许
  客户端自行定位/置顶窗口，重力、拖拽、跨屏移动都会失效。详见
  [Desktop app](/desktop#linux-display-backend-ozonewayland)。
- `OPENPETS_ALLOW_WAYLAND=1` 可恢复原生 Wayland，但会失去上述移动与置顶能力。
- 需要能正确合成的桌面环境；否则透明窗口可能显示为黑色矩形。
- 运行库（Debian/Ubuntu 系，Ubuntu 24.04 部分包名带 `t64` 后缀）：

  ```bash
  sudo apt-get install -y \
    libgtk-3-0 libnss3 libasound2 libgbm1 libdrm2 \
    libxss1 libxtst6 libx11-xcb1 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxrandr2 libcups2 \
    libatk1.0-0 libatk-bridge2.0-0 libpango-1.0-0 libcairo2
  ```

- **沙箱**：Electron 的 `chrome-sandbox` 需 root 所有且权限 `4755`，否则报
  `SUID sandbox helper` 错误。发行版 AppArmor 限制 user namespace 时，本地开发
  可临时加 `--no-sandbox`（不要用于发布构建）。
- **可选**：实验性 Wayland layer-shell 后端需要 Rust，执行
  `pnpm --filter @open-pets/desktop build:wayland-helper` 构建。

## 四、可选工具链

| 场景 | 额外需要 | 说明 |
| --- | --- | --- |
| 官网与插件目录数据（`web/`） | Bun + Nuxt | 独立工具链，从 `web/` 用 `bun` 运行；当前检出未包含该目录，涉及 `pnpm plugins:package|publish|deploy` 等脚本时需要单独获取 |
| Linux 多桌面环境复现 | VMware Fusion + Vagrant | 仅当仓库包含 `infra/linux-vms/` 时可用 |

AI 能力（Pet Assistant / 语音）不是运行前提：未配置 provider 时应用仍可启动，
只是相关功能不可用。

## 五、开发环境变量

全部可选，在启动命令前设置即可。

| 变量 | 作用 |
| --- | --- |
| `OPENPETS_RENDERER_URL` | 让 Electron 加载 Vite 开发服务器（`dev:control-center` 默认 `http://127.0.0.1:5173`） |
| `OPENPETS_DEV_ROUTE` | 开发期直接打开 Control Center 路由：`dashboard` / `pets` / `integrations` / `plugins` / `settings` / `teams`（`providers` 直达 Settings 子页） |
| `OPENPETS_DEV_PLUGIN_ROOTS` | 冒号分隔的本地插件根目录，用于热加载未打包插件 |
| `OPENPETS_DISABLE_PLUGIN_CATALOG` | 设为 `1` 时只用本地/内置插件，不访问远程目录 |
| `OPENPETS_LOG_LEVEL` | `debug` / `info` / `warn` / `error` |
| `OPENPETS_LOG_CONSOLE` | 设为 `1` 时把日志同时输出到终端（开发模式默认开启） |
| `OPENPETS_ALLOW_WAYLAND` | 设为 `1` 时放弃强制 XWayland（会失去窗口定位能力） |
| `OPENPETS_NATIVE_WAYLAND` | 设为 `1` 时请求原生 layer-shell 后端 |

`dev:desktop:control-center` 固定占用 `127.0.0.1:5173`，被占用时需先释放。

## 六、启动与验证

```bash
pnpm dev:desktop                 # 构建依赖后启动 Electron
pnpm dev:desktop:control-center  # Control Center 前端热更新
pnpm dev:desktop:plugins         # 热加载官方 + 本地开发插件
pnpm --filter @open-pets/desktop dev:debug   # 详细日志
```

启动成功的标志：托盘出现图标、桌面出现宠物。日志位于 `userData/logs/openpets.log`
（macOS `~/Library/Application Support/OpenPets`、Windows `%APPDATA%\OpenPets`、
Linux `~/.config/OpenPets`）。

`pnpm dev:desktop` 会先 `pnpm build`，首次启动明显更慢；只改主进程时可用
`pnpm --filter @open-pets/desktop dev:electron`。

```bash
pnpm --filter @open-pets/desktop check
git diff --check
```

## 七、常见阻塞

| 现象 | 处理 |
| --- | --- |
| `pnpm install` 报 `EPERM: symlink` | Windows 未开启开发人员模式或未以管理员运行 |
| 首次启动卡在下载 Electron | 检查网络/镜像，设置 `ELECTRON_MIRROR` |
| `Missing X server or $DISPLAY` | 在无图形会话的 SSH 中启动；改到桌面会话运行 |
| 宠物窗口透明区域为黑色 | Linux 桌面缺少合成器 |
| 宠物不能拖动或不落重力 | 确认使用 XWayland，不要设置 `OPENPETS_ALLOW_WAYLAND=1` |
| `SUID sandbox helper` 报错 | 修正 `chrome-sandbox` 为 root 所有 `4755`，或本地开发临时 `--no-sandbox` |

更多问题见 [Troubleshooting](/troubleshooting)，构建与发布门槛见
[Development](/development)、[Testing and validation](/testing-and-validation)。
