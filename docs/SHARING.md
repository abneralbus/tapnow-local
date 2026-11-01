# 分享与 GitHub 发布

## 使用哪个目录

完整使用版包含 `data/`，是私人工作目录。分享候选目录由 `scripts/export-share.py` 生成，才用于仓库准备。ZIP 中也只包含分享目录中的源码。

导出会排除：`.env`、运行数据、账号 Cookie、浏览器配置、API 密钥、生成图像/视频、数据库、日志、历史核查笔记、截图、node_modules、venv、dist、符号链接。Notebook 输出和运行元数据会清空。示例配置保留，但不能把个人凭据写入示例文件。

允许列表是文件范围控制，不能识别被人手工写进源码的所有秘密。发布前仍要查看 Git 的暂存内容，尤其是自己新增的配置、Notebook 源代码与示例。

## 发布前还有许可证事项

`vendor/flowboard` 当前导入版本没有正式 LICENSE，上游 README 写的是 “MIT (proposed — license file pending)”。来源见 https://github.com/crisng95/flowboard 。本包保留这项未解决事实，**不为该代码补写或代发许可证**。公开再分发前，应取得上游明确许可或换用许可明确的版本；本候选版不应直接被标为全量 MIT。

`vendor/muse2api` 保留原 MIT LICENSE 与来源说明。自有代码的开源许可证应由发布者选定并添加，且明确第三方目录继续适用各自条款。

## 上传流程

完成许可证确认后，在干净分享目录运行：

```sh
git init
git add .
git status --short
git diff --cached --stat
# 检查暂存内容，确保没有个人配置、账号、素材

git commit -m "Initial source release"
git branch -M main
# 在 GitHub 创建自己的空仓库；将下面地址替换为自己的仓库
git remote add origin https://github.com/YOUR_NAME/YOUR_REPOSITORY.git
git push -u origin main
```

本次整理不会替你创建 GitHub 仓库、推送代码或公开数据。

## 新用户实际需要做什么

克隆 → `npm run setup` → `npm start` 打开画布 → 按 MEDIA-BRIDGE.md 配置自己的 Flow 项目、扩展与 Muse Cookie → 启动媒体桥接 → 实际测试生成。

复制代码不会复制订阅额度、上游使用资格或作者登录态。当前流程不支持零配置使用他人的账号，也不能保证上游网页接口永远不变。

## 更新已有仓库

已关联远端的工作目录可以直接提交源代码改动。提交前检查 `git status` 和暂存差异；`.gitignore` 会排除本地数据、依赖、运行环境、缓存、账号文件和密钥文件。不要手工强制添加这些文件。

旧版 Flow 积分查询不再在源码中包含 Google API Key；如需使用，在本地环境文件中设置 `FLOWBOARD_FLOW_API_KEY`。当前 Flow 传输的正常生成不依赖这项可选配置。密钥禁止填入 `.env.example` 或 Notebook。

忽略规则与分享导出都不能清除已经存在于历史提交中的内容；更新提交只移除当前版本的硬编码值，不重写远端历史。
