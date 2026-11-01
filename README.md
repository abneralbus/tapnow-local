# TapNow Local

运行在本机的 AI 创意画布：把图片、视频、提示词和 Agent 放在同一张画布上，通过连线与 `@` 引用组织生成任务。界面参考 TapNow 的使用方式；这是独立项目，与 TapNow、Google 或 Meta 没有官方关联。

本项目提供画布和服务适配，不附带模型额度、账号、Cookie 或 API Key。Flow 和 Muse 需要使用者自己的有效账号及相应功能权限。

## 功能

- 图片、视频节点，拖拽、框选、多选、自动连线与连续编号。
- 画布分组、搜索、批量移动、30 天回收站及版本快照。
- Agent 对话与节点引用，分别控制创建、删除、移动、改提示词和提交生成的权限。
- Google Flow：图片生成、参考图生图、Veo 首帧视频、Omni 参考图视频。
- Muse：图片生成、参考图生图、文生视频、参考图视频。
- 可选 Colab 视频服务；无需部署 Colab 即可使用 Flow、Muse 和 Agent。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 系统 | macOS 为当前验证平台；Linux 可按终端流程部署，未完成完整验证；Windows 原生启动暂未支持 |
| Node.js | 22.12 或更新版本，包含 npm |
| Python | 3.10 或更新版本，支持 venv 与 pip |
| 浏览器 | Chrome / Chromium；Flow 需要安装本项目附带的连接扩展 |
| 视频预览 | ffmpeg；macOS 已安装 Homebrew 时可执行 `brew install ffmpeg` |
| 网络 | 能正常打开自己的 Flow / Muse 创作页；首页能打开不代表账号有创作权限 |

Flow 与 Muse 的适配源码位于 `vendor/`，所需 Python 依赖由安装脚本安装。

## 第一次安装

下载 ZIP 并解压，或克隆仓库后进入包含 `package.json` 的目录：

```sh
npm run setup
```

安装会执行 `npm ci`，建立项目内 `.venv`，安装两项桥接依赖并构建前端；创建本机配置模板，已有配置不会被覆盖。不要把别人的 `.venv`、`node_modules` 或 `data` 复制过来代替安装。

先单独打开画布：

```sh
npm start
```

浏览器访问 **http://127.0.0.1:4317/**。没有配置生成服务时，也能创建画布、上传素材和编辑节点。

接下来按 [Flow / Muse 连接指南](MEDIA-BRIDGE.md) 配置自己的账号。完成后，macOS 可双击 **`start-local.command`** 同时启动画布与媒体桥接。第一次启用 Muse：

```sh
./start-local.command --with-muse
```

后续直接双击会复用上次成功启用的服务。仅用 Flow 时执行 `./start-local.command --flow-only`。双击启动前请先在之前运行 `npm start` 的终端按 Ctrl+C，避免重复占用端口。

## Agent

在画布的「模型连接 → Agent」选择服务，填写模型名并测试连接：

- CLI：Codex、Claude、agy。先分别在自己的终端安装并登录相应 CLI。本项目从 `PATH` 查找；特殊安装路径可在 `.env` 设置 `CODEX_BIN`、`CLAUDE_BIN`、`AGY_BIN`。
- API：DeepSeek、OpenAI、Anthropic、Gemini 或兼容 OpenAI Chat Completions 的服务。填写自己的 Base URL、API Key 和账号可用的模型名。

CLI 适配依赖相应命令行版本的参数支持，出现未知参数时请检查 CLI 版本或改用 API。API Key 保存在本机 `data/agent-config.json`，不要上传这个文件。

拖动节点只移动位置；拖「引用到 Agent」按钮才加入引用，多选引用会聚拢显示。也可以在 Agent 中输入 `@` 选择图片或视频。引用按节点 ID 绑定，自动编号变化后仍指向原节点。

当前 Agent 引用提供节点文字和关系，暂不支持直接理解图片或视频内容。图片生成适配器会把真实参考图片上传，并把提示词中的引用映射到实际附件顺序；当前不支持把视频作为这些生成接口的输入。

## 生成能力与限制

| 服务 | 已接入的输入 | 当前限制 |
| --- | --- | --- |
| Flow 图片 | 文字、参考图片 | 需登录 Flow、配置项目 UUID 和真实套餐 |
| Flow Veo | 首帧图片 + 提示词 | 当前桥接不支持纯文字视频或尾帧 |
| Flow Omni | 多张参考图 + 提示词 | 接口时长选项 4/6/8/10 秒；由上游账号能力决定 |
| Muse | 文字、参考图片 | 图片是参考附件，不保证锁定首尾帧、严格时长或精确比例 |
| Colab | H3 文字／首尾帧／全能参考视频，结果保存后可在画布释放 GPU | 实验性，可用硬件、权重与显存需要自行验证 |

连接状态只证明某一层服务可用，不能代替真实生成验证。先各提交一次图片生成，再用结果创建视频节点测试回传。遇到超时先查看已有任务，不要反复提交：上游可能已接收并消耗额度。

## 数据、备份和退出

- `data/canvases/`：画布；`data/media/`：本机素材；`data/canvas-history/`：历史快照。
- **完整备份整个 `data/`**。导出的画布 JSON 只有结构与资源地址，不包含图片或视频文件。
- 画布进入回收站后保留 30 天，到期清理其历史和独占素材；仍被其他画布或保留版本引用的素材不删除。应用关闭时不会执行后台清理，下次启动补做。
- 有更改时约每 2 分钟留一份快照，删除节点前额外保存；每张画布最多保留最近 100 个不同版本。恢复历史会新建副本。
- 最后一个页面正常关闭后，后端在空闲约 30 秒后退出；浏览器异常退出时先等待最长约 2 分钟心跳租约到期。生成或 Agent 工作尚未结束时延后退出。媒体启动器随后清理自己创建的服务。
- 端口停止后重新运行启动命令；网页刷新不会重新启动 Node 服务。

## 可选 Colab

见 [Colab 指南](docs/COLAB.md)。此路径与 Flow / Muse 无关，不属于新用户安装的必选步骤。

## 开发与检查

```sh
npm run dev                         # Vite 开发模式
npm test                            # Node 回归测试，使用临时数据与模拟上游
python3 scripts/test_media_bridge.py # 桥接边界及生命周期检查
python3 scripts/test_share.py        # 分享包排除规则检查
npm run build
```

真实生成测试会使用自己的上游额度，不在这些离线测试中自动执行。验证范围见 [发布检查记录](docs/RELEASE-CHECKS.md)。

## 来源与许可

Flow 适配依赖 [Flowboard](https://github.com/crisng95/flowboard)，Muse 适配依赖 [muse2api](https://github.com/crisng95/muse2api)。来源、固定提交及本地修改说明保留在 [第三方说明](vendor/THIRD-PARTY-NOTICES.md)。muse2api 的 MIT 许可证原文随包保留。

本仓库尚未为自有代码指定开源许可证。所附 Flowboard 版本没有正式 LICENSE，仅声明“MIT proposed”；其许可状态仍待上游明确。Muse 适配代码遵循随附的 MIT 许可证。
