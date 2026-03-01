import { cancelAllAudioTasks, deleteAudioTask, getData } from "./store.js";
import { clearNavBadge, fmtDateTime, fmtNumber, renderNav, showPageError, toast } from "./ui.js";
import { localizeDocumentText, t } from "./i18n.js";

let currentData = { novels: [], workflows: [], audioTasks: [] };
let elapsedTimer = null;
let refreshTimer = null;

function workflowName(map, id) {
  return map.get(String(id)) || "-";
}

function statusLabel(status) {
  return t(`common.status.${status}`) || status;
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseServerTime(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (text.includes("T")) {
    const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`;
    const dt = new Date(withZone);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(text.replace(" ", "T") + "Z");
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatDateTime(raw) {
  const dt = parseServerTime(raw);
  return dt ? fmtDateTime(dt) : "-";
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function progressWidth(task) {
  const base = Number(task.progress || 0);
  if (task.status === "running") return Math.max(base, 14);
  return Math.max(0, Math.min(100, base));
}

function renderNovelSelector() {
  const select = document.getElementById("audioNovelSelect");
  const prev = String(select.value || "");
  select.innerHTML = `<option value="">全部小说</option>${currentData.novels
    .map((n) => `<option value="${n.id}">${n.name}</option>`)
    .join("")}`;
  if (prev && select.querySelector(`option[value="${prev}"]`)) {
    select.value = prev;
  }
}

function updateElapsedTime() {
  const nodes = document.querySelectorAll("[data-elapsed-start]");
  const now = Date.now();
  nodes.forEach((el) => {
    const startedAt = parseServerTime(el.getAttribute("data-elapsed-start"));
    el.textContent = startedAt ? formatDuration(now - startedAt.getTime()) : "0:00:00";
  });
}

function bindElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  const runningNodes = document.querySelectorAll("[data-elapsed-start]");
  if (!runningNodes.length) return;
  updateElapsedTime();
  elapsedTimer = setInterval(updateElapsedTime, 1000);
}

function taskElapsedText(task) {
  const started = parseServerTime(task.comfyStartedAt || "");
  if (!started) return "";
  if (task.status === "running") {
    return `已用时 <span data-elapsed-start="${escapeHtml(task.comfyStartedAt || task.updatedAt || "")}">0:00:00</span>`;
  }
  const finished = parseServerTime(task.comfyFinishedAt || "");
  if (finished) {
    return `已用时 ${formatDuration(finished.getTime() - started.getTime())}`;
  }
  return `已用时 ${formatDuration(Date.now() - started.getTime())}`;
}

function render() {
  const workflowMap = new Map(currentData.workflows.map((w) => [String(w.id), w.name]));
  const activeNovel = document.getElementById("audioNovelSelect").value;
  const status = document.getElementById("audioStatusSelect").value;

  const list = currentData.audioTasks.filter((t) => {
    const hitNovel = activeNovel ? String(t.novelId) === String(activeNovel) : true;
    const hitStatus = status === "all" ? true : t.status === status;
    return hitNovel && hitStatus;
  });

  if (!list.length) {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    document.getElementById("audioTaskList").innerHTML =
      '<article class="queue-card"><p class="meta">-</p></article>';
    localizeDocumentText(document);
    return;
  }

  document.getElementById("audioTaskList").innerHTML = list
    .map(
      (task) => `
      <article class="queue-card">
        <div class="queue-head">
          <h3>${task.title}</h3>
          <strong class="status ${task.status}">${statusLabel(task.status)}</strong>
        </div>
        <p class="meta">${task.novelName || ""} · #${task.chapter} ${task.title ? `· ${escapeHtml(task.title)}` : ""} · ${fmtNumber(task.wordCount || 0)} · ${workflowName(workflowMap, task.workflowId)} · Comfy ${task.comfyStatus || "-"} · ${task.scheduledAt ? formatDateTime(task.scheduledAt) : t("common.immediate")}</p>
        <p class="meta">创建 ${formatDateTime(task.createdAt)}${taskElapsedText(task) ? ` · ${taskElapsedText(task)}` : ""}</p>
        ${task.status === "failed" && task.errorMessage ? `<p class="task-error">${escapeHtml(task.errorMessage)}</p>` : ""}
        ${task.status !== "running" ? `<div class="card-actions"><button class="ghost-btn" data-audio-action="delete" data-task-id="${task.id}">${t("common.delete")}</button></div>` : ""}
        <div class="progress ${task.status === "running" ? "is-running-animated" : ""} ${task.status === "failed" ? "is-failed" : ""}"><i style="width:${progressWidth(task)}%"></i></div>
      </article>
    `
    )
    .join("");
  document.querySelectorAll("[data-audio-action='delete']").forEach((el) => {
    el.addEventListener("click", async () => {
      const taskId = Number(el.getAttribute("data-task-id") || 0);
      const task = currentData.audioTasks.find((x) => Number(x.id) === taskId);
      if (!task) return;
      if (!window.confirm(t("confirm.deleteAudioTask", { title: task.title }))) return;
      try {
        await deleteAudioTask(taskId);
        toast(t("toast.deleted"));
        await reload();
      } catch (err) {
        toast(t("error.deleteFailed", { msg: err.message }));
      }
    });
  });
  localizeDocumentText(document);
  bindElapsedTimer();
}

async function reload() {
  const prevNovel = document.getElementById("audioNovelSelect")?.value || "";
  const prevStatus = document.getElementById("audioStatusSelect")?.value || "all";
  currentData = await getData();
  renderNovelSelector();
  document.getElementById("audioNovelSelect").value = prevNovel;
  document.getElementById("audioStatusSelect").value = prevStatus;
  render();
}

function applyRefreshInterval() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  const seconds = Number(document.getElementById("audioRefreshIntervalSelect").value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  refreshTimer = setInterval(() => {
    reload().catch(() => {
      // ignore timer errors, next tick retries
    });
  }, seconds * 1000);
}

function bindEvents() {
  document.getElementById("audioNovelSelect").addEventListener("change", render);
  document.getElementById("audioStatusSelect").addEventListener("change", render);

  document.getElementById("refreshAudioQueueBtn").addEventListener("click", async () => {
    await reload();
    toast(t("common.refresh"));
  });

  document.getElementById("cancelAllAudioTasksBtn").addEventListener("click", async () => {
    if (!window.confirm(t("confirm.cancelAllAudio"))) return;
    const res = await cancelAllAudioTasks();
    toast(String(res.message || t("common.status.cancelled")));
    await reload();
  });

  document.getElementById("audioRefreshIntervalSelect").addEventListener("change", applyRefreshInterval);
}

async function init() {
  clearNavBadge("audio");
  renderNav();
  bindEvents();
  await reload();
  localizeDocumentText(document);
  applyRefreshInterval();
  window.addEventListener("beforeunload", () => {
    if (elapsedTimer) clearInterval(elapsedTimer);
    if (refreshTimer) clearInterval(refreshTimer);
  });
}

init().catch((err) => {
  renderNav();
  showPageError(err, t("error.pageLoad"));
});
