# 连接 Google Flow 与 Muse

先完成根目录 README 的 `npm run setup`。以下命令均在项目根目录运行；所有 Cookie、密钥及真实配置只放在 `data/` 或 `.env` 中。不要改 `vendor/` 中的源码来填账号。

## 1. Google Flow

### 准备自己的创作项目

1. 在 Chrome 登录自己的 Google 账号，打开 https://flow.google.com/ ，确认可以进入创作界面。
2. 在 Flow 中新建或打开一个项目，从项目地址复制其 UUID。桥接不能代替你创建上游项目。
3. 编辑安装器生成的 `data/private/flow/.env`：

```dotenv
FLOWBOARD_FLOW_PROJECT_ID=填写你自己的项目UUID
FLOWBOARD_PAYGATE_TIER=PAYGATE_TIER_ONE
```

Pro 填 `PAYGATE_TIER_ONE`，Ultra 填 `PAYGATE_TIER_TWO`。按真实套餐填写，这不是获得额外额度的开关。

### 安装浏览器连接助手

1. Chrome 打开 `chrome://extensions/`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择**本项目的 `vendor/flowboard/extension` 目录**。
3. 刷新已登录的 Flow 项目页并保持该页面打开；点击扩展图标可以查看连接状态。
4. 只保留一个指向这些端口的 Flowboard 扩展实例，避免不同版本抢接任务。

已解压扩展依赖原目录的位置；移动项目后，请在 Chrome 重新加载新位置的扩展。浏览器登录态属于你自己的 Chrome 资料，不随仓库分享。

### 启动和验证

终端 A：`npm start`。终端 B：

```sh
python3 scripts/start-media-bridge.py --flow-only --check
python3 scripts/start-media-bridge.py --flow-only
```

打开画布「模型连接」，刷新状态。Flow 应同时满足：桥接可访问、扩展已连接、项目已配置。

先新建图片节点，选择 Google Flow，输入普通测试提示词并生成。图片返回后，创建视频节点，引用该图作为 Veo 首帧，或在 Omni 参考图模式使用它，再生成视频。此步骤会消耗你的上游额度。

## 2. Muse

Muse 与 Flow 是两套独立的账号与传输链路。本项目 Muse 使用已登录账号的浏览器会话，不以 Google AI 套餐作为 Muse 权限证明。

### 确认可用账号与网络

在自己的浏览器登录 https://muse.ai/ ，确认**登录后的创作页**可用，再导入会话。仅能打开首页或提示「没有访问权限」时，先处理账号资格或网络，桥接不会绕过服务端权限。

网络需覆盖实际登录与创作请求；本项目排查中还观察到 `auth.meta.com`、`hatch-api.meta.ai`。具体依赖以上游当前页面为准。没有统一适用于所有人的代理规则，也不附送或指定某个代理出口。

### 导入自己的登录会话

桥接不开放上游的账户管理接口，因此通过本地私有文件配置：

```sh
cp config/muse-accounts.example.json data/private/muse/data/accounts.json
chmod 600 data/private/muse/data/accounts.json
```

在登录 Muse 的 Chrome 中打开开发者工具 → Application（应用）→ Storage → Cookies，查看 Muse 对应站点的 Cookie。把自己会话的 `hatch_sess`、`hatch_gw`、`hatch_vml`、`hatch_native_auth_device` 的 **Value** 填进文件对应字段；保留外层数组结构。不要把占位文本当作有效 Cookie，不要把值发送给别人或提交到 GitHub。

此方式可以查看 HttpOnly Cookie；仅复制 `document.cookie` 的结果可能不完整。若 Cookie 不在当前站点列表，按实际登录/跳转站点查看，不要凭空填值。用编辑器保存为合法 JSON，不能加注释或尾逗号。已有 muse2api 的 `accounts.json` 可以直接放在该私有位置。

Cookie 失效时，需要在自己的浏览器重新登录并更新这个文件；更新前停止媒体启动器，避免正在刷新会话的进程覆盖手工编辑。桥接自己的会话刷新也会回写该文件。

### 浏览器与代理配置

编辑 `data/private/muse/.env`。通常保留模板默认值即可；需要时填写：

```dotenv
MUSE2API_CHROMIUM_PATH=/你安装的Chrome或Chromium可执行文件路径
MUSE2API_BROWSER_PROXY=http://127.0.0.1:你的代理端口
```

不要原样复制上述示例路径。没有代理需求就留空。Muse 会创建自己的浏览器配置目录，不需要开放你日常 Chrome 的远程调试端口。

### 启用与测试

保持终端 A 的画布服务运行，先停止此前终端 B 的 Flow-only 启动器，再运行：

```sh
python3 scripts/start-media-bridge.py --with-muse --check
python3 scripts/start-media-bridge.py --with-muse
```

`--check` 只检查本地环境，不检查账号额度或上游访问权限。成功启动后会保存 Muse 启用状态；后续直接运行 `npm run media` 或双击主启动器即可恢复。

画布中选择 Muse，先测试文生图，然后引用返回的图片测试参考图视频。`ready: true` 也不能替代这两次实际生成。参考图视频不保证图像就是严格首帧。

## 3. 端口与私有目录

| 服务 | 地址/路径 | 用途 |
| --- | --- | --- |
| 画布 | `127.0.0.1:4317` | 页面、任务和 Agent |
| Flow HTTP | `127.0.0.1:8434` | 提交、上传、轮询、回传 |
| Flow 扩展 | `127.0.0.1:8355` | 扩展 WebSocket |
| Muse HTTP | `127.0.0.1:18610` | 媒体生成与下载 |
| Muse 自建浏览器 | `127.0.0.1:19210` | 本地浏览器控制 |
| 配置与账号 | `data/private/` | 用户填写的私有信息 |
| Flow 任务缓存 | `data/media-bridge/flow/` | 本项目单独的数据库与素材 |
| Muse 运行目录 | `data/media-bridge/muse/` | 浏览器配置、缓存、本地服务密钥 |
| 日志 | `data/media-bridge/flow.log`、`muse.log` | 本机排查，分享前需脱敏 |

默认端口是成套配置。不要只改 `.env` 的 PORT 就假定扩展、启动器和桥接都会跟着改变。若必须改端口，需同步修改相应服务配置和扩展地址。

Node 读取 Muse 自动创建的本地密钥，不会把它发给前端。媒体桥接只暴露生成链路所需接口，不开放账户管理、支付、任意代理和上游聊天接口。

## 4. 常见问题

- **Chrome 白屏、脚本 403：**检查请求头修改或 CORS 扩展。Origin 必须保留完整端口，例如 `http://127.0.0.1:4317`；不要通过放开所有来源来解决。
- **端口拒绝连接：**确认启动器仍运行。画布关闭后服务会自动退出，重新打开网址不能自动启动进程。
- **端口被占用：**关闭对应的旧启动器后再开。脚本不会强杀未知进程。
- **Flow 扩展离线：**检查扩展是否已加载、目录是否移动、Flow 页面是否刷新且登录，以及端口 8355。
- **Flow 已连接但生成失败：**检查自己的项目 UUID、真实套餐、上游额度和项目页面；检查日志时不要公开 Cookie。
- **Muse 没访问权限：**先在同一账号的 Muse 创作页复现，区分会话、账号资格和网络。不要把本地桥接健康误认为上游账号可用。
- **视频黑屏或封面失败：**确认 `ffmpeg -version` 可运行、原始媒体文件仍存在。已清理的素材不能靠 JSON 恢复。
- **迁移后虚拟环境失效：**venv 可能包含绝对路径。备份 `data/`，移除旧 `.venv` 后重新 `npm run setup`；不要删除 `data/`。

上游网页协议会变化。保留了当前版本的集成代码和修复，但不保证未来所有账号或上游更新都兼容。
