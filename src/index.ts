#!/usr/bin/env node

/**
 * dev-notes-mcp — Dev Notes MCP Server
 *
 * 一个轻量 MCP Server，用于：
 *  1. 接收用户随手记录的文本（txt），自动解析分类为「笔记」「问题」「待办任务」
 *  2. 问题和待办支持标记完成
 *  3. 在 Copilot 对话中查询「还有哪些任务/问题没解决」
 *
 * 存储：~/.dev-notes-mcp/store.json
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { startDashboardServer } from "./dashboard.js";

// ==================== 类型定义 ====================

interface NoteItem {
  id: number;
  content: string;
  tag?: string;
  created: string;
}

interface QuestionItem {
  id: number;
  content: string;
  resolved: boolean;
  created: string;
  resolvedAt?: string;
}

interface TaskItem {
  id: number;
  content: string;
  done: boolean;
  created: string;
  doneAt?: string;
}

interface Store {
  notes: NoteItem[];
  questions: QuestionItem[];
  tasks: TaskItem[];
  counters: { notes: number; questions: number; tasks: number };
}

// ==================== 存储管理 ====================

const STORAGE_DIR = path.join(os.homedir(), ".dev-notes-mcp");
const STORAGE_FILE = path.join(STORAGE_DIR, "store.json");

function loadStore(): Store {
  try {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    if (!fs.existsSync(STORAGE_FILE)) {
      const empty: Store = {
        notes: [],
        questions: [],
        tasks: [],
        counters: { notes: 0, questions: 0, tasks: 0 },
      };
      saveStore(empty);
      return empty;
    }
    const data = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8"));
    // 兼容性检查
    if (!data.notes) data.notes = [];
    if (!data.questions) data.questions = [];
    if (!data.tasks) data.tasks = [];
    if (!data.counters) data.counters = { notes: 0, questions: 0, tasks: 0 };
    return data as Store;
  } catch (e) {
    const empty: Store = {
      notes: [],
      questions: [],
      tasks: [],
      counters: { notes: 0, questions: 0, tasks: 0 },
    };
    return empty;
  }
}

function saveStore(store: Store): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function nowISO(): string {
  return new Date().toISOString();
}

// ==================== 文本解析引擎 ====================

/**
 * 问题关键词 — 命中则归为「问题」
 */
const QUESTION_KEYWORDS = [
  "问题", "疑问", "为什么", "如何", "怎么", "怎样", "怎么办",
  "什么时候", "是否", "能否", "可以吗", "对吗", "吗？", "吗?",
  "哪个", "哪些", "什么叫", "什么是", "什么是", "区别是",
  "区别是什么", "原理是", "原理是什么", "为什么需要",
  "Q:", "Q：", "question", "why", "how to", "what is",
];

/**
 * 任务关键词 — 命中则归为「待办任务」
 */
const TASK_KEYWORDS = [
  "待办", "TODO", "todo", "任务", "需要", "记得", "要完成",
  "必须", "待完成", "事项", "行动", "计划", "安排",
  "准备", "要去", "要写", "要做", "要查", "要学", "要改",
  "要测", "要部署", "要更新", "要修复", "要 review", "要review",
  "T:", "T：", "task",
];

/**
 * 笔记关键词 — 明确标记为「笔记/知识点」
 */
const NOTE_KEYWORDS = [
  "知识点", "笔记", "知识", "记录", "备忘", "参考",
  "N:", "N：", "note", "tips", "tip",
];

function classifyLine(line: string): "question" | "task" | "note" {
  const trimmed = line.trim();
  if (!trimmed) return "note";

  const lower = trimmed.toLowerCase();

  // 1. 以 ? 或 ？ 结尾 → 问题
  if (trimmed.endsWith("?") || trimmed.endsWith("？")) return "question";

  // 2. markdown 复选框（- [ ] 或 [ ] 等）→ 任务
  if (/^[-*+]?\s*\[[ xX]\]/.test(trimmed)) return "task";

  // 3. 显式问题标记（带冒号）
  for (const kw of ["问题", "疑问", "Q:", "Q：", "question"]) {
    if (lower.includes(kw.toLowerCase()) && /[:：]/.test(trimmed)) return "question";
  }

  // 4. 显式任务标记（带冒号）
  for (const kw of ["待办", "TODO", "todo", "任务", "T:", "T：", "task"]) {
    if (lower.includes(kw.toLowerCase()) && /[:：]/.test(trimmed)) return "task";
  }

  // 5. 显式笔记标记（带冒号）
  for (const kw of ["知识点", "笔记", "知识", "记录", "备忘", "参考", "N:", "N：", "note"]) {
    if (lower.includes(kw.toLowerCase()) && /[:：]/.test(trimmed)) return "note";
  }

  // 6. 问题关键词（无冒号也能命中）
  for (const kw of QUESTION_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return "question";
  }

  // 7. 任务关键词（无冒号也能命中）
  for (const kw of TASK_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return "task";
  }

  // 8. 默认 → 笔记
  return "note";
}

/**
 * 清理行内容：移除 markdown 标记和分类前缀
 */
function cleanContent(line: string): string {
  let content = line.trim();

  // 移除 markdown 列表标记
  content = content.replace(/^[-*+]\s+/, "");
  content = content.replace(/^\d+[.)]\s+/, "");

  // 移除复选框标记
  content = content.replace(/^\[[ xX]\]\s*/, "");

  // 移除分类前缀（冒号前部分）
  const prefixes = [
    "问题", "疑问", "Q", "q", "question",
    "待办", "TODO", "todo", "任务", "T", "t", "task",
    "知识点", "笔记", "知识", "记录", "备忘", "参考", "N", "n", "note",
    "tips", "tip",
  ];
  for (const prefix of prefixes) {
    const regex = new RegExp(`^${escapeRegex(prefix)}\\s*[:：]\\s*`, "i");
    if (regex.test(content)) {
      content = content.replace(regex, "");
      break;
    }
  }

  return content.trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 检测 markdown 分区标题
 * ## 问题 / ## 待办 / ## 笔记 等
 */
function detectSection(line: string): "question" | "task" | "note" | null {
  const match = line.match(/^#{1,6}\s+(.+)/);
  if (!match) return null;

  const header = match[1].trim().toLowerCase();

  if (header.includes("问题") || header.includes("question") || header.includes("q")) {
    return "question";
  }
  if (
    header.includes("待办") ||
    header.includes("任务") ||
    header.includes("task") ||
    header.includes("todo")
  ) {
    return "task";
  }
  if (
    header.includes("笔记") ||
    header.includes("note") ||
    header.includes("知识") ||
    header.includes("knowledge")
  ) {
    return "note";
  }

  return null; // 未知分区标题，不改变当前分区
}

/**
 * 主解析函数：将原始文本拆分为 notes / questions / tasks
 * tasks 中支持 done 标记（当行包含 [x] 或 [X] 复选框时自动标记为已完成）
 */
function parseText(text: string): {
  notes: string[];
  questions: string[];
  tasks: { content: string; done: boolean }[];
} {
  const lines = text.split(/\r?\n/);
  const notes: string[] = [];
  const questions: string[] = [];
  const tasks: { content: string; done: boolean }[] = [];

  let currentSection: "question" | "task" | "note" | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // 检测 markdown 分区标题
    const section = detectSection(trimmed);
    if (section !== null) {
      currentSection = section;
      continue;
    }

    // 如果在分区内，使用分区类型
    let type: "question" | "task" | "note";
    if (currentSection) {
      type = currentSection;
    } else {
      type = classifyLine(trimmed);
    }

    // 检测复选框是否已勾选
    const isChecked = /^[-*+]?\s*\[[xX]\]/.test(trimmed);

    // 清理内容
    const content = cleanContent(trimmed);
    if (!content) continue;

    switch (type) {
      case "question":
        questions.push(content);
        break;
      case "task":
        tasks.push({ content, done: isChecked });
        break;
      default:
        notes.push(content);
    }
  }

  return { notes, questions, tasks };
}

// ==================== 格式化输出 ====================

function formatPending(store: Store): string {
  const pendingQuestions = store.questions.filter((q) => !q.resolved);
  const pendingTasks = store.tasks.filter((t) => !t.done);

  const parts: string[] = [];
  parts.push(`📋 待处理项（共 ${pendingQuestions.length + pendingTasks.length} 项）\n`);

  if (pendingQuestions.length > 0) {
    parts.push(`❓ 未解决问题（${pendingQuestions.length}）:`);
    for (const q of pendingQuestions) {
      parts.push(`  [Q${q.id}] ${q.content}`);
    }
    parts.push("");
  }

  if (pendingTasks.length > 0) {
    parts.push(`✅ 未完成任务（${pendingTasks.length}）:`);
    for (const t of pendingTasks) {
      parts.push(`  [T${t.id}] ${t.content}`);
    }
    parts.push("");
  }

  if (pendingQuestions.length === 0 && pendingTasks.length === 0) {
    parts.push("🎉 所有问题和任务都已完成！");
  }

  return parts.join("\n");
}

function formatItems(
  store: Store,
  type: "notes" | "questions" | "tasks" | "all",
  status: "all" | "pending" | "done"
): string {
  const parts: string[] = [];

  if (type === "notes" || type === "all") {
    const items = store.notes;
    if (items.length > 0) {
      parts.push(`📝 笔记（${items.length}）:`);
      for (const n of items) {
        parts.push(`  [N${n.id}] ${n.content}`);
      }
      parts.push("");
    } else if (type === "notes") {
      parts.push("📝 暂无笔记");
    }
  }

  if (type === "questions" || type === "all") {
    let items = store.questions;
    if (status === "pending") items = items.filter((q) => !q.resolved);
    if (status === "done") items = items.filter((q) => q.resolved);

    if (items.length > 0) {
      parts.push(`❓ 问题（${items.length}）:`);
      for (const q of items) {
        const mark = q.resolved ? "✅" : "⬜";
        parts.push(`  ${mark} [Q${q.id}] ${q.content}`);
      }
      parts.push("");
    } else if (type === "questions") {
      parts.push("❓ 暂无问题");
    }
  }

  if (type === "tasks" || type === "all") {
    let items = store.tasks;
    if (status === "pending") items = items.filter((t) => !t.done);
    if (status === "done") items = items.filter((t) => t.done);

    if (items.length > 0) {
      parts.push(`✅ 任务（${items.length}）:`);
      for (const t of items) {
        const mark = t.done ? "✅" : "⬜";
        parts.push(`  ${mark} [T${t.id}] ${t.content}`);
      }
      parts.push("");
    } else if (type === "tasks") {
      parts.push("✅ 暂无任务");
    }
  }

  return parts.join("\n") || "暂无数据";
}

function formatSummary(store: Store): string {
  const pendingQ = store.questions.filter((q) => !q.resolved).length;
  const resolvedQ = store.questions.filter((q) => q.resolved).length;
  const pendingT = store.tasks.filter((t) => !t.done).length;
  const doneT = store.tasks.filter((t) => t.done).length;

  const parts: string[] = [
    "📊 概览\n",
    `📝 笔记: ${store.notes.length} 条`,
    `❓ 问题: ${store.questions.length} 条（未解决 ${pendingQ}，已解决 ${resolvedQ}）`,
    `✅ 任务: ${store.tasks.length} 条（未完成 ${pendingT}，已完成 ${doneT}）`,
    "",
    `💡 待处理总计: ${pendingQ + pendingT} 项`,
  ];

  // 列出最近的待处理项
  const pendingQuestions = store.questions.filter((q) => !q.resolved);
  const pendingTasks = store.tasks.filter((t) => !t.done);

  if (pendingQuestions.length > 0 || pendingTasks.length > 0) {
    parts.push("\n--- 待处理明细 ---");
    if (pendingQuestions.length > 0) {
      parts.push(`\n❓ 未解决问题:`);
      for (const q of pendingQuestions) {
        parts.push(`  [Q${q.id}] ${q.content}`);
      }
    }
    if (pendingTasks.length > 0) {
      parts.push(`\n✅ 未完成任务:`);
      for (const t of pendingTasks) {
        parts.push(`  [T${t.id}] ${t.content}`);
      }
    }
  }

  return parts.join("\n");
}

// ==================== MCP Server ====================

const server = new Server(
  { name: "dev-notes-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ----- 工具列表 -----

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "import_text",
      description:
        "导入一段文本内容，自动解析并分类为笔记、问题和待办任务。" +
        "支持识别'问题:'、'待办:'、'TODO:'、'知识点:'等标记，" +
        "支持以'?'结尾的问句、markdown复选框'- [ ]'，" +
        "也支持markdown分区标题（## 问题 / ## 待办 / ## 笔记）。" +
        "用户传入txt文件内容时使用此工具。",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "要导入的文本内容（通常是txt文件的全文）",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "list_pending",
      description:
        "列出所有未解决的问题和未完成的待办任务。" +
        "当用户询问'还有哪些没完成'、'还有什么问题没解决'、" +
        "'待办事项有哪些'时使用此工具。",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "mark_done",
      description:
        "标记一个问题为已解决，或标记一个待办任务为已完成。" +
        "需要提供条目类型（question 或 task）和ID。" +
        "用户说'标记问题Q1已解决'、'完成任务T3'时使用此工具。",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            enum: ["question", "task"],
            description: "条目类型：question=问题，task=任务",
          },
          id: {
            type: "number",
            description: "条目ID（如 Q1 的 ID 为 1，T3 的 ID 为 3）",
          },
        },
        required: ["type", "id"],
      },
    },
    {
      name: "list_items",
      description:
        "列出指定类型的所有条目。可查看笔记、问题或任务，" +
        "问题和任务支持按状态过滤（pending=未完成，done=已完成，all=全部）。" +
        "用户说'看看我的笔记'、'列出所有问题'时使用此工具。",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            enum: ["notes", "questions", "tasks", "all"],
            description: "要列出的条目类型，默认 all",
          },
          status: {
            type: "string",
            enum: ["all", "pending", "done"],
            description: "状态过滤（仅对 questions 和 tasks 有效），默认 all",
          },
        },
      },
    },
    {
      name: "get_summary",
      description:
        "获取所有笔记、问题和任务的统计概览，包括总数、已完成数、待处理数，" +
        "并列出所有待处理项明细。用户问'概况'、'总结一下'时使用。",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "add_item",
      description:
        "手动添加一条笔记、问题或待办任务。" +
        "当用户在对话中直接说了一条内容需要记录时使用。" +
        "例如用户说'记一下：TCP三次握手'→添加笔记，" +
        "'有个问题：为什么需要网关'→添加问题，" +
        "'待办：明天部署服务'→添加任务。",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            enum: ["note", "question", "task"],
            description: "条目类型：note=笔记，question=问题，task=任务",
          },
          content: {
            type: "string",
            description: "条目内容文本",
          },
        },
        required: ["type", "content"],
      },
    },
    {
      name: "clear_all",
      description:
        "清空所有存储的数据（笔记、问题、任务全部删除）。" +
        "需要 confirm 参数为 true 才会执行。慎用！",
      inputSchema: {
        type: "object" as const,
        properties: {
          confirm: {
            type: "boolean",
            description: "必须为 true 才会执行清空操作",
          },
        },
        required: ["confirm"],
      },
    },
  ],
}));

// ----- 工具调用处理 -----

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ============ import_text ============
      case "import_text": {
        const text = args?.text as string;
        if (!text || !text.trim()) {
          return {
            content: [{ type: "text" as const, text: "错误：文本内容为空" }],
            isError: true,
          };
        }

        const parsed = parseText(text);
        const store = loadStore();
        const now = nowISO();

        let addedNotes = 0;
        let addedQuestions = 0;
        let addedTasks = 0;

        for (const content of parsed.notes) {
          store.counters.notes++;
          store.notes.push({
            id: store.counters.notes,
            content,
            created: now,
          });
          addedNotes++;
        }

        for (const content of parsed.questions) {
          store.counters.questions++;
          store.questions.push({
            id: store.counters.questions,
            content,
            resolved: false,
            created: now,
          });
          addedQuestions++;
        }

        for (const task of parsed.tasks) {
          store.counters.tasks++;
          store.tasks.push({
            id: store.counters.tasks,
            content: task.content,
            done: task.done,
            created: now,
            ...(task.done ? { doneAt: now } : {}),
          });
          addedTasks++;
        }

        saveStore(store);

        const parts: string[] = [
          "✅ 导入完成！\n",
          `📝 笔记: +${addedNotes} 条`,
          `❓ 问题: +${addedQuestions} 条`,
          `✅ 任务: +${addedTasks} 条`,
          `\n总计新增 ${addedNotes + addedQuestions + addedTasks} 条`,
        ];

        // 如果有新增的问题或任务，列出待处理项
        if (addedQuestions > 0 || addedTasks > 0) {
          parts.push("\n--- 当前待处理项 ---");
          parts.push(formatPending(store));
        }

        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
        };
      }

      // ============ list_pending ============
      case "list_pending": {
        const store = loadStore();
        return {
          content: [{ type: "text" as const, text: formatPending(store) }],
        };
      }

      // ============ mark_done ============
      case "mark_done": {
        const type = args?.type as "question" | "task";
        const id = args?.id as number;

        if (!type || (type !== "question" && type !== "task")) {
          return {
            content: [
              { type: "text" as const, text: "错误：type 必须是 'question' 或 'task'" },
            ],
            isError: true,
          };
        }

        if (typeof id !== "number") {
          return {
            content: [{ type: "text" as const, text: "错误：id 必须是数字" }],
            isError: true,
          };
        }

        const store = loadStore();

        if (type === "question") {
          const item = store.questions.find((q) => q.id === id);
          if (!item) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `错误：未找到 ID 为 ${id} 的问题（Q${id} 不存在）`,
                },
              ],
              isError: true,
            };
          }
          if (item.resolved) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `⚠️ 问题 [Q${id}] 已经标记为已解决：\n  ${item.content}`,
                },
              ],
            };
          }
          item.resolved = true;
          item.resolvedAt = nowISO();
          saveStore(store);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ 问题 [Q${id}] 已标记为已解决：\n  ${item.content}`,
              },
            ],
          };
        } else {
          const item = store.tasks.find((t) => t.id === id);
          if (!item) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `错误：未找到 ID 为 ${id} 的任务（T${id} 不存在）`,
                },
              ],
              isError: true,
            };
          }
          if (item.done) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `⚠️ 任务 [T${id}] 已经标记为已完成：\n  ${item.content}`,
                },
              ],
            };
          }
          item.done = true;
          item.doneAt = nowISO();
          saveStore(store);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ 任务 [T${id}] 已标记为已完成：\n  ${item.content}`,
              },
            ],
          };
        }
      }

      // ============ list_items ============
      case "list_items": {
        const type = (args?.type as "notes" | "questions" | "tasks" | "all") || "all";
        const status = (args?.status as "all" | "pending" | "done") || "all";
        const store = loadStore();
        return {
          content: [
            { type: "text" as const, text: formatItems(store, type, status) },
          ],
        };
      }

      // ============ get_summary ============
      case "get_summary": {
        const store = loadStore();
        return {
          content: [{ type: "text" as const, text: formatSummary(store) }],
        };
      }

      // ============ add_item ============
      case "add_item": {
        const type = args?.type as "note" | "question" | "task";
        const content = args?.content as string;

        if (!type || (type !== "note" && type !== "question" && type !== "task")) {
          return {
            content: [
              { type: "text" as const, text: "错误：type 必须是 'note'、'question' 或 'task'" },
            ],
            isError: true,
          };
        }

        if (!content || !content.trim()) {
          return {
            content: [{ type: "text" as const, text: "错误：content 不能为空" }],
            isError: true,
          };
        }

        const store = loadStore();
        const now = nowISO();

        if (type === "note") {
          store.counters.notes++;
          store.notes.push({
            id: store.counters.notes,
            content: content.trim(),
            created: now,
          });
          saveStore(store);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ 已添加笔记 [N${store.counters.notes}]:\n  ${content.trim()}`,
              },
            ],
          };
        } else if (type === "question") {
          store.counters.questions++;
          store.questions.push({
            id: store.counters.questions,
            content: content.trim(),
            resolved: false,
            created: now,
          });
          saveStore(store);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ 已添加问题 [Q${store.counters.questions}]:\n  ${content.trim()}`,
              },
            ],
          };
        } else {
          store.counters.tasks++;
          store.tasks.push({
            id: store.counters.tasks,
            content: content.trim(),
            done: false,
            created: now,
          });
          saveStore(store);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ 已添加任务 [T${store.counters.tasks}]:\n  ${content.trim()}`,
              },
            ],
          };
        }
      }

      // ============ clear_all ============
      case "clear_all": {
        const confirm = args?.confirm as boolean;
        if (confirm !== true) {
          return {
            content: [
              {
                type: "text" as const,
                text: "⚠️ 请确认：传入 confirm: true 才会执行清空操作。此操作不可撤销！",
              },
            ],
            isError: true,
          };
        }

        const store = loadStore();
        const noteCount = store.notes.length;
        const questionCount = store.questions.length;
        const taskCount = store.tasks.length;

        const empty: Store = {
          notes: [],
          questions: [],
          tasks: [],
          counters: { notes: 0, questions: 0, tasks: 0 },
        };
        saveStore(empty);

        return {
          content: [
            {
              type: "text" as const,
              text: `🗑️ 已清空所有数据：\n  笔记 ${noteCount} 条\n  问题 ${questionCount} 条\n  任务 ${taskCount} 条`,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text" as const, text: `错误：未知工具 "${name}"` }],
          isError: true,
        };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `内部错误: ${msg}` }],
      isError: true,
    };
  }
});

// ==================== 启动 ====================

async function main() {
  const cliArgs = process.argv.slice(2);

  // Dashboard 模式
  if (cliArgs.includes("--dashboard") || cliArgs.includes("--serve")) {
    const portIdx = cliArgs.indexOf("--port");
    const port = portIdx !== -1 && cliArgs[portIdx + 1]
      ? parseInt(cliArgs[portIdx + 1], 10) || 3456
      : 3456;
    startDashboardServer(port);
    return;
  }

  // MCP Server 模式（默认）
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
