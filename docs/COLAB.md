# Colab H3：Drive 恢复、参考素材与用完释放 GPU

使用 `colab/MiniMax-H3-TapNow-Local.ipynb`。笔记本内嵌代码由 `scripts/build-colab-notebook.py` 从同目录脚本生成；修改脚本后重新生成，避免版本漂移。

## 日常启动

笔记本固定为 **2026.07、G4 GPU、高 RAM**。2026-10-31 在 mert 账号下验证了该版本的 Drive 挂载和已有 Python 3.12 环境恢复；当时最新 Python 3.13 运行时挂载失败。同日完成了下方记录的真实生成、保存和画布释放 GPU 联调。

1. Colab 右上角和 Drive 授权页面均选择 **mert**，确认后将 `CONFIRMED_MERT_ACCOUNT=True`。该勾选是用户核对，不会自动识别或切换 Google 账号。
2. 在顶部 **① 两套启动入口** 的 `MODEL_SET` 中文下拉框选择 **全能参考（Ref2VA）** 或 **首尾帧／文字（FL2VA）**。无需手动改 `MODE`；每次运行环境只加载一种，结束会话后才能切换。
3. 已有完整备份时保留 `ALLOW_DOWNLOAD=False`、`INSTALL_ENV=False`、`SAVE_ENV=False`。恢复过程检查分区完整性和文件校验值，最多两个文件并行复制到本地 SSD，不依赖 Drive 直接推理。恢复日志写入 `/content/h3-prepare.log`，单元格定期显示进度；已完成且校验通过的本地文件可复用。
4. 首次补齐 Ref2VA 时设置 `ALLOW_DOWNLOAD=True`。首次安装或旧环境失效时设置 `INSTALL_ENV=True`，可同时设置 `SAVE_ENV=True` 保存环境。下一次恢复时关闭这三个选项。
5. 启动模型并等待健康检查，再启动认证代理、临时 HTTPS 隧道和释放监视器。不自动生成测速视频。
6. TapNow 的“模型连接 → Colab”填写临时 HTTPS 地址和相同的访问 Token，保存连接，再刷新会话状态。

## 现有缓存与硬件

- 缓存根目录：`/content/drive/MyDrive/TapNowLocal/models/MiniMax-H3/42ed227ee7df40d41602854ae760620d6eb651fe`。
- 环境备份：`TapNowLocal/session/h3-venv.tar.gz`，完成标记为 `BACKUP_COMPLETE`。
- 新脚本：`TapNowLocal/deployment`。
- 模型仍使用原始 BF16 分区与现有固定 SGLang revision。此启动配置要求 80 GB 级 GPU、至少 120 GiB RAM；检查通过不代表已经验证推理速度或所有分辨率的显存占用。
- 原 FL2VA 缓存约 134 GiB。固定版本的 Ref2VA 约 134.16 GiB，其中 72.40 GiB 与 FL2VA 的官方 SHA-256 完全相同，使用清单中的 `source_path` 共用 Drive 文件，仅新增约 61.76 GiB。两个分区都需要这些共用文件，因此不要单独删除 FL2VA 的文本编码器或 VAE 文件。Drive 和本地 SSD 都必须留足空间。只会恢复所选分区，不会为了文字任务下载 Ref2VA。
- 不完整备份不会被当成可用环境。旧版完整 FL2VA 清单可继续使用；部分拷贝或校验失败会停止并报告。

## 首次补齐 Ref2VA（先使用 CPU）

为避免下载期间消耗 GPU 算力，可先使用 2026.07 的高 RAM CPU 会话：挂载 mert Drive，执行内嵌脚本单元格，再运行下面的命令。首次下载只补齐所选分区的缺失文件，并按官方 SHA-256 复用相同权重。

```python
import subprocess, sys
subprocess.run([sys.executable, '-m', 'pip', 'install', 'huggingface_hub'], check=True)
subprocess.run([sys.executable, '-u', '/content/tapnow-h3/cache_model.py', '--partition', 'Ref2VA'], check=True)
```

看到 `DRIVE_BACKUP_COMPLETE` 后，调用 `drive.flush_and_unmount()` 确认上传完成，再结束 CPU 会话。随后切换 G4 GPU、高 RAM、2026.07，以 `MODE='ref2va'`、`ALLOW_DOWNLOAD=False` 按日常流程恢复。不要在 GPU 会话重复启动首次下载后台任务，也不要删除共用文件。CPU 会话约需 145 GiB 模型磁盘空间，还要为下载和 Drive 上传暂存留出空间；脚本会检查空间并等待上传暂存释放。

## 画布功能

- 文字：`t2va`，使用 FL2VA。
- 首尾帧：`fl2va`，使用 FL2VA；支持首帧、尾帧或两者，按首帧／尾帧顺序提交。
- 全能参考：`ref2va`，使用 Ref2VA；最多 9 张图片、3 段视频、3 段音频，合计最多 12 份；视频和音频每段 2–15 秒、同类时长合计不超过 15 秒。单份素材最多 100 MiB。
- 通过画布素材选择器或连线添加素材，输入 @ 素材。按每种素材的顺序转换为 `<Picture N>`、`<Video N>`、`<Audio N>`。
- 带音轨的视频也会提供声音参考。提交时独立音频排在视频之前，保持画布 `<Audio N>` 引用编号稳定；同类素材内部顺序不变。
- 素材通过本地后端上传，Colab 返回素材 ID；不会让云端访问你电脑的 `127.0.0.1`。
- 支持 16:9、9:16、1:1，目标短边 768 或 544。视频模式与质量需在实际 GPU 上验证。
- 不包含独立生图、Ref2VA 混合首尾帧、参考视频截取时间控制、完整托管 2K 流程或量化/Turbo 模型。

## 保存结果与关闭

当前笔记本与本机偏好均已启用自动关闭，保存确认后闲置 60 秒释放 GPU。也可手动关闭：生成成功后，结果卡片显示“已成功生成并保存到本地”，点击“结束 Colab 会话并释放 GPU”。此操作会先重试本地保存确认，再请求关闭。无需回 Colab 页面点击停止。也可在“模型连接 → Colab”勾选“结果保存后自动释放 GPU”。该偏好保存在本机，即使 Colab 已关闭也能修改；新会话连接或提交生成前会自动应用，更新临时地址及重启 TapNow 不会清除。2026-10-31 已按用户要求开启。当前笔记本闲置时间为 60 秒，仍须所有任务结束且结果保存回执确认后才释放。

`AUTO_RELEASE=True` 时，全部任务已结束且本地结果确认后闲置 `IDLE_SECONDS` 秒（最少 30 秒）请求关闭。新提交或上传会重置计时。

本地先完整下载 MP4、同步文件、原子重命名并保存任务记录，然后向 Colab 回传文件大小与 SHA-256。Colab 对照完整传输的校验值确认，之后才允许释放。监视器在 Colab 笔记本进程中先 `drive.flush_and_unmount()`，再 `runtime.unassign()`。

- 提交状态不明、仍在生成、正在下载或没有保存确认：不自动释放。
- 取消接收不会取消 GPU 任务；保留云端结果，直到用户确认如何处理。
- 本地已保存但确认失败：在 Colab 设置点击“重新确认本地结果”。
- 没有任务或所有结果已确认：可点击“结束会话并释放 GPU”。
- 释放失败时查看 Colab 输出，确认保存情况后手动“断开连接并删除运行时”。仅停止模型进程不会释放 GPU。

普通 Colab 仍需手动启动下次会话。临时隧道地址可能变化，更新 TapNow 的连接配置即可。

## 验证范围

2026-10-31 在 mert 的 Colab 2026.07 / G4（RTX PRO 6000 Blackwell 96 GB、高 RAM）完成真实端到端验证：

- 沿用 Drive 的 FL2VA 权重和 Python 环境，无新增模型分区下载。
- TapNow 画布提交文字视频，目标 4 秒、16:9、544p、50 步；本地成片为 960×544、4.458 秒，372,919 字节。点击到可播放约 189.6 秒，其中去噪 50 步约 148 秒。该时间不包括启动 GPU、恢复约 134 GiB 权重和模型加载。
- 本地 MP4 SHA-256：`ec28122ee27ecf013f35b6173add04cae754a38d1dea5e05813784a89b4e6acf`；Colab 保存回执已确认。
- 从结果卡片点击“结束 Colab 会话并释放 GPU”；Drive 已卸载，随后 Colab 会话列表显示“没有正在进行的会话”。本地视频仍可播放。
- FL2VA 的完整出片与画布释放链路已通过；首尾帧、自动闲置释放和其他分辨率仍需各自实测。
- 本次遇到内置浏览器 `getpass` 输入无法提交；复用用户已在 TapNow 设置的同一 Token，通过权限为 0600 的 `/content/.tapnow-h3-token` 临时文件启动，读取后立即删除。笔记本和 Drive 中不保存该 Token。一般情况下继续使用正常隐藏输入框即可。


### Ref2VA 部署状态（2026-10-31）

- mert Drive 已完整缓存 Ref2VA：81 个文件、约 134.16 GiB；其中 16 个文件、约 72.40 GiB 通过 `source_path` 复用 FL2VA 相同 SHA-256 的权重，新增约 61.76 GiB。双分区完整清单已核验，首次 CPU 准备后已成功刷新并卸载 Drive。
- G4 2026.07 高 RAM 会话已从 Drive 恢复并启动 Ref2VA；TapNow 显示“Ref2VA · 全能参考 · 就绪”。恢复约 23 分钟，模型启动约 6 分钟；这些时间均占用已分配的 GPU。
- 画布成功提交图片、视频、音频各一份的真实请求，目标 4 秒、16:9、544p、50 步，已进入去噪阶段。用户要求跳过验证后，停止本地接收并从 Colab 结束运行时。没有交付 Ref2VA 成片，也未验证本次完整生成后的画布释放链路。
- 画布已支持结果落盘确认后手动或自动请求释放 GPU；这个机制之前在 FL2VA 上实测通过。Ref2VA 本次仅验证到服务连接与真实任务接收阶段。
- 新版笔记本提供 Ref2VA 与 FL2VA 两套中文选择入口，默认选中全能参考，并提供只读进度检查单元格。日常从 Drive 恢复时保持 `ALLOW_DOWNLOAD=False`、`INSTALL_ENV=False`、`SAVE_ENV=False`。

本地自动化测试使用模拟推理接口，覆盖参考素材上传、独立音频编号、任务映射、文件保存确认、失败时不释放、断点恢复与未授权访问。它们不生成真实视频；Drive Ref2VA 缓存完整性由本次实际清单与逐文件校验确认。

- `node --test tests/*.test.mjs`
- 在包含 FastAPI/httpx 的 Python 环境中执行 `python tests/colab-session.test.py`
- `python tests/colab-cache.test.py`
- `python scripts/build-colab-notebook.py`
- `npm run build`
