import { deleteWorkflow, duplicateWorkflow, getData, saveWorkflow } from "./store.js";
import { renderNav, showPageError, toast } from "./ui.js";

let editingId = "";
let modalMode = "create";
let currentData = { workflows: [] };

function orderedWorkflows() {
  return [...(currentData.workflows || [])].sort((a, b) => {
    const at = a.type === "system" ? 0 : 1;
    const bt = b.type === "system" ? 0 : 1;
    if (at !== bt) return at - bt;
    return Number(b.id) - Number(a.id);
  });
}

function render() {
  document.getElementById("workflowList").innerHTML = orderedWorkflows()
    .map(
      (w) => `
      <article class="asset-card">
        <div class="queue-head">
          <h3>${w.name}</h3>
          <span class="chip ${w.type === "system" ? "pending" : "completed"}">${w.type === "system" ? "系统" : "用户"}</span>
        </div>
        <p class="meta">${w.description || "-"}</p>
        <div class="card-actions">
          <button class="ghost-btn" data-action="copy" data-id="${w.id}">复制为用户工作流</button>
          <button class="ghost-btn" data-action="${w.type === "system" ? "view" : "edit"}" data-id="${w.id}">${w.type === "system" ? "查看" : "编辑"}</button>
          ${w.type === "user" ? `<button class="ghost-btn" data-action="delete" data-id="${w.id}">删除</button>` : ""}
        </div>
      </article>
    `
    )
    .join("");

  document.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", () => onAction(el.dataset.action, el.dataset.id));
  });
}

function setFormReadonly(readonly) {
  const form = document.getElementById("workflowForm");
  form.name.readOnly = readonly;
  form.description.readOnly = readonly;
  form.jsonText.readOnly = readonly;
  const saveBtn = document.getElementById("workflowSaveBtn");
  saveBtn.hidden = readonly;
  document.getElementById("workflowCancelBtn").textContent = readonly ? "关闭" : "取消";
}

function openModal(item, mode = "create") {
  modalMode = mode;
  editingId = item?.id || "";
  document.getElementById("workflowModalTitle").textContent =
    mode === "view" ? "查看系统工作流" : editingId ? "编辑工作流" : "创建工作流";
  const form = document.getElementById("workflowForm");
  form.name.value = item?.name || "";
  form.description.value = item?.description || "";
  form.jsonText.value = item?.jsonText || '{"workflow":""}';
  setFormReadonly(mode === "view");
  document.getElementById("workflowModal").showModal();
}

function onAction(action, id) {
  const item = currentData.workflows.find((w) => String(w.id) === String(id));
  if (!item) return;
  if (action === "copy") {
    duplicateWorkflow(id)
      .then(async () => {
        toast("已复制为用户工作流");
        currentData = await getData();
        render();
      })
      .catch((err) => toast(`复制失败: ${err.message}`));
  }
  if (action === "edit") {
    openModal(item, "edit");
  }
  if (action === "view") {
    openModal(item, "view");
  }
  if (action === "delete") {
    if (!window.confirm(`确认删除工作流 ${item.name} 吗？`)) return;
    deleteWorkflow(id)
      .then(async () => {
        toast("工作流已删除");
        currentData = await getData();
        render();
      })
      .catch((err) => toast(`删除失败: ${err.message}`));
  }
}

function bindEvents() {
  document.getElementById("createWorkflowBtn").addEventListener("click", () => openModal(null, "create"));
  document.getElementById("workflowCancelBtn").addEventListener("click", () => {
    document.getElementById("workflowModal").close();
  });
  document.getElementById("workflowForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (modalMode === "view") {
      document.getElementById("workflowModal").close();
      return;
    }
    const form = event.currentTarget;
    await saveWorkflow(
      {
        name: form.name.value.trim(),
        description: form.description.value.trim(),
        jsonText: form.jsonText.value.trim(),
      },
      editingId
    );
    document.getElementById("workflowModal").close();
    toast(editingId ? "工作流已更新" : "工作流已创建");
    currentData = await getData();
    render();
  });
}

async function init() {
  renderNav();
  bindEvents();
  currentData = await getData();
  render();
}

init().catch((err) => {
  renderNav();
  showPageError(err, "工作流页初始化失败");
});
