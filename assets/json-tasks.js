import { deleteJsonTask, fetchJsonTaskDetail, getData, retryJsonTask } from "./store.js";
import { clearNavBadge, fmtNumber, renderNav, showPageError, toast } from "./ui.js";

let currentData = { novels: [], prompts: [], jsonTasks: [] };
let refreshTimer = null;
let clockTimer = null;
const taskDetails = new Map();
const loadingDetails = new Set();
const REFRESH_INTERVAL_KEY = "ai_novel_json_tasks_refresh_interval";
const REFRESH_VALUES = ["0", "5", "20", "60"];

function renderNovelSelector() {
  const select = document.getElementById("taskNovelSelect");
  const current = String(select.value || "");
  select.innerHTML = `<option value="">全部小说</option>${currentData.novels
    .map((n) => `<option value="${n.id}">${n.name}</option>`)
    .join("")}`;
  if (current && select.querySelector(`option[value="${current}"]`)) {
    select.value = current;
  }
}

function promptName(map, id) {
  return map.get(String(id)) || "未绑定";
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseServerTime(value) {
  const text = String(value || "").trim();
  if (!text) return Date.now();
  const hasZone = /[zZ]|[+-]\d\d:\d\d$/.test(text);
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const ts = Date.parse(hasZone ? normalized : `${normalized}Z`);
  return Number.isFinite(ts) ? ts : Date.now();
}

function formatServerTime(value) {
  return new Date(parseServerTime(value)).toLocaleString("zh-CN", { hour12: false });
}

function formatElapsedFrom(value) {
  const ms = Math.max(0, Date.now() - parseServerTime(value));
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `{${mm}:${ss}}`;
}

function updateElapsedLabels() {
  document.querySelectorAll("[data-elapsed-from]").forEach((el) => {
    const from = el.getAttribute("data-elapsed-from") || "";
    el.textContent = formatElapsedFrom(from);
  });
}

function progressWidth(task) {
  const base = Number(task.progress || 0);
  if (task.status === "running") return Math.max(base, 14);
  return Math.max(0, Math.min(100, base));
}

function renderBatchDetails(taskId) {
  const data = taskDetails.get(String(taskId));
  if (!data) return "";
  const batches = Array.isArray(data.batches) ? data.batches : [];
  if (!batches.length) {
    return `<div class="batch-panel"><p class="meta">当前任务没有分批记录。</p></div>`;
  }
  return `<div class="batch-panel">${batches
    .map((b) => {
      const err = b.errorMessage ? ` · 失败: ${escapeHtml(b.errorMessage)}` : "";
      return `<details ${b.status === "failed" ? "open" : ""}><summary>批次 ${b.batchIndex} · ${b.status} · 字数 ${fmtNumber(b.inputWordCount || 0)}${err}</summary><p class="meta">更新时间 ${formatServerTime(
        b.updatedAt
      )}</p><div class="batch-block"><strong>输入文本</strong><pre>${escapeHtml(b.inputText || "")}</pre></div><div class="batch-block"><strong>LLM返回</strong><pre>${escapeHtml(
        b.llmResponseText || ""
      )}</pre></div><div class="batch-block"><strong>解析JSON</strong><pre>${escapeHtml(b.parsedJsonText || "")}</pre></div></details>`;
    })
    .join("")}</div>`;
}

function render() {
  const promptMap = new Map(currentData.prompts.map((p) => [String(p.id), p.name]));
  const activeNovel = document.getElementById("taskNovelSelect").value;
  const status = document.getElementById("taskStatusSelect").value;

  const list = currentData.jsonTasks.filter((t) => {
    const hitNovel = activeNovel ? String(t.novelId) === String(activeNovel) : true;
    const hitStatus = status === "all" ? true : t.status === status;
    return hitNovel && hitStatus;
  });

  if (!list.length) {
    document.getElementById("jsonTaskList").innerHTML =
      '<article class="queue-card"><p class="meta">当前筛选条件下暂无任务，试试切换到“全部小说/全部状态”。</p></article>';
    return;
  }

  document.getElementById("jsonTaskList").innerHTML = list
    .map(
      (task) => `
      <article class="queue-card">
        <div class="queue-head">
          <h3>#${fmtNumber(task.id)} · ${task.title}</h3>
          <strong class="status ${task.status}">${task.status}</strong>
        </div>
        <p class="meta">${task.novelName || ""} · 章节 ${task.chapter} · 字数 ${fmtNumber(task.wordCount || 0)} · 提示词 ${promptName(promptMap, task.promptId)}${
          task.status === "running"
            ? ` · 已用时 <span data-elapsed-from="${task.updatedAt}">${formatElapsedFrom(task.updatedAt)}</span>`
            : ""
        } · 分批 ${fmtNumber(task.batchDone || 0)}/${fmtNumber(task.batchTotal || 0)} · 创建时间 ${formatServerTime(task.createdAt || task.updatedAt)} · 更新时间 ${formatServerTime(task.updatedAt)}</p>
        ${
          task.status === "failed" && task.errorMessage
            ? `<p class="task-error">失败原因：${escapeHtml(task.errorMessage)}</p>`
            : ""
        }
        ${
          task.status === "failed"
            ? `<div class="card-actions"><button class="ghost-btn" data-task-action="retry" data-task-id="${task.id}">重试</button><button class="ghost-btn" data-task-action="delete" data-task-id="${task.id}">删除</button><button class="ghost-btn" data-task-action="batches" data-task-id="${task.id}">${taskDetails.has(
                String(task.id)
              ) ? "收起批次" : "批次详情"}</button></div>`
            : task.status !== "running"
              ? `<div class="card-actions"><button class="ghost-btn" data-task-action="delete" data-task-id="${task.id}">删除</button><button class="ghost-btn" data-task-action="batches" data-task-id="${task.id}">${taskDetails.has(
                  String(task.id)
                ) ? "收起批次" : "批次详情"}</button></div>`
              : `<div class="card-actions"><button class="ghost-btn" data-task-action="batches" data-task-id="${task.id}">${taskDetails.has(
                  String(task.id)
                ) ? "收起批次" : "批次详情"}</button></div>`
        }
        ${loadingDetails.has(String(task.id)) ? `<p class="meta">正在加载批次详情...</p>` : ""}
        ${taskDetails.has(String(task.id)) ? renderBatchDetails(task.id) : ""}
        <div class="progress ${task.status === "running" ? "is-running" : ""} ${task.status === "failed" ? "is-failed" : ""}"><i style="width:${progressWidth(task)}%"></i></div>
      </article>
    `
    )
    .join("");

  document.querySelectorAll("[data-task-action]").forEach((el) => {
    el.addEventListener("click", () => onTaskAction(el.dataset.taskAction, el.dataset.taskId));
  });
  updateElapsedLabels();
}

async function onTaskAction(action, id) {
  const task = currentData.jsonTasks.find((x) => String(x.id) === String(id));
  if (!task) return;
  try {
    if (action === "retry") {
      await retryJsonTask(task.id);
      toast("任务已重新加入队列");
      await reload();
      return;
    }
    if (action === "delete") {
      if (task.status === "running") {
        toast("运行中任务不可删除");
        return;
      }
      if (!window.confirm(`确认删除任务「${task.title}」吗？`)) return;
      await deleteJsonTask(task.id);
      taskDetails.delete(String(task.id));
      toast("任务已删除");
      await reload();
      return;
    }
    if (action === "batches") {
      const key = String(task.id);
      if (taskDetails.has(key)) {
        taskDetails.delete(key);
        render();
        return;
      }
      if (loadingDetails.has(key)) return;
      loadingDetails.add(key);
      render();
      try {
        const detail = await fetchJsonTaskDetail(task.id);
        taskDetails.set(key, detail);
      } finally {
        loadingDetails.delete(key);
      }
      render();
    }
  } catch (err) {
    toast(`操作失败: ${err.message}`);
  }
}

async function reload() {
  const novelValue = document.getElementById("taskNovelSelect")?.value || "";
  const statusValue = document.getElementById("taskStatusSelect")?.value || "all";
  currentData = await getData();
  const alive = new Set((currentData.jsonTasks || []).map((x) => String(x.id)));
  for (const key of Array.from(taskDetails.keys())) {
    if (!alive.has(key)) taskDetails.delete(key);
  }
  renderNovelSelector();
  document.getElementById("taskNovelSelect").value = novelValue;
  document.getElementById("taskStatusSelect").value = statusValue;
  render();
}

function bindEvents() {
  document.getElementById("taskNovelSelect").addEventListener("change", render);
  document.getElementById("taskStatusSelect").addEventListener("change", render);
  document.getElementById("refreshJsonTasksBtn").addEventListener("click", async () => {
    await reload();
    toast("JSON任务已刷新");
  });

  document.getElementById("jsonAutoRefreshSelect").addEventListener("change", applyAutoRefresh);
}

function applyAutoRefresh() {
  const select = document.getElementById("jsonAutoRefreshSelect");
  if (!select) return;
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  const seconds = Number(select.value || 0);
  localStorage.setItem(REFRESH_INTERVAL_KEY, String(seconds));
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  refreshTimer = window.setInterval(() => {
    reload().catch(() => {
      // ignore
    });
  }, seconds * 1000);
}

function initAutoRefresh() {
  const select = document.getElementById("jsonAutoRefreshSelect");
  if (!select) return;
  const saved = localStorage.getItem(REFRESH_INTERVAL_KEY);
  if (saved != null && REFRESH_VALUES.includes(saved)) {
    select.value = saved;
  }
  applyAutoRefresh();
}

function initClockTicker() {
  if (clockTimer) {
    window.clearInterval(clockTimer);
    clockTimer = null;
  }
  clockTimer = window.setInterval(() => {
    if (!currentData.jsonTasks.some((x) => x.status === "running")) return;
    updateElapsedLabels();
  }, 1000);
}

async function init() {
  clearNavBadge("json");
  renderNav();
  bindEvents();
  initAutoRefresh();
  initClockTicker();
  await reload();
}

init().catch((err) => {
  renderNav();
  showPageError(err, "JSON任务页初始化失败");
});
