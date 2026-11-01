from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]/'colab'
files={p.name:p.read_text() for p in sorted(root.iterdir()) if p.suffix in ('.py','.sh')}
def cell(kind,text):
 d={'cell_type':kind,'metadata':{},'source':text.splitlines(keepends=True)}
 if kind=='code':d.update(execution_count=None,outputs=[])
 return d
cells=[cell('markdown','''# MiniMax H3 → TapNow Local：按需启动与结果保存后释放 GPU

在 Colab 右上角以及 Drive 挂载授权页都选择 **mert** 账号。
运行前在「代码执行程序 → 更改运行时类型」选择 **2026.07、G4 GPU、高 RAM**。本次验证该版本可挂载 mert Drive；最新 Python 3.13 环境曾出现挂载失败。
现有 BF16 部署沿用 SGLang，适用于 80 GB 级 GPU、至少 120 GiB 系统内存；实际生成性能仍需当前硬件验证。
每次只启动一个模式：FL2VA（文字／首尾帧）或 Ref2VA（图片、视频、音频全能参考）。切换模式需要结束本次会话并重新启动。
默认仅从 Drive 恢复，不下载缺失权重、不运行测速。首次补齐 Ref2VA 时打开 ALLOW_DOWNLOAD；首次安装或修复环境时打开 INSTALL_ENV。
独立生图和完整托管 2K 工作流不包含在本部署内。
'''),cell('code','''# 日常只需修改本单元格。
MODE = 'ref2va'  # 'ref2va' 全能参考；'fl2va' 文字／首尾帧
CONFIRMED_MERT_ACCOUNT = False  # 核对右上角和挂载授权账号后改为 True
ALLOW_DOWNLOAD = False  # 仅首次补齐所选分区时打开，会占用 Drive 和本地磁盘
INSTALL_ENV = False  # 已有完整环境备份时保持 False
SAVE_ENV = False  # 首次安装成功后可打开，保存环境供后续恢复
AUTO_RELEASE = False  # 默认在 TapNow 结果卡片手动关闭；也可在连接设置打开自动释放
IDLE_SECONDS = 60  # 至少 30 秒；新任务会重置倒计时
OPEN_AUTHENTICATED_TUNNEL = True  # 临时 HTTPS 地址，仅凭访问 Token 可调用
assert CONFIRMED_MERT_ACCOUNT, '请先核对账号为 mert，再继续'
'''),cell('code', '''from google.colab import drive
drive.mount('/content/drive')
from pathlib import Path
print('部署目录存在：', Path('/content/drive/MyDrive/TapNowLocal').exists())
print('环境备份存在：', Path('/content/drive/MyDrive/TapNowLocal/session/h3-venv.tar.gz').exists())
'''),cell('markdown','内嵌脚本由项目文件统一生成，避免笔记本和独立脚本版本不一致。'),cell('code',"import pathlib, sys\nh3_files = "+repr(files)+"\nh3_dir = pathlib.Path('/content/tapnow-h3')\nh3_dir.mkdir(exist_ok=True)\nfor name, source in h3_files.items():\n    (h3_dir/name).write_text(source)\nsys.path.insert(0, str(h3_dir))\nprint('Deployment helpers ready')\n"),cell('code', '''# 将子进程输出写入日志，定期显示进度，避免长时间直接输出阻塞页面。
import os, signal, subprocess, sys, time
import notebook_session as h3
prepare_log = pathlib.Path('/content/h3-prepare.log')
prepare_code = ('import sys; sys.path.insert(0, "/content/tapnow-h3"); '
                'import notebook_session as h3; '
                f'h3.prepare({MODE!r}, allow_download={ALLOW_DOWNLOAD!r}, install_env={INSTALL_ENV!r}); '
                + ('h3.save_environment()' if SAVE_ENV else ''))
with prepare_log.open('w') as output:
    prepare_process = subprocess.Popen([sys.executable, '-u', '-c', prepare_code],
                                       stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
try:
    seen = ''
    while prepare_process.poll() is None:
        progress = prepare_log.read_text(errors='replace')[-2000:]
        if progress != seen:
            print(progress or '正在恢复环境和权重…', flush=True)
            seen = progress
        time.sleep(10)
    print(prepare_log.read_text(errors='replace')[-4000:])
    if prepare_process.returncode:
        raise RuntimeError('恢复失败，请查看上方日志；不要继续启动模型。')
except BaseException:
    if prepare_process.poll() is None:
        os.killpg(prepare_process.pid, signal.SIGTERM)
        prepare_process.wait(timeout=15)
    raise
'''),cell('markdown','''启动会等待模型健康检查。首次加载可能需要较长时间，加载也消耗算力。
输入一个至少 32 字符的临时 Token，同一 Token 填入 TapNow「模型连接 → Colab」。不要把 Token 写进单元格或共享输出。
'''),cell('code','''import getpass, pathlib
import notebook_session as h3
_token_file = pathlib.Path('/content/.tapnow-h3-token')
if _token_file.is_file():
    h3_token = _token_file.read_text()
    _token_file.unlink()
else:
    h3_token = getpass.getpass('临时访问 Token（至少 32 字符）：')
h3.start(MODE, h3_token, auto_release=AUTO_RELEASE, idle_seconds=IDLE_SECONDS,
         open_tunnel=OPEN_AUTHENTICATED_TUNNEL)
'''),cell('code','''import re, time
log = pathlib.Path('/content/h3-tunnel.log')
for _ in range(30):
    text = log.read_text() if log.exists() else ''
    urls = re.findall(r'https://[a-z0-9-]+\\.trycloudflare\\.com', text)
    if urls:
        print('TapNow Colab 服务地址：', urls[-1])
        break
    if not OPEN_AUTHENTICATED_TUNNEL:
        print('未开启隧道')
        break
    time.sleep(2)
else:
    print('隧道尚未就绪，请检查 /content/h3-tunnel.log')
'''),cell('markdown','''## 使用与关闭

在 TapNow「模型连接 → Colab」填写上面的地址和 Token，保存并连接。
- FL2VA：选择文字或首尾帧，可上传首帧、尾帧或两者。
- Ref2VA：选择全能参考，上传图片／视频／音频，用 @ 素材指定对应关系。
- 当前会话模式不匹配时，画布会拒绝提交，提示到 Colab 切换。

全部任务完成且本地确认文件大小和校验值后，闲置设定时间自动请求释放；笔记本先完成 Drive 写入并卸载，再释放运行环境。
取消接收、提交状态不明或下载失败不会自动释放，以免丢失结果。结果已经在本地但确认失败时，在 Colab 连接设置点击“重新确认本地结果”。
没有任务时也可点击“结束会话并释放 GPU”。若笔记本报告释放失败，检查文件保存情况，再手动“断开连接并删除运行时”。只停模型进程不会停止 GPU 额度消耗。
下次会话必须重新开 GPU、挂载 mert Drive、恢复并启动；临时域名和 Token 可重新设置。
''')]

# Keep both presets in one notebook; one selected model per GPU session.
cells[0] = cell('markdown', '# MiniMax H3 · 两套启动入口 → TapNow Local\n\n两套权重都已完整备份到 **mert 的 Google Drive**。每次只选一套启动，无需重新下载。\n\n### A · 全能参考（Ref2VA）\n图片、视频、音频可以混合参考。画布选择 **Colab → 全能参考**。\n\n### B · 首尾帧／文字（FL2VA）\n支持首帧、尾帧或首尾两张图片，也支持不带参考图的文字生成。画布选择 **Colab → 首尾帧**，或 **文字**。\n\n## 每次使用的步骤\n1. 右上角选择 **mert**；「代码执行程序 → 更改运行时类型」使用 **2026.07、G4 GPU、高 RAM**。\n2. 在下面 **① 两套启动入口** 的下拉框选择 A 或 B，并勾选账号确认项。切换模型前先结束旧会话。\n3. 按顺序运行 **② 挂载 Drive → 部署脚本 → ③ 恢复所选模型 → ④ 启动服务 → ⑤ 获取本次 HTTPS 地址**。只读进度检查是可选项。\n4. 把 **⑤ 的新输出地址**复制到 TapNow「模型连接 → Colab」，沿用相同 Token，点击「保存并连接」。旧输出地址不可直接复用。\n5. 所有任务结束、结果保存到本地并确认后，默认闲置 **60 秒**自动释放 GPU；TapNow 已保存的自动释放偏好也会在连接或生成时应用。\n\n**Drive 缓存：** `MyDrive/TapNowLocal/models/MiniMax-H3/42ed227ee7df40d41602854ae760620d6eb651fe/`。清单包含 `FL2VA` 和 `Ref2VA` 两个完整分区。相同的文本编码器及 VAE 权重通过清单共用，不要单独删除 FL2VA 文件夹。\n\n恢复和加载也会占用 GPU 时间。当前原始权重配置使用 80 GB 级 GPU、至少 120 GiB 系统内存；不包含独立生图或完整托管 2K 工作流。Ref2VA 的完整出片验证已按用户要求跳过。\n')
cells[1] = cell('code', '# @title ① 两套启动入口：选择本次要用的模型\n# @markdown **选择本次要启动的一套模型：**\nMODEL_SET = "全能参考（Ref2VA）" # @param ["全能参考（Ref2VA）", "首尾帧／文字（FL2VA）"]\n# @markdown **确认右上角及 Drive 授权账号都是 mert，再勾选下项：**\nCONFIRMED_MERT_ACCOUNT = False # @param {type:"boolean"}\n# @markdown **生成结果全部保存确认后，自动关闭 Colab 并释放 GPU：**\nAUTO_RELEASE = True # @param {type:"boolean"}\n# @markdown **保存确认后等待的秒数（默认 60）：**\nIDLE_SECONDS = 60 # @param {type:"integer"}\n\n# CONFIRMED_MERT_ACCOUNT：核对右上角和挂载授权账号为 mert 后勾选。\n# AUTO_RELEASE：全部任务结束且本地保存确认后，闲置指定秒数释放 GPU。\n# 两套均已缓存到 Drive；日常不要开启重新下载或安装。\nMODE = {"全能参考（Ref2VA）": "ref2va", "首尾帧／文字（FL2VA）": "fl2va"}[MODEL_SET]\nALLOW_DOWNLOAD = False\nINSTALL_ENV = False\nSAVE_ENV = False\nOPEN_AUTHENTICATED_TUNNEL = True\nassert CONFIRMED_MERT_ACCOUNT, \'请确认右上角与挂载授权账号都是 mert，再勾选账号确认项\'\nassert IDLE_SECONDS >= 30, \'自动释放闲置时间至少 30 秒\'\nprint(\'本次启动：\', MODEL_SET)\nprint(\'权重来源：mert Drive 已有缓存；仅恢复本次所选的一套\')\n')
cells[1]['metadata']['cellView'] = 'form'
cells[2]['source'].insert(0, '# @title ② 挂载 mert Drive（两套模型共用）\n')
cells[5]['source'].insert(0, '# @title ③ 从 Drive 恢复所选模型和环境\n')
cells[7]['source'].insert(0, '# @title ④ 启动所选模型、认证服务和自动释放监视器\n')
cells[8]['source'].insert(0, '# @title ⑤ 获取本次 HTTPS 地址（复制到 TapNow）\n')
cells.insert(3, cell('code', r'''# 只读进度检查：不会启动下载、推理或释放 GPU
from pathlib import Path
import re, shutil
print('本地剩余 GiB:', round(shutil.disk_usage('/content').free/1024**3,1))
model_log=Path('/content/h3-model.log')
if model_log.exists():
    log_text=model_log.read_text(errors='replace')
    progress=re.findall(r'[0-9]+%\|[^\r\n]{0,130}',log_text)
    if progress:
        print('最新加载/生成进度:',progress[-1].split('[2026-')[0])
    events=[line for line in log_text.splitlines() if 'Stage]' in line or 'Application startup complete' in line or 'Error' in line or 'Exception' in line]
    print(chr(10).join(events[-6:]))
else:
    for name in ('ref2va-cache','h3-prepare'):
        p=Path('/content/'+name+'.log')
        if p.exists():
            print(name+':',p.read_text(errors='replace')[-1200:])
'''))
nb={'cells':cells,'metadata':{'colab':{'name':'MiniMax-H3-TapNow-Local.ipynb','machine_shape':'hm','gpuType':'G4','runtime_attributes':{'runtime_version':'2026.07'}},'accelerator':'GPU','kernelspec':{'display_name':'Python 3','name':'python3'},'language_info':{'name':'python'}},'nbformat':4,'nbformat_minor':5}
(root/'MiniMax-H3-TapNow-Local.ipynb').write_text(json.dumps(nb,ensure_ascii=False,indent=1)+'\n')
