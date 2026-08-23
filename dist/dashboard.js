/**
 * Dashboard — 可视化界面
 *
 * 用户运行 `dev-notes-mcp --dashboard` 启动本地 HTTP 服务器，
 * 在浏览器中直接查看和操作笔记/问题/任务，无需通过 Copilot。
 */
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { exec } from "node:child_process";
// ==================== 共享存储（与 index.ts 一致） ====================
const STORAGE_DIR = path.join(os.homedir(), ".dev-notes-mcp");
const STORAGE_FILE = path.join(STORAGE_DIR, "store.json");
function loadStore() {
    try {
        if (!fs.existsSync(STORAGE_DIR))
            fs.mkdirSync(STORAGE_DIR, { recursive: true });
        if (!fs.existsSync(STORAGE_FILE)) {
            const empty = { notes: [], questions: [], tasks: [], counters: { notes: 0, questions: 0, tasks: 0 } };
            saveStore(empty);
            return empty;
        }
        const data = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8"));
        if (!data.notes)
            data.notes = [];
        if (!data.questions)
            data.questions = [];
        if (!data.tasks)
            data.tasks = [];
        if (!data.counters)
            data.counters = { notes: 0, questions: 0, tasks: 0 };
        return data;
    }
    catch {
        return { notes: [], questions: [], tasks: [], counters: { notes: 0, questions: 0, tasks: 0 } };
    }
}
function saveStore(store) {
    if (!fs.existsSync(STORAGE_DIR))
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(store, null, 2), "utf-8");
}
function nowISO() { return new Date().toISOString(); }
// ==================== API 逻辑 ====================
function toggleItem(type, id) {
    const store = loadStore();
    if (type === "question") {
        const item = store.questions.find((q) => q.id === id);
        if (!item)
            return { success: false, message: `问题 Q${id} 不存在` };
        item.resolved = !item.resolved;
        item.resolvedAt = item.resolved ? nowISO() : undefined;
        saveStore(store);
        return { success: true, message: `问题 Q${id} 已${item.resolved ? "解决" : "重新打开"}` };
    }
    else {
        const item = store.tasks.find((t) => t.id === id);
        if (!item)
            return { success: false, message: `任务 T${id} 不存在` };
        item.done = !item.done;
        item.doneAt = item.done ? nowISO() : undefined;
        saveStore(store);
        return { success: true, message: `任务 T${id} 已${item.done ? "完成" : "重新打开"}` };
    }
}
function deleteItem(type, id) {
    const store = loadStore();
    let arr;
    let label;
    if (type === "note") {
        arr = store.notes;
        label = `N${id}`;
    }
    else if (type === "question") {
        arr = store.questions;
        label = `Q${id}`;
    }
    else {
        arr = store.tasks;
        label = `T${id}`;
    }
    const idx = arr.findIndex((item) => item.id === id);
    if (idx === -1)
        return { success: false, message: `${label} 不存在` };
    arr.splice(idx, 1);
    saveStore(store);
    return { success: true, message: `${label} 已删除` };
}
function addItem(type, content) {
    const store = loadStore();
    const now = nowISO();
    if (type === "note") {
        store.counters.notes++;
        store.notes.push({ id: store.counters.notes, content, created: now });
        saveStore(store);
        return { success: true, message: `已添加笔记 N${store.counters.notes}` };
    }
    else if (type === "question") {
        store.counters.questions++;
        store.questions.push({ id: store.counters.questions, content, resolved: false, created: now });
        saveStore(store);
        return { success: true, message: `已添加问题 Q${store.counters.questions}` };
    }
    else {
        store.counters.tasks++;
        store.tasks.push({ id: store.counters.tasks, content, done: false, created: now });
        saveStore(store);
        return { success: true, message: `已添加任务 T${store.counters.tasks}` };
    }
}
// ==================== Dashboard HTML ====================
function getDashboardHTML() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dev Notes Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #f0f2f5;
    color: #1a1a2e;
    line-height: 1.6;
    padding: 20px;
  }
  .container { max-width: 1000px; margin: 0 auto; }

  /* Header */
  .header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;
    padding: 24px 30px;
    border-radius: 12px;
    margin-bottom: 20px;
    box-shadow: 0 4px 15px rgba(102,126,234,0.3);
  }
  .header h1 { font-size: 24px; margin-bottom: 8px; }
  .header .subtitle { font-size: 14px; opacity: 0.85; }
  .stats { display: flex; gap: 20px; margin-top: 16px; flex-wrap: wrap; }
  .stat {
    background: rgba(255,255,255,0.15);
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 14px;
  }
  .stat .num { font-size: 20px; font-weight: 700; }
  .stat .label { font-size: 12px; opacity: 0.8; }

  /* Add form */
  .add-form {
    background: #fff;
    padding: 16px 20px;
    border-radius: 12px;
    margin-bottom: 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .add-form select {
    padding: 10px 14px;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    font-size: 14px;
    background: #fff;
    cursor: pointer;
    transition: border-color 0.2s;
  }
  .add-form select:focus { border-color: #667eea; outline: none; }
  .add-form input[type="text"] {
    flex: 1;
    min-width: 200px;
    padding: 10px 14px;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    font-size: 14px;
    transition: border-color 0.2s;
  }
  .add-form input:focus { border-color: #667eea; outline: none; }
  .add-form button {
    padding: 10px 24px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.1s, box-shadow 0.2s;
  }
  .add-form button:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(102,126,234,0.4); }
  .add-form button:active { transform: translateY(0); }

  /* Sections */
  .section {
    background: #fff;
    border-radius: 12px;
    margin-bottom: 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    overflow: hidden;
  }
  .section-header {
    padding: 14px 20px;
    font-size: 16px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid #f0f0f0;
  }
  .section-header .count {
    margin-left: auto;
    font-size: 13px;
    font-weight: 400;
    color: #888;
    background: #f5f5f5;
    padding: 2px 10px;
    border-radius: 12px;
  }
  .section.notes .section-header { background: #f0f7ff; color: #1890ff; }
  .section.questions .section-header { background: #fff7e6; color: #fa8c16; }
  .section.tasks .section-header { background: #f6ffed; color: #52c41a; }

  .item-list { padding: 8px 0; }
  .item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 20px;
    transition: background 0.15s;
    border-bottom: 1px solid #f8f8f8;
  }
  .item:last-child { border-bottom: none; }
  .item:hover { background: #fafafa; }

  /* Checkbox */
  .checkbox {
    width: 22px;
    height: 22px;
    border: 2px solid #d9d9d9;
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
    margin-top: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    position: relative;
  }
  .checkbox:hover { border-color: #667eea; }
  .checkbox.checked {
    background: linear-gradient(135deg, #667eea, #764ba2);
    border-color: transparent;
  }
  .checkbox.checked::after {
    content: '';
    width: 6px;
    height: 10px;
    border: solid #fff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
    margin-top: -2px;
  }

  .item-content { flex: 1; min-width: 0; }
  .item-id {
    font-size: 12px;
    font-weight: 600;
    color: #888;
    margin-right: 8px;
  }
  .item-text { font-size: 14px; word-break: break-word; }
  .item.completed .item-text {
    text-decoration: line-through;
    color: #aaa;
  }
  .item-date { font-size: 11px; color: #bbb; margin-top: 2px; }

  .delete-btn {
    opacity: 0;
    background: none;
    border: none;
    color: #ff4d4f;
    cursor: pointer;
    font-size: 18px;
    padding: 0 4px;
    transition: opacity 0.2s;
    flex-shrink: 0;
  }
  .item:hover .delete-btn { opacity: 0.6; }
  .delete-btn:hover { opacity: 1 !important; }

  .note-bullet {
    color: #1890ff;
    font-size: 14px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .empty {
    padding: 30px 20px;
    text-align: center;
    color: #ccc;
    font-size: 14px;
  }

  .toast {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%) translateY(100px);
    background: #333;
    color: #fff;
    padding: 10px 24px;
    border-radius: 8px;
    font-size: 14px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    transition: transform 0.3s;
    z-index: 9999;
  }
  .toast.show { transform: translateX(-50%) translateY(0); }

  .footer {
    text-align: center;
    color: #aaa;
    font-size: 12px;
    padding: 10px;
  }
  .footer a { color: #667eea; text-decoration: none; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Dev Notes Dashboard</h1>
    <div class="subtitle">直接查看和管理你的笔记、问题和待办任务</div>
    <div class="stats" id="stats"></div>
  </div>

  <div class="add-form">
    <select id="addType">
      <option value="note">📝 笔记</option>
      <option value="question">❓ 问题</option>
      <option value="task">✅ 任务</option>
    </select>
    <input type="text" id="addContent" placeholder="输入内容后按回车添加..." />
    <button onclick="addItem()">添加</button>
  </div>

  <div class="section notes">
    <div class="section-header">📝 笔记 <span class="count" id="notesCount">0</span></div>
    <div class="item-list" id="notesList"></div>
  </div>

  <div class="section questions">
    <div class="section-header">❓ 问题 <span class="count" id="questionsCount">0</span></div>
    <div class="item-list" id="questionsList"></div>
  </div>

  <div class="section tasks">
    <div class="section-header">✅ 待办任务 <span class="count" id="tasksCount">0</span></div>
    <div class="item-list" id="tasksList"></div>
  </div>

  <div class="footer">
    数据文件: ~/.dev-notes-mcp/store.json &nbsp;|&nbsp;
    <a href="javascript:location.reload()">刷新</a> &nbsp;|&nbsp;
    dev-notes-mcp v1.0.0
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
let DATA = null;

async function loadData() {
  const res = await fetch('/api/data');
  DATA = await res.json();
  render();
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
}

function render() {
  const { notes, questions, tasks } = DATA;

  // Stats
  const resolvedQ = questions.filter(q => q.resolved).length;
  const doneT = tasks.filter(t => t.done).length;
  document.getElementById('stats').innerHTML =
    '<div class="stat"><span class="num">' + notes.length + '</span> <span class="label">笔记</span></div>' +
    '<div class="stat"><span class="num">' + resolvedQ + '/' + questions.length + '</span> <span class="label">问题已解决</span></div>' +
    '<div class="stat"><span class="num">' + doneT + '/' + tasks.length + '</span> <span class="label">任务已完成</span></div>';

  // Notes
  document.getElementById('notesCount').textContent = notes.length;
  const notesEl = document.getElementById('notesList');
  if (notes.length === 0) {
    notesEl.innerHTML = '<div class="empty">暂无笔记</div>';
  } else {
    notesEl.innerHTML = notes.map(n =>
      '<div class="item">' +
        '<span class="note-bullet">●</span>' +
        '<div class="item-content">' +
          '<span class="item-id">N' + n.id + '</span>' +
          '<span class="item-text">' + escapeHtml(n.content) + '</span>' +
          (n.created ? '<div class="item-date">' + fmtDate(n.created) + '</div>' : '') +
        '</div>' +
        '<button class="delete-btn" onclick="deleteItem(\'note\',' + n.id + ')" title="删除">✕</button>' +
      '</div>'
    ).join('');
  }

  // Questions
  document.getElementById('questionsCount').textContent = questions.length;
  const qEl = document.getElementById('questionsList');
  if (questions.length === 0) {
    qEl.innerHTML = '<div class="empty">暂无问题</div>';
  } else {
    qEl.innerHTML = questions.map(q =>
      '<div class="item' + (q.resolved ? ' completed' : '') + '">' +
        '<div class="checkbox' + (q.resolved ? ' checked' : '') + '" onclick="toggleItem(\'question\',' + q.id + ')"></div>' +
        '<div class="item-content">' +
          '<span class="item-id">Q' + q.id + '</span>' +
          '<span class="item-text">' + escapeHtml(q.content) + '</span>' +
          (q.resolvedAt ? '<div class="item-date">✅ 解决于 ' + fmtDate(q.resolvedAt) + '</div>' :
           q.created ? '<div class="item-date">' + fmtDate(q.created) + '</div>' : '') +
        '</div>' +
        '<button class="delete-btn" onclick="deleteItem(\'question\',' + q.id + ')" title="删除">✕</button>' +
      '</div>'
    ).join('');
  }

  // Tasks
  document.getElementById('tasksCount').textContent = tasks.length;
  const tEl = document.getElementById('tasksList');
  if (tasks.length === 0) {
    tEl.innerHTML = '<div class="empty">暂无任务</div>';
  } else {
    tEl.innerHTML = tasks.map(t =>
      '<div class="item' + (t.done ? ' completed' : '') + '">' +
        '<div class="checkbox' + (t.done ? ' checked' : '') + '" onclick="toggleItem(\'task\',' + t.id + ')"></div>' +
        '<div class="item-content">' +
          '<span class="item-id">T' + t.id + '</span>' +
          '<span class="item-text">' + escapeHtml(t.content) + '</span>' +
          (t.doneAt ? '<div class="item-date">✅ 完成于 ' + fmtDate(t.doneAt) + '</div>' :
           t.created ? '<div class="item-date">' + fmtDate(t.created) + '</div>' : '') +
        '</div>' +
        '<button class="delete-btn" onclick="deleteItem(\'task\',' + t.id + ')" title="删除">✕</button>' +
      '</div>'
    ).join('');
  }
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

async function toggleItem(type, id) {
  const res = await fetch('/api/toggle', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ type, id })
  });
  const result = await res.json();
  showToast(result.message);
  await loadData();
}

async function deleteItem(type, id) {
  if (!confirm('确认删除？')) return;
  const res = await fetch('/api/item/' + type + '/' + id, { method: 'DELETE' });
  const result = await res.json();
  showToast(result.message);
  await loadData();
}

async function addItem() {
  const type = document.getElementById('addType').value;
  const content = document.getElementById('addContent').value.trim();
  if (!content) return;
  const res = await fetch('/api/add', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ type, content })
  });
  const result = await res.json();
  showToast(result.message);
  document.getElementById('addContent').value = '';
  await loadData();
}

// Enter key to add
document.getElementById('addContent').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addItem();
});

// Auto refresh every 5s (in case Copilot modified data)
setInterval(loadData, 5000);

// Initial load
loadData();
</script>
</body>
</html>`;
}
// ==================== HTTP 服务器 ====================
export function startDashboardServer(port = 3456) {
    const server = http.createServer((req, res) => {
        // CORS
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        const url = new URL(req.url || "/", `http://localhost:${port}`);
        // ----- 页面 -----
        if (url.pathname === "/" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(getDashboardHTML());
            return;
        }
        // ----- API: 获取数据 -----
        if (url.pathname === "/api/data" && req.method === "GET") {
            const store = loadStore();
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(store));
            return;
        }
        // ----- API: 切换完成状态 -----
        if (url.pathname === "/api/toggle" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", () => {
                try {
                    const { type, id } = JSON.parse(body);
                    const result = toggleItem(type, id);
                    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify(result));
                }
                catch (e) {
                    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ success: false, message: "请求格式错误" }));
                }
            });
            return;
        }
        // ----- API: 新增条目 -----
        if (url.pathname === "/api/add" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", () => {
                try {
                    const { type, content } = JSON.parse(body);
                    const result = addItem(type, content);
                    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify(result));
                }
                catch (e) {
                    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ success: false, message: "请求格式错误" }));
                }
            });
            return;
        }
        // ----- API: 删除条目 -----
        const deleteMatch = url.pathname.match(/^\/api\/item\/(note|question|task)\/(\d+)$/);
        if (deleteMatch && req.method === "DELETE") {
            const type = deleteMatch[1];
            const id = parseInt(deleteMatch[2], 10);
            const result = deleteItem(type, id);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(result));
            return;
        }
        // ----- 404 -----
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
    });
    server.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`\n  Dev Notes Dashboard 已启动！\n`);
        console.log(`  浏览器访问: ${url}\n`);
        console.log(`  数据文件: ${STORAGE_FILE}\n`);
        console.log(`  按 Ctrl+C 退出\n`);
        // 自动打开浏览器
        const platform = process.platform;
        let cmd;
        if (platform === "win32")
            cmd = `start ${url}`;
        else if (platform === "darwin")
            cmd = `open ${url}`;
        else
            cmd = `xdg-open ${url}`;
        exec(cmd, (err) => {
            if (err) {
                // 打开失败不影响使用，用户手动访问即可
            }
        });
    });
}
