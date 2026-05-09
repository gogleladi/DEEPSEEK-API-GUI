# DeepSeek UI
<img width="1087" height="755" alt="image" src="https://github.com/user-attachments/assets/2b624d20-1572-4739-a924-78a3262ac545" />

基于 **Electron** + **React** + **TypeScript** 的 DeepSeek 对话桌面客户端，支持流式回复、思考过程（reasoning）、多会话与本地持久化。

> 本项目为第三方开源客户端，与 DeepSeek 官方无隶属关系。调用 API 需自行准备有效的 API Key，并遵守服务商条款。

## 功能概览

- **多会话**：左侧会话列表，新建 / 切换 / 删除对话。
- **流式输出**：正文与思考内容实时追加；向上滚动阅读历史时不会强行拉回底部，回到底部或发送新消息后恢复跟随最新输出。
- **Markdown**：助手回复使用 Markdown 渲染（含代码高亮、GFM 等）。
- **图片**：支持粘贴 / 拖拽图片（需选用支持视觉的模型，如 `deepseek-v4-pro`）。
- **设置**：API Key、Base URL、模型名、系统提示词、思考模式开关、浅色 / 深色主题。
- **本地存储**：设置与聊天记录保存在系统用户目录下的 JSON 文件中（见下文）。

## 环境要求

- **Node.js** 建议 LTS（如 20.x）
- **Windows x64**（当前 `electron-builder` 配置为便携版 + NSIS 安装包）

## 快速开始

```bash
npm install
npm run dev
```

首次使用请在应用内打开 **设置**，填写 **API Key**（及按需修改 Base URL / 模型），保存后即可对话。

开发模式下会启动 Vite（默认 `http://127.0.0.1:5173`）并打开 Electron 窗口。

### 输入快捷键

- **Enter**：发送消息  
- **Shift + Enter**：换行  

## npm 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发：Vite + Electron（热更新前端） |
| `npm run build:renderer` | 仅构建前端到 `dist/` |
| `npm run icon:build` | 将 `public/favicon.svg` 栅格化为 `build/icon.png`（打包与窗口图标用） |
| `npm run start` | 使用已有 `dist/` 启动 Electron（需先执行 `build:renderer`） |
| `npm run pack` | 构建前端 + 图标，输出未封装目录到 `release/` |
| `npm run dist` | 构建前端 + 图标，生成 Windows 安装包与便携版（见 `release/`） |

修改图标时：编辑 **`public/favicon.svg`**，然后执行 `npm run icon:build`（`dist` / `pack` 已包含该步骤）。

## 打包产物

执行 `npm run dist` 后，在 **`release/`** 目录可得到例如：

- **便携版**：`DeepSeek UI <版本>.exe`
- **安装程序**：`DeepSeek UI Setup <版本>.exe`

未配置代码签名时，构建日志中出现「跳过签名」属正常现象。

## 本地数据位置

Electron **`userData`** 目录下：

- `settings.json` — API Key、模型、主题等设置  
- `chats.json` — 会话与消息  

具体路径因系统而异；在 Windows 上通常在 `%APPDATA%` 下与应用名称相关的文件夹中。

## 技术栈

- **界面**：React 19、Vite 6、TypeScript  
- **桌面**：Electron 35、`electron-builder`  
- **渲染**：`react-markdown`、`remark-gfm`、`highlight.js`  

## 项目结构（简要）

```
deepseekUI/
├── electron/           # 主进程、preload、聊天流式请求等
├── public/             # 静态资源（如 favicon.svg）
├── scripts/            # 构建脚本（图标栅格化）
├── src/                # React 应用源码
├── build/              # 打包资源（由 icon:build 生成的 icon.png）
├── dist/               # Vite 构建输出（由 build:renderer 生成）
└── release/            # electron-builder 输出目录
```

## 开源许可

以仓库根目录中的 **LICENSE** 文件为准（若尚未添加，可自行补充后再分发或二次开发）。
