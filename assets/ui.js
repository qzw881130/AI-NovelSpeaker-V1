import { getActiveNovelId, getData, setActiveNovelId } from "./store.js";

const NAV_ITEMS = [
  { href: "./index.html", label: "小说管理" },
  { href: "./chapters.html", label: "章节管理" },
  { href: "./json-tasks.html", label: "JSON任务" },
  { href: "./audio-queue.html", label: "有声队列" },
  { href: "./prompts.html", label: "提示词管理" },
  { href: "./workflows.html", label: "工作流管理" },
  { href: "./settings.html", label: "系统配置" },
  { href: "./novel-capture.html", label: "小说抓取" },
];

const NAV_BADGE_KEYS = {
  json: "ai_novel_nav_badge_json",
  audio: "ai_novel_nav_badge_audio",
};

function getNavBadgeCount(type) {
  const key = NAV_BADGE_KEYS[type];
  if (!key) return 0;
  const n = Number(localStorage.getItem(key) || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function setNavBadgeCount(type, value) {
  const key = NAV_BADGE_KEYS[type];
  if (!key) return;
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, String(Math.floor(n)));
}

function incrementNavBadge(type, delta = 1) {
  const next = getNavBadgeCount(type) + Number(delta || 0);
  setNavBadgeCount(type, next);
}

function clearNavBadge(type) {
  setNavBadgeCount(type, 0);
}

function navBadgeForHref(href) {
  if (href === "./json-tasks.html") {
    return getNavBadgeCount("json");
  }
  if (href === "./audio-queue.html") {
    return getNavBadgeCount("audio");
  }
  return 0;
}

function renderNav() {
  const nav = document.getElementById("mainNav");
  if (!nav) return;
  const current = window.location.pathname.split("/").pop() || "index.html";
  const links = NAV_ITEMS.map((item) => {
    const active = current === item.href.replace("./", "") ? "active" : "";
    const badge = navBadgeForHref(item.href);
    return `<a class="nav-link ${active}" href="${item.href}"><span>${item.label}</span>${badge > 0 ? `<i class="nav-badge">+${badge}</i>` : ""}</a>`;
  }).join("");

  nav.innerHTML = `
    <div class="brand">
      <strong>AI NovelSpeaker V1</strong>
    </div>
    ${links}
  `;
}

async function bindNovelSelector(selectId, onChanged) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const data = await getData();
  const activeId = getActiveNovelId();
  select.innerHTML = data.novels
    .map((n) => `<option value="${n.id}">${n.name}</option>`)
    .join("");
  if (activeId) {
    select.value = activeId;
  }
  select.onchange = () => {
    setActiveNovelId(select.value);
    if (onChanged) onChanged(select.value);
  };
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 1800);
}

function fmtNumber(num) {
  return new Intl.NumberFormat("zh-CN").format(Number(num || 0));
}

function showPageError(error, fallbackText = "页面初始化失败") {
  const page = document.querySelector(".page");
  if (!page) return;
  const message = String(error?.message || fallbackText || "页面初始化失败");
  let box = document.getElementById("pageErrorBanner");
  if (!box) {
    box = document.createElement("div");
    box.id = "pageErrorBanner";
    box.className = "page-error-banner";
    page.prepend(box);
  }
  box.innerHTML = `
    <strong>数据加载失败</strong>
    <span>${message}</span>
    <span>请确认已执行 scripts/init_storage.py，并使用 app_server.py 启动服务。</span>
  `;
  toast(`加载失败: ${message}`);
}

export {
  bindNovelSelector,
  clearNavBadge,
  fmtNumber,
  incrementNavBadge,
  renderNav,
  showPageError,
  toast,
};
