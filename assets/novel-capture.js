import { renderNav, showPageError, toast } from "./ui.js";
import { getActiveNovelId, getData } from "./store.js";

let serviceRunning = false;
let logTimer = null;

function renderServiceState() {
  const statusEl = document.getElementById("serviceStatus");
  const toggleBtn = document.getElementById("serviceToggleBtn");
  if (!statusEl || !toggleBtn) return;

  statusEl.textContent = serviceRunning ? "已启动" : "未启动";
  statusEl.classList.toggle("online", serviceRunning);
  statusEl.classList.toggle("offline", !serviceRunning);
  toggleBtn.textContent = serviceRunning ? "结束服务" : "启动服务";
}

async function probeServer() {
  const server = document.getElementById("captureServer").value.trim();
  if (!server) {
    serviceRunning = false;
    renderServiceState();
    return false;
  }
  try {
    const res = await fetch("/api/network/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: server }),
    });
    const data = await res.json();
    serviceRunning = Boolean(data.ok);
    renderServiceState();
    return serviceRunning;
  } catch {
    serviceRunning = false;
    renderServiceState();
    return false;
  }
}

async function fetchCaptureStatus() {
  try {
    const res = await fetch("/api/capture-service/status");
    const data = await res.json();
    serviceRunning = Boolean(data.running);
    renderServiceState();
  } catch {
    serviceRunning = false;
    renderServiceState();
  }
}

async function toggleServiceByPage() {
  const server = document.getElementById("captureServer").value.trim();
  if (!server) {
    toast("请先填写服务地址");
    return;
  }
  const endpoint = serviceRunning ? "/api/capture-service/stop" : "/api/capture-service/start";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: server }),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || data.message || `HTTP ${res.status}`);
  }
}

function getConnectHost(serverUrl) {
  try {
    return new URL(serverUrl).hostname;
  } catch {
    return "192.168.50.3";
  }
}

function buildScript({ server, novelId, bookId, firstId, lastId }) {
  const connectHost = getConnectHost(server);
  return `// ==UserScript==
// @name         99csw 上报（手动版）
// @namespace    local.shz
// @version      1.1.0
// @description  读取当前章 chapter_num/title/content 并上报；默认不自动跳页
// @match        https://www.99csw.com/book/${bookId}/*.htm*
// @grant        GM_xmlhttpRequest
// @connect      ${connectHost}
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SERVER = '${server}';
    const NOVEL_ID = '${novelId}';
    const BOOK_ID = ${bookId};
    const FIRST_ID = ${firstId};
    const LAST_ID = ${lastId};
    const WAIT_TIMEOUT = 20000;
    const POLL_MS = 1200;

    // false: 仅上报当前页，不跳转。true: 上报成功后自动跳下一章。
    const AUTO_NEXT = true;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function getChapterIdFromUrl() {
        const m = window.location.pathname.match(new RegExp('/book/' + BOOK_ID + '/(\\\\d+)\\\\.htm'));
        return m ? Number(m[1]) : null;
    }

    function chapterNum(chapterId) {
        return chapterId - FIRST_ID + 1;
    }

    function isLoadingVisible() {
        const loadingSpan = Array.from(document.querySelectorAll('span')).find((el) => {
            return (el.textContent || '').trim() === '努力加载中...';
        });

        if (!loadingSpan || !loadingSpan.parentElement) {
            return false;
        }

        const parentStyle = window.getComputedStyle(loadingSpan.parentElement);
        return parentStyle.display !== 'none' && parentStyle.visibility !== 'hidden';
    }

    function extractData() {
        const contentEl = document.getElementById('content');
        if (!contentEl) {
            return { title: '', content: '' };
        }

        const rawText = String(contentEl.innerText || '').replace(/\\r\\n?/g, '\\n');
        const rows = rawText
            .split('\\n')
            .map((line) => line.trim())
            .filter((line) => line && line !== '努力加载中...');

        if (rows.length === 0) {
            return { title: '', content: '' };
        }

        const title = rows[0] || '';
        const content = rows.slice(1).join('\\n').trim();
        return { title, content };
    }

    function postJSON(path, payload) {
        const url = SERVER + path;
        const body = JSON.stringify(payload);

        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    data: body,
                    timeout: 30000,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) {
                            resolve(res.responseText);
                        } else {
                            reject(new Error('HTTP ' + res.status + ': ' + (res.responseText || '')));
                        }
                    },
                    ontimeout: () => reject(new Error('request timeout')),
                    onerror: () => reject(new Error('network error')),
                });
            });
        }

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 30000;

            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) {
                    return;
                }
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.responseText);
                } else {
                    reject(new Error('HTTP ' + xhr.status + ': ' + (xhr.responseText || '')));
                }
            };

            xhr.ontimeout = function () {
                reject(new Error('request timeout'));
            };

            xhr.onerror = function () {
                reject(new Error('network error'));
            };

            xhr.send(body);
        });
    }

    async function waitReadyOrReload() {
        const startAt = Date.now();

        while (true) {
            const result = extractData();
            const title = result.title;
            const content = result.content;
            const contentLen = content.replace(/\\s+/g, '').length;
            if (!isLoadingVisible() && title && contentLen > 50) {
                return true;
            }

            if (Date.now() - startAt > WAIT_TIMEOUT) {
                const u = new URL(window.location.href);
                u.searchParams.set('x', '' + Date.now() + Math.floor(Math.random() * 100000));
                window.location.href = u.toString();
                return false;
            }

            const scrollingEl = document.scrollingElement || document.documentElement || document.body;
            const scrollTop = scrollingEl ? Math.max(scrollingEl.scrollHeight, 0) : 0;
            if (scrollTop > 0) {
                window.scrollTo({ top: scrollTop, behavior: 'smooth' });
            }
            await sleep(POLL_MS);
        }
    }

    function getNextChapterUrl(chapterId) {
        const nextId = chapterId + 1;
        if (nextId > LAST_ID) {
            return null;
        }
        return window.location.origin + '/book/' + BOOK_ID + '/' + nextId + '.htm';
    }

    async function main() {
        const chapterId = getChapterIdFromUrl();
        if (!chapterId || chapterId < FIRST_ID || chapterId > LAST_ID) {
            console.error('当前页面不在目标章节范围内。');
            return;
        }

        const ready = await waitReadyOrReload();
        if (!ready) {
            return;
        }

        const result = extractData();
        const title = result.title;
        const content = result.content;
        if (!title || !content) {
            console.error('标题或正文为空，停止上报。');
            return;
        }

        const num = chapterNum(chapterId);
        const responseText = await postJSON('/chapter', {
            novel_id: NOVEL_ID,
            chapter_num: num,
            title,
            content,
        });

        let savedFile = '';
        try {
            const parsed = JSON.parse(responseText || '{}');
            savedFile = parsed.saved_file || '';
        } catch (_) {
            savedFile = '';
        }

        console.log('✓ 上报成功: 第' + num + '回 ' + title);
        if (savedFile) {
            console.log('保存文件: ' + savedFile);
        }

        if (!AUTO_NEXT) {
            console.log('手动模式：不自动跳转，下一章请手动打开后再次运行。');
            return;
        }

        const nextUrl = getNextChapterUrl(chapterId);
        if (!nextUrl) {
            await postJSON('/finalize', { novel_id: NOVEL_ID });
            console.log('✓ 已到最后一章，finalize 完成。');
            return;
        }

        window.location.href = nextUrl;
    }

    main().catch((err) => {
        console.error('脚本异常:', err);
    });
})();
`;
}

function readParams() {
  return {
    server: document.getElementById("captureServer").value.trim(),
    novelId: document.getElementById("captureNovelId").value.trim(),
    bookId: Number(document.getElementById("captureBookId").value || 0),
    firstId: Number(document.getElementById("captureFirstId").value || 0),
    lastId: Number(document.getElementById("captureLastId").value || 0),
  };
}

function formatLogTime(value) {
  if (!value) return "-";
  const s = String(value).replace(" ", "T");
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function renderCaptureLogs(logs) {
  const wrap = document.getElementById("captureLogList");
  if (!wrap) return;
  if (!Array.isArray(logs) || logs.length === 0) {
    wrap.innerHTML = `<div class="capture-log-item"><strong>暂无上传记录</strong><span>当脚本开始上报章节后，这里会显示时间、章回和字数。</span></div>`;
    return;
  }
  wrap.innerHTML = logs
    .map(
      (item) => `
      <article class="capture-log-item">
        <strong>${formatLogTime(item.time)}</strong>
        <span>${item.novelName || ""} · 第${item.chapterNum}回 ${item.chapterTitle || ""}</span>
        <span>字数：${item.wordCount || 0}</span>
      </article>
    `
    )
    .join("");
}

async function fetchCaptureLogs() {
  const novelId = document.getElementById("captureNovelId")?.value || "";
  try {
    const query = new URLSearchParams({ novelId: String(novelId || 0), limit: "80" });
    const res = await fetch(`/api/capture/logs?${query.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderCaptureLogs(data.logs || []);
  } catch {
    renderCaptureLogs([]);
  }
}

async function fillNovelSelect() {
  const select = document.getElementById("captureNovelId");
  if (!select) return;
  const data = await getData();
  select.innerHTML = data.novels
    .map((novel) => `<option value="${novel.id}">${novel.name} (${novel.id})</option>`)
    .join("");

  const activeNovelId = getActiveNovelId();
  if (activeNovelId && data.novels.some((novel) => String(novel.id) === String(activeNovelId))) {
    select.value = activeNovelId;
  }
}

function renderScript() {
  const p = readParams();
  document.getElementById("scriptOutput").textContent = buildScript(p);
}

async function copyScript() {
  const text = document.getElementById("scriptOutput").textContent || "";
  if (!text.trim()) return;
  const copyBtn = document.getElementById("copyScriptBtn");
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(text);
    if (copyBtn) copyBtn.textContent = "已复制";
    window.setTimeout(() => {
      if (copyBtn) copyBtn.textContent = "复制代码";
    }, 1200);
    toast("代码已复制");
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  if (copyBtn) copyBtn.textContent = "已复制";
  window.setTimeout(() => {
    if (copyBtn) copyBtn.textContent = "复制代码";
  }, 1200);
  toast("代码已复制");
}

function bindEvents() {
  ["captureNovelId", "captureServer", "captureBookId", "captureFirstId", "captureLastId"].forEach((id) => {
    const el = document.getElementById(id);
    const onChanged = () => {
      renderScript();
      if (id === "captureNovelId") {
        fetchCaptureLogs();
      }
      if (id === "captureServer") {
        serviceRunning = false;
        renderServiceState();
        probeServer();
      }
    };
    el.addEventListener("input", onChanged);
    el.addEventListener("change", onChanged);
  });
  document.getElementById("copyScriptBtn").addEventListener("click", () => {
    copyScript().catch(() => toast("复制失败，请手动复制"));
  });

  document.getElementById("serviceToggleBtn").addEventListener("click", () => {
    toggleServiceByPage()
      .then(async () => {
        await fetchCaptureStatus();
        const ok = await probeServer();
        if (ok) toast("抓取服务已启动");
        else toast("抓取服务已停止");
      })
      .catch(() => {
        toast("操作失败，请检查地址或端口占用");
      });
  });
}

async function init() {
  renderNav();
  await fillNovelSelect();
  bindEvents();
  renderScript();
  await fetchCaptureStatus();
  renderServiceState();
  await probeServer();
  await fetchCaptureLogs();
  if (logTimer) window.clearInterval(logTimer);
  logTimer = window.setInterval(() => {
    fetchCaptureLogs();
  }, 3000);
}

init().catch((err) => {
  renderNav();
  showPageError(err, "小说抓取页初始化失败");
});
