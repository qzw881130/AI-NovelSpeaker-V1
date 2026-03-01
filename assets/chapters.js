import {
  createChapter,
  deleteChapter,
  downloadChapterAudio,
  fetchChapterDetail,
  fetchChapterJsonOutput,
  fetchNovelChapters,
  getData,
  requestConvertJson,
  requestGenerateAudio,
  saveChapterJsonOutput,
  setActiveNovelId,
  updateChapter,
} from "./store.js";
import { fmtNumber, incrementNavBadge, renderNav, showPageError, toast } from "./ui.js";

let allNovels = [];
let activeNovel = null;
let chapterState = [];
let activeChapterNum = null;
let activeChapterDetail = null;
let chapterModalMode = "create";
let chapterEditSourceNum = null;
let modalInitialWordCount = 0;
let jsonViewMode = "raw";
let jsonViewRawText = "";
let jsonViewParsed = null;
let jsonViewEditing = false;

function setGenerateAudioVisible(visible) {
  document.getElementById("generateAudioBtn").classList.toggle("hidden", !visible);
  document.getElementById("audioScheduleWrap").classList.toggle("hidden", !visible);
  document.getElementById("downloadAudioBtn").classList.toggle("hidden", !visible);
  const modeEl = document.getElementById("audioScheduleMode");
  const atEl = document.getElementById("audioScheduleAt");
  if (!visible) {
    atEl.classList.add("hidden");
    return;
  }
  const isScheduled = String(modeEl.value || "immediate") === "scheduled";
  atEl.classList.toggle("hidden", !isScheduled);
  if (isScheduled && !atEl.value) {
    const dt = new Date(Date.now() + 10 * 60 * 1000);
    dt.setSeconds(0, 0);
    atEl.value = formatLocalDateTime(dt);
  }
}

function canGenerateAudioFromJsonText(jsonText) {
  const raw = String(jsonText || "").trim();
  if (!raw) return false;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const roleList = Array.isArray(parsed?.role_list) ? parsed.role_list : [];
  const juben = String(parsed?.juben || "").trim();
  return roleList.length > 0 && juben.length > 0;
}

async function syncGenerateAudioVisibility() {
  if (!activeNovel || !activeChapterNum) {
    setGenerateAudioVisible(false);
    return;
  }
  const chapter = getCurrentChapterState();
  if (!chapter?.hasJson) {
    setGenerateAudioVisible(false);
    return;
  }
  try {
    const output = await fetchChapterJsonOutput(activeNovel.id, activeChapterNum);
    setGenerateAudioVisible(canGenerateAudioFromJsonText(output?.jsonText || ""));
  } catch {
    setGenerateAudioVisible(false);
  }
}

function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "-";
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function calcWordCount(text) {
  return String(text || "").replace(/\s+/g, "").length;
}

function formatLocalDateTime(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function parseScheduleToUtcIso(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString();
}

function bindAudioScheduleControl() {
  const modeEl = document.getElementById("audioScheduleMode");
  const atEl = document.getElementById("audioScheduleAt");
  const syncScheduleInputVisibility = () => {
    if (document.getElementById("audioScheduleWrap").classList.contains("hidden")) {
      atEl.classList.add("hidden");
      return;
    }
    const isScheduled = modeEl.value === "scheduled";
    atEl.classList.toggle("hidden", !isScheduled);
    if (isScheduled && !atEl.value) {
      const dt = new Date(Date.now() + 10 * 60 * 1000);
      dt.setSeconds(0, 0);
      atEl.value = formatLocalDateTime(dt);
    }
  };
  modeEl.addEventListener("change", syncScheduleInputVisibility);
  syncScheduleInputVisibility();
}

function syncModalWordCount(form) {
  const content = String(form.content.value || "");
  const wc = content.trim() ? calcWordCount(content) : modalInitialWordCount;
  form.wordCount.value = String(wc);
}

function getNovelByQueryOrActive() {
  const url = new URL(window.location.href);
  const queryId = String(url.searchParams.get("novelId") || "");
  if (queryId) {
    return allNovels.find((n) => String(n.id) === queryId) || null;
  }
  return allNovels[0] || null;
}

function setHeader(novel) {
  document.getElementById("chapterPageTitle").textContent = `${novel.name} 章节管理`;
}

function renderNovelSelect() {
  const select = document.getElementById("chapterNovelSelect");
  select.innerHTML = allNovels.map((n) => `<option value="${n.id}">${n.name}</option>`).join("");
  if (activeNovel) select.value = String(activeNovel.id);
}

function renderQuickJump(list) {
  const wrap = document.getElementById("chapterQuickJump");
  wrap.innerHTML = list
    .slice(0, 200)
    .map((c) => {
      const progress = c.hasAudio ? 100 : c.hasJson ? 55 : 0;
      const activeClass = c.chapterNum === activeChapterNum ? "active" : "";
      return `<button class="quick-chip ${activeClass}" style="--progress:${progress}%" data-chapter-num="${c.chapterNum}">${String(c.chapterNum).padStart(3, "0")}</button>`;
    })
    .join("");
  wrap.querySelectorAll("[data-chapter-num]").forEach((el) => {
    el.addEventListener("click", () => loadChapter(Number(el.dataset.chapterNum)));
  });
}

function renderChapterList() {
  const keyword = document.getElementById("chapterSearch").value.trim();
  const list = keyword
    ? chapterState.filter((c) => c.title.includes(keyword) || String(c.chapterNum).includes(keyword))
    : chapterState;

  document.getElementById("chapterList").innerHTML = list
    .map((c) => {
      const activeClass = c.chapterNum === activeChapterNum ? "active" : "";
      return `<li class="chapter-item ${activeClass}" data-chapter-num="${c.chapterNum}">
        <strong>${c.title}</strong>
        <div class="meta chapter-item-meta">
          <span>字数 ${fmtNumber(c.wordCount)}</span>
          <span class="chapter-state-icons">
            <span class="state-icon state-json ${c.hasJson ? "done" : "todo"}" title="JSON"></span>
            <span class="state-icon state-audio ${c.hasAudio ? "done" : "todo"}" title="音频"></span>
          </span>
        </div>
      </li>`;
    })
    .join("");

  document.querySelectorAll(".chapter-item").forEach((el) => {
    el.addEventListener("click", () => loadChapter(Number(el.dataset.chapterNum)));
  });
  renderQuickJump(chapterState);
}

function setStatus(text) {
  document.getElementById("chapterStatus").textContent = text;
}

function getCurrentChapterState() {
  return chapterState.find((c) => c.chapterNum === activeChapterNum) || null;
}

function resetChapterAudioPlayer() {
  const box = document.getElementById("chapterAudioBox");
  const player = document.getElementById("chapterAudioPlayer");
  const duration = document.getElementById("chapterAudioDuration");
  box.classList.add("hidden");
  duration.textContent = "时长：-";
  player.pause();
  player.removeAttribute("src");
  player.load();
}

function refreshChapterAudioState(detail) {
  const downloadBtn = document.getElementById("downloadAudioBtn");
  if (!activeNovel || !detail?.hasAudio) {
    downloadBtn.disabled = true;
    resetChapterAudioPlayer();
    return;
  }
  const box = document.getElementById("chapterAudioBox");
  const player = document.getElementById("chapterAudioPlayer");
  const duration = document.getElementById("chapterAudioDuration");
  player.src = `/api/novels/${Number(activeNovel.id)}/chapters/${Number(detail.chapterNum)}/audio-stream`;
  duration.textContent = "时长：读取中...";
  box.classList.remove("hidden");
  downloadBtn.disabled = false;
}

async function loadChapter(chapterNum) {
  if (!activeNovel) return;
  activeChapterNum = chapterNum;
  try {
    const detail = await fetchChapterDetail(activeNovel.id, chapterNum);
    activeChapterDetail = detail;
    document.getElementById("chapterTitle").textContent = detail.title;
    document.getElementById("chapterMeta").textContent = `${detail.novelName} · 章节 ${detail.chapterNum} · 字数 ${fmtNumber(detail.wordCount)}`;
    document.getElementById("chapterContent").textContent = detail.content;
    refreshChapterAudioState(detail);
    await syncGenerateAudioVisibility();
    setStatus("就绪");
    renderChapterList();
  } catch (err) {
    setGenerateAudioVisible(false);
    resetChapterAudioPlayer();
    document.getElementById("downloadAudioBtn").disabled = true;
    setStatus(`读取章节失败: ${err.message}`);
  }
}

function copyText(text, successText) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text).then(() => toast(successText));
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  toast(successText);
  return Promise.resolve();
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderJsonViewMode() {
  const preview = document.getElementById("chapterJsonPreview");
  const editor = document.getElementById("chapterJsonEditor");
  const editBtn = document.getElementById("editJsonViewBtn");
  const saveBtn = document.getElementById("saveJsonViewBtn");
  const rawBtn = document.getElementById("viewJsonRawBtn");
  const jubenBtn = document.getElementById("viewJsonJubenBtn");
  const rolesBtn = document.getElementById("viewJsonRolesBtn");
  rawBtn.classList.toggle("active", jsonViewMode === "raw");
  jubenBtn.classList.toggle("active", jsonViewMode === "juben");
  rolesBtn.classList.toggle("active", jsonViewMode === "roles");

  const canEdit = jsonViewMode === "juben" || jsonViewMode === "roles";
  editBtn.classList.toggle("hidden", !canEdit);
  saveBtn.classList.toggle("hidden", !jsonViewEditing);
  editBtn.textContent = jsonViewEditing ? "取消编辑" : "编辑";
  preview.classList.toggle("hidden", jsonViewEditing);
  editor.classList.toggle("hidden", !jsonViewEditing);

  if (jsonViewEditing) {
    if (jsonViewMode === "juben") {
      editor.value = String(jsonViewParsed?.juben || "").trim();
    } else if (jsonViewMode === "roles") {
      const roles = Array.isArray(jsonViewParsed?.role_list) ? jsonViewParsed.role_list : [];
      editor.value = JSON.stringify(roles, null, 2);
    } else {
      editor.value = jsonViewRawText || "";
    }
    return;
  }

  if (jsonViewMode === "raw") {
    if (jsonViewParsed && typeof jsonViewParsed === "object") {
      preview.textContent = JSON.stringify(jsonViewParsed, null, 2);
    } else {
      preview.textContent = jsonViewRawText || JSON.stringify({ role_list: [], juben: "" }, null, 2);
    }
    return;
  }

  if (!jsonViewParsed || typeof jsonViewParsed !== "object") {
    preview.textContent = "JSON 解析失败，无法显示此视图。";
    return;
  }

  if (jsonViewMode === "juben") {
    const juben = String(jsonViewParsed.juben || "").trim();
    preview.textContent = juben || "该 JSON 没有 juben 字段。";
    return;
  }

  const list = Array.isArray(jsonViewParsed.role_list) ? jsonViewParsed.role_list : [];
  if (!list.length) {
    preview.textContent = "该 JSON 没有 role_list 数据。";
    return;
  }
  const lines = list.map((x, i) => {
    const name = String(x?.name || "").trim() || `角色${i + 1}`;
    const instruct = String(x?.instruct || "").trim() || "-";
    const sample = String(x?.text || "").trim() || "-";
    return `【${name}】\n人设: ${instruct}\n示例: ${sample}`;
  });
  preview.textContent = lines.join("\n\n");
}

async function saveJsonViewEdit() {
  if (!activeNovel || !activeChapterNum || !jsonViewParsed || typeof jsonViewParsed !== "object") {
    toast("当前章节 JSON 不可编辑");
    return;
  }
  const editor = document.getElementById("chapterJsonEditor");
  const draft = JSON.parse(JSON.stringify(jsonViewParsed));

  if (jsonViewMode === "juben") {
    draft.juben = String(editor.value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  } else if (jsonViewMode === "roles") {
    let roles;
    try {
      roles = JSON.parse(String(editor.value || "[]"));
    } catch {
      toast("角色编辑内容必须是合法 JSON 数组");
      return;
    }
    if (!Array.isArray(roles)) {
      toast("角色编辑内容必须是 JSON 数组");
      return;
    }
    draft.role_list = roles.map((x) => ({
      name: String(x?.name || "").trim(),
      instruct: String(x?.instruct || "").trim(),
      text: String(x?.text || "").trim(),
    }));
  } else {
    toast("当前模式不支持编辑");
    return;
  }

  const merged = JSON.stringify(draft, null, 2);
  await saveChapterJsonOutput(activeNovel.id, activeChapterNum, merged);
  jsonViewParsed = draft;
  jsonViewRawText = merged;
  jsonViewEditing = false;
  renderJsonViewMode();
  await syncGenerateAudioVisibility();
  setStatus("JSON 已保存");
  toast("JSON 已保存");
}

async function refreshChapters() {
  if (!activeNovel) return;
  chapterState = await fetchNovelChapters(activeNovel.id);
  if (chapterState.length === 0) {
    activeChapterNum = null;
    activeChapterDetail = null;
    setGenerateAudioVisible(false);
    resetChapterAudioPlayer();
    document.getElementById("downloadAudioBtn").disabled = true;
    document.getElementById("chapterTitle").textContent = "暂无章节";
    document.getElementById("chapterMeta").textContent = "当前小说尚未创建章节";
    document.getElementById("chapterContent").textContent = "请先点击“创建章回”录入章节信息。";
    renderChapterList();
    return;
  }
  if (!chapterState.some((x) => x.chapterNum === activeChapterNum)) {
    activeChapterNum = chapterState[0].chapterNum;
  }
  renderChapterList();
  await loadChapter(activeChapterNum);
}

function bindActions() {
  document.getElementById("copyChapterBtn").addEventListener("click", () => {
    if (!activeChapterDetail) return;
    copyText(`${activeChapterDetail.title}\n\n${activeChapterDetail.content}`, "正文已复制");
  });

  document.getElementById("downloadChapterBtn").addEventListener("click", () => {
    if (!activeChapterDetail || !activeNovel) return;
    downloadText(`${activeNovel.name}-${activeChapterDetail.title}.txt`, activeChapterDetail.content || "");
    setStatus("开始下载文本");
  });

  document.getElementById("convertJsonBtn").addEventListener("click", async () => {
    if (!activeNovel || !activeChapterNum) return;
    try {
      await requestConvertJson(activeNovel.id, activeChapterNum);
      incrementNavBadge("json", 1);
      renderNav();
      setStatus("已加入 JSON 转换队列");
      toast("已加入 JSON 转换队列");
      await refreshChapters();
    } catch (err) {
      setStatus(`加入 JSON 队列失败: ${err.message}`);
      toast(`加入 JSON 队列失败: ${err.message}`);
    }
  });

  document.getElementById("viewJsonBtn").addEventListener("click", async () => {
    if (!activeNovel || !activeChapterNum) return;
    const output = await fetchChapterJsonOutput(activeNovel.id, activeChapterNum);
    const text = output.jsonText || JSON.stringify({ role_list: [], juben: "" }, null, 2);
    jsonViewRawText = text;
    jsonViewParsed = null;
    try {
      jsonViewParsed = JSON.parse(text);
    } catch {
      jsonViewParsed = null;
    }
    jsonViewMode = "raw";
    jsonViewEditing = false;
    renderJsonViewMode();
    document.getElementById("jsonDialog").showModal();
  });

  document.getElementById("viewJsonRawBtn").addEventListener("click", () => {
    jsonViewMode = "raw";
    jsonViewEditing = false;
    renderJsonViewMode();
  });
  document.getElementById("viewJsonJubenBtn").addEventListener("click", () => {
    jsonViewMode = "juben";
    jsonViewEditing = false;
    renderJsonViewMode();
  });
  document.getElementById("viewJsonRolesBtn").addEventListener("click", () => {
    jsonViewMode = "roles";
    jsonViewEditing = false;
    renderJsonViewMode();
  });

  document.getElementById("editJsonViewBtn").addEventListener("click", () => {
    if (jsonViewMode !== "juben" && jsonViewMode !== "roles") return;
    jsonViewEditing = !jsonViewEditing;
    renderJsonViewMode();
  });
  document.getElementById("saveJsonViewBtn").addEventListener("click", async () => {
    await saveJsonViewEdit();
  });

  document.getElementById("copyJsonBtn").addEventListener("click", () => {
    const text = jsonViewEditing
      ? document.getElementById("chapterJsonEditor").value || ""
      : document.getElementById("chapterJsonPreview").textContent || "";
    copyText(text, "JSON 已复制");
  });

  document.getElementById("generateAudioBtn").addEventListener("click", async () => {
    if (!activeNovel || !activeChapterNum) return;
    const scheduleMode = String(document.getElementById("audioScheduleMode").value || "immediate");
    let scheduledAt = "";
    let scheduledAtText = "";
    if (scheduleMode === "scheduled") {
      const rawLocal = document.getElementById("audioScheduleAt").value;
      scheduledAt = parseScheduleToUtcIso(rawLocal);
      if (!scheduledAt) {
        setStatus("请选择有效的执行时间");
        toast("请选择有效的执行时间");
        return;
      }
      const dtLocal = new Date(rawLocal);
      scheduledAtText = Number.isNaN(dtLocal.getTime()) ? rawLocal : dtLocal.toLocaleString("zh-CN", { hour12: false });
    }
    try {
      await requestGenerateAudio(activeNovel.id, activeChapterNum, { scheduledAt });
      incrementNavBadge("audio", 1);
      renderNav();
      if (scheduleMode === "scheduled") {
        setStatus(`有声任务已预约（${scheduledAtText}）`);
        toast(`有声任务已预约（${scheduledAtText}）`);
      } else {
        setStatus("已加入有声队列");
        toast("已加入有声队列");
      }
      await refreshChapters();
    } catch (err) {
      setStatus(`加入有声队列失败: ${err.message}`);
      toast(`加入有声队列失败: ${err.message}`);
    }
  });

  document.getElementById("downloadAudioBtn").addEventListener("click", () => {
    if (!activeNovel || !activeChapterDetail) return;
    if (!activeChapterDetail.hasAudio) {
      setStatus("当前章回暂无音频");
      return;
    }
    downloadChapterAudio(activeNovel.id, activeChapterDetail.chapterNum)
      .then(() => {
        setStatus("开始下载音频");
      })
      .catch((err) => {
        setStatus(`下载音频失败: ${err.message}`);
      });
  });

  document.getElementById("createChapterBtn").addEventListener("click", () => {
    openChapterModal("create");
  });

  document.getElementById("editChapterBtn").addEventListener("click", () => {
    openChapterModal("edit");
  });

  document.getElementById("deleteChapterBtn").addEventListener("click", async () => {
    if (!activeNovel || !activeChapterNum) return;
    const chapter = getCurrentChapterState();
    if (!chapter) return;
    if (!window.confirm(`确认删除 ${chapter.title} 吗？该操作不可恢复。`)) return;
    try {
      await deleteChapter(activeNovel.id, activeChapterNum);
      toast("章回已删除");
      await refreshChapters();
    } catch (err) {
      toast(`删除失败: ${err.message}`);
    }
  });

  document.getElementById("chapterCancelBtn").addEventListener("click", () => {
    document.getElementById("chapterModal").close();
  });

  document.getElementById("chapterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeNovel) return;
    const form = event.currentTarget;
    const input = {
      chapterNum: Number(form.chapterNum.value),
      title: form.title.value.trim(),
      content: form.content.value,
    };
    if (!input.chapterNum || !input.title) {
      toast("请填写章回序号和标题");
      return;
    }
    try {
      if (chapterModalMode === "create") {
        await createChapter(activeNovel.id, input);
        toast("章回已创建");
      } else {
        await updateChapter(activeNovel.id, chapterEditSourceNum, input);
        toast("章回已更新");
      }
      document.getElementById("chapterModal").close();
      activeChapterNum = input.chapterNum;
      await refreshChapters();
    } catch (err) {
      toast(`保存失败: ${err.message}`);
    }
  });

  const chapterForm = document.getElementById("chapterForm");
  const contentInput = chapterForm.elements.namedItem("content");
  if (contentInput) {
    contentInput.addEventListener("input", () => {
      syncModalWordCount(chapterForm);
    });
  }

  document.getElementById("chapterSearch").addEventListener("input", renderChapterList);
  document.getElementById("chapterNovelSelect").addEventListener("change", async (event) => {
    const id = Number(event.target.value);
    setActiveNovelId(id);
    activeNovel = allNovels.find((n) => Number(n.id) === id) || null;
    if (!activeNovel) return;
    setHeader(activeNovel);
    await refreshChapters();
    toast(`已切换到 ${activeNovel.name}`);
  });

  const player = document.getElementById("chapterAudioPlayer");
  const duration = document.getElementById("chapterAudioDuration");
  player.addEventListener("loadedmetadata", () => {
    duration.textContent = `时长：${fmtDuration(player.duration)}`;
  });
  player.addEventListener("durationchange", () => {
    duration.textContent = `时长：${fmtDuration(player.duration)}`;
  });
  player.addEventListener("error", () => {
    duration.textContent = "时长：读取失败";
  });

  bindAudioScheduleControl();
}

function openChapterModal(mode) {
  if (!activeNovel) return;
  const form = document.getElementById("chapterForm");
  const modal = document.getElementById("chapterModal");
  chapterModalMode = mode;
  chapterEditSourceNum = null;

  if (mode === "create") {
    const maxNum = chapterState.reduce((m, c) => Math.max(m, c.chapterNum), 0);
    document.getElementById("chapterModalTitle").textContent = "创建章回";
    form.chapterNum.value = String(maxNum + 1);
    form.title.value = "";
    modalInitialWordCount = 0;
    form.content.value = "";
    syncModalWordCount(form);
    modal.showModal();
    return;
  }

  if (!activeChapterDetail) {
    toast("请先选择一个章回");
    return;
  }
  chapterEditSourceNum = activeChapterDetail.chapterNum;
  document.getElementById("chapterModalTitle").textContent = "编辑章回";
  form.chapterNum.value = String(activeChapterDetail.chapterNum);
  form.title.value = activeChapterDetail.title || "";
  modalInitialWordCount = Number(activeChapterDetail.wordCount) || 0;
  form.content.value = activeChapterDetail.content || "";
  syncModalWordCount(form);
  modal.showModal();
}

async function init() {
  renderNav();
  document.getElementById("downloadAudioBtn").disabled = true;
  setGenerateAudioVisible(false);
  resetChapterAudioPlayer();
  const data = await getData();
  allNovels = data.novels || [];
  activeNovel = getNovelByQueryOrActive();
  if (!activeNovel) {
    document.getElementById("chapterPageTitle").textContent = "暂无小说可管理";
    return;
  }
  setActiveNovelId(activeNovel.id);
  setHeader(activeNovel);
  renderNovelSelect();
  bindActions();
  await refreshChapters();
}

init().catch((err) => {
  renderNav();
  showPageError(err, "章节管理页初始化失败");
});
