# Dev Notes MCP

一个轻量级 MCP (Model Context Protocol) Server，专为 **GitHub Copilot** 设计。

把随手记录的 txt 笔记自动分类为 **笔记 / 问题 / 待办任务**，支持标记完成，支持在 Copilot 对话中查询待处理项。

## 功能

| 工具 | 说明 |
|------|------|
| `import_text` | 导入文本，自动解析分类为笔记、问题、待办 |
| `list_pending` | 列出所有未解决问题 + 未完成任务 |
| `mark_done` | 标记问题已解决 / 任务已完成 |
| `list_items` | 按类型和状态查看条目 |
| `get_summary` | 统计概览 + 待处理明细 |
| `add_item` | 手动添加单条笔记/问题/任务 |
| `clear_all` | 清空所有数据 |

## 安装

### 方式一：npm 安装（推荐）

在 VS Code 工作区创建 `.vscode/mcp.json`：

```json
{
  "servers": {
    "dev-notes": {
      "command": "npx",
      "args": ["-y", "dev-notes-mcp"]
    }
  }
}
```

### 方式二：从 GitHub 安装

```json
{
  "servers": {
    "dev-notes": {
      "command": "npx",
      "args": ["-y", "github:你的用户名/dev-notes-mcp"]
    }
  }
}
```

### 方式三：本地安装

```bash
git clone https://github.com/你的用户名/dev-notes-mcp.git
cd dev-notes-mcp
npm install && npm run build
```

然后在 `mcp.json` 中指定本地路径：

```json
{
  "servers": {
    "dev-notes": {
      "command": "node",
      "args": ["/path/to/dev-notes-mcp/dist/index.js"]
    }
  }
}
```

## 使用方式

安装后，在 VS Code 中打开 GitHub Copilot Chat，直接对话即可：

### 导入 txt 文件

```
@dev-notes 帮我导入这个文件 @notes.txt
```

Copilot 会读取文件内容并调用 `import_text` 工具，自动分类。

### 查询待处理项

```
@dev-notes 还有哪些任务没完成？
@dev-notes 还有什么问题没解决？
```

### 标记完成

```
@dev-notes 标记问题Q1已解决
@dev-notes 完成任务T3
```

### 查看笔记

```
@dev-notes 看看我的笔记
@dev-notes 列出所有任务
```

### 手动添加

```
@dev-notes 记一下：TCP三次握手 SYN→SYN-ACK→ACK
@dev-notes 有个问题：为什么需要网关？
@dev-notes 待办：明天部署服务
```

## 解析规则

工具会自动识别以下格式：

### 行内标记

| 格式 | 分类 |
|------|------|
| `问题：xxx` / `Q: xxx` / `xxx？` | 问题 |
| `待办：xxx` / `TODO: xxx` / `任务：xxx` | 任务 |
| `知识点：xxx` / `笔记：xxx` | 笔记 |
| `- [ ] xxx` | 任务（未完成） |
| `- [x] xxx` | 任务（已完成，自动标记） |
| `需要xxx` / `记得xxx` | 任务 |
| `为什么xxx` / `如何xxx` | 问题 |
| 其他文本 | 笔记 |

### Markdown 分区

```
## 问题
什么是gRPC？
为什么需要三次握手？

## 待办
完成API文档
准备周会汇报

## 笔记
RESTful API设计原则
HTTP状态码 200=成功
```

分区内的所有行自动归入对应分类。

## 数据存储

所有数据存储在 `~/.dev-notes-mcp/store.json`，JSON 格式。

结构示例：

```json
{
  "notes": [
    { "id": 1, "content": "今天学习了TCP三次握手", "created": "2026-08-23T..." }
  ],
  "questions": [
    { "id": 1, "content": "为什么需要三次握手？", "resolved": false, "created": "..." }
  ],
  "tasks": [
    { "id": 1, "content": "写网络协议总结", "done": false, "created": "..." }
  ],
  "counters": { "notes": 1, "questions": 1, "tasks": 1 }
}
```

> 不需要手动编辑 JSON — 使用下面的 Dashboard 可视化界面操作。

## Dashboard 可视化界面

不想每次都通过 Copilot 标记完成？直接用浏览器！

### 启动 Dashboard

```bash
# 方式一：npx（无需安装）
npx dev-notes-mcp --dashboard

# 方式二：本地运行
npm run dashboard

# 指定端口
npx dev-notes-mcp --dashboard --port 8080
```

启动后自动打开浏览器，访问 `http://localhost:3456`。

### 界面功能

- **查看全部** — 笔记、问题、任务分卡片展示，带统计数字
- **直接勾选** — 点击问题/任务左侧的复选框即可标记完成/取消完成
- **新增条目** — 顶部表单选择类型 + 输入内容 + 回车
- **删除条目** — hover 后点 ✕ 按钮
- **自动刷新** — 每 5 秒自动同步（Copilot 修改的数据会实时反映）

### Dashboard 与 Copilot 的关系

两者共享同一个 `store.json`：

```
Copilot 导入 txt → store.json ← Dashboard 勾选/新增
     ↕                              ↕
  MCP 模式                     HTTP 模式
  (stdio)                    (localhost:3456)
```

- Copilot 导入数据后，Dashboard 立即可见
- Dashboard 勾选完成后，Copilot 查询 `list_pending` 时也会反映

## 技术细节

- **运行时**：Node.js >= 18
- **协议**：MCP (Model Context Protocol) over stdio
- **依赖**：@modelcontextprotocol/sdk
- **存储**：本地 JSON 文件，无需数据库

## License

MIT
