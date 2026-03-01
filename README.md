# AI-NovelSpeaker-V1

[简体中文](README.md) | [繁體中文](README.zh-TW.md) | [English](README.en-US.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md)

多小说管理与有声生成工具（SQLite + 本地文件存储 + ComfyUI + LLM）。

## 视频介绍

- B站：https://www.bilibili.com/video/BV1vXP3znEAT
- YouTube：https://youtu.be/FI28PpHUGAY

## 功能概览

- 小说管理：创建/编辑/删除、统计、打包下载（真实 ZIP）
- 章节管理：章节 CRUD、JSON 转换、音频生成、音频播放/下载
- 任务队列：JSON 任务队列、有声任务队列、全部终止、删除非 running 有声任务
- 提示词与工作流：系统/用户模板管理，支持复制为用户模板
- 系统配置：ComfyUI 地址、LLM 参数、每批文本字数上限、UI 语言/时区
- 多语言界面：`zh-CN` / `zh-TW` / `en-US` / `ja-JP` / `ko-KR`

## 目录说明

- `app_server.py`：服务入口
- `server/startup.py`：启动流程
- `server/http_handler.py`：HTTP 路由
- `server/services.py`：核心服务实现
- `scripts/init_storage.py`：初始化数据库与目录
- `prompts/xhz_system_prompt.txt`：系统提示词文件
- `prompts/xhz_system_workflow_api.txt`：系统工作流文件（文本 JSON）
- `debug/qwen3_tts_workflow_debug.json`：ComfyUI 调试用 Qwen3 TTS 工作流
- `output/`：本地导出目录（保留目录本身，忽略目录内生成文件）

## 平台安装与启动

### 通用前置

- Python 3.10+（建议 3.11/3.12/3.13）
- 可选：ComfyUI（用于音频生成）

### 获取代码

```bash
git clone git@github.com:qzw881130/AI-NovelSpeaker-V1.git
# 或者: git clone https://github.com/qzw881130/AI-NovelSpeaker-V1.git
cd AI-NovelSpeaker-V1
```

### macOS / Linux

```bash
chmod +x start.sh
./start.sh
```

查看帮助：

```bash
./start.sh --help
```

自定义端口（可选）：

```bash
./start.sh --port=8081
```

### Windows

直接双击 `start.bat`，或在 cmd / PowerShell 中执行：

```bat
start.bat
```

查看帮助：

```bat
start.bat --help
```

自定义端口（可选）：

```bat
start.bat --port=8081
```

## 启动脚本行为

`start.sh` / `start.bat` 会自动：

1. 检查并结束占用 `8080` 端口的旧进程
2. 若 `data/novels.db` 不存在，先执行初始化
3. 启动服务并打印可访问地址：
   - 本地地址：`http://127.0.0.1:8080/index.html`
   - 局域网地址：`http://<LAN_IP>:8080/index.html`

## 手动启动（可选）

首次初始化：

```bash
python3 scripts/init_storage.py
```

启动服务：

```bash
python3 app_server.py
```

## 打包下载规则（Download Bundle）

- ZIP 文件会先落盘到本地 `output/` 目录
- ZIP 文件名格式：`{小说英文名}-{YYYY-MM-dd_HHmm}.zip`
- 解压后不包含 `output/` 目录层级，结构为：
  - `{小说英文名}/audio/*.flac`
  - `{小说英文名}/text/*.txt`
- 文件命名规则：`章节编号_章节名`
  - 音频：`001_第一章_落日.flac`
  - 文本：`001_第一章_落日.txt`

## Windows 兼容性说明

- 项目核心路径使用 `pathlib.Path`，并在数据库中统一保存为 `/` 分隔符（`as_posix`），避免 Windows `\` 分隔符导致的前端路径显示/接口兼容问题。
- 静态页和 API 路由均使用 URL 标准 `/` 分隔符。
- `start.bat` 已增强局域网地址识别（优先 PowerShell，失败回退 `ipconfig` 解析）。

## ComfyUI 依赖说明（Qwen3 TTS）

### 调试工作流文件

- 推荐调试文件：`debug/qwen3_tts_workflow_debug.json`

### 需要的第三方节点（仅列第三方）

| 插件（第三方） | 仓库 | 本项目工作流使用到的节点 |
| --- | --- | --- |
| ComfyUI-TD-Qwen3TTS | [AICoderTudou/ComfyUI-TD-Qwen3TTS](https://github.com/AICoderTudou/ComfyUI-TD-Qwen3TTS) | `TDQwen3TTSModelLoader`、`TDParseJson`、`TDQwen3TTSBatchGenerateSpeaker`、`TDQwen3TTSMultiDialog` |
| comfyui-various | [jamesWalker55/comfyui-various](https://github.com/jamesWalker55/comfyui-various) | `JWString` |
| ComfyUI_Comfyroll_CustomNodes | [Suzie1/ComfyUI_Comfyroll_CustomNodes](https://github.com/Suzie1/ComfyUI_Comfyroll_CustomNodes) | `CR Text` |
| Comfyui-Memory_Cleanup | [LAOGOU-666/Comfyui-Memory_Cleanup](https://github.com/LAOGOU-666/Comfyui-Memory_Cleanup) | `RAMCleanup`、`VRAMCleanup` |

### 需要的 TTS 模型（按当前工作流）

- `Qwen/Qwen3-TTS-12Hz-1.7B-Base`
- `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`

## 页面入口

- `index.html`：小说管理
- `chapters.html`：章节管理
- `json-tasks.html`：JSON 任务
- `audio-queue.html`：有声队列
- `prompts.html`：提示词管理
- `workflows.html`：工作流管理
- `settings.html`：系统配置
- `novel-capture.html`：小说抓取
