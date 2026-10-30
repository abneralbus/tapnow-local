# 可选：Colab 视频服务

Flow / Muse 不需要 Colab。本目录保留原生 MiniMax H3 部署与缓存脚本，作为实验性接入；不自动申请 GPU，也不承诺云端资源或推理速度。

1. 将 `colab/MiniMax-H3-TapNow-Local.ipynb` 上传到自己的 Colab。
2. 按 Notebook 单元格说明准备 GPU、安装依赖、挂载自己的 Drive，并运行权重缓存。观察实际 GPU/显存，不能假定每次分配相同硬件。
3. 下载使用 `MiniMaxAI/MiniMax-H3` 的固定 revision 和 FL2VA 分区，约 134 GiB；Drive 至少预留约 145 GB，安装和临时复制还需要额外本地磁盘。
4. 等 `MODEL_READY_ON_LOCAL_SSD` 后启动模型；备份只有出现 `DRIVE_BACKUP_COMPLETE` 且生成完整校验清单才算完成。
5. 模型端口 30020，原生 broker 使用 30021；认证代理使用 30011，不要重叠。
6. 按 Notebook 建立认证代理及隧道，在画布的 Colab 配置填写自己的 HTTPS 地址和 Token。Token 不写入公开 Notebook，不上传 `.env` 或 `data/config.json`。
7. 先健康检查，再执行自己的生成与测速。当前画布路径使用文生视频；图片输入、尾帧、VDN 加速不算已完成适配。

下次 Colab 会话先重新挂载 Drive，恢复已校验权重到运行时 SSD，再启动模型。不要把 Drive 文件夹当作已经成功加载到显存。退出前按 Notebook 执行备份并等待完成，再 flush/unmount Drive。

旧会话的 GPU、耗时与登录状态不随这个仓库分享；新的用户与硬件需要重新验证。相关脚本：`cache_model.py`、`start_model.sh`、`auth_proxy.py`、`benchmark.py`、`session_backup.sh`、`session_restore.sh`。
