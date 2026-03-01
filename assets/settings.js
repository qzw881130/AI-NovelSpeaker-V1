import { getData, saveSettings } from "./store.js";
import { renderNav, showPageError, toast } from "./ui.js";

const providerDefaults = {
  grok: { baseUrl: "https://api.x.ai/v1", model: "grok-2-latest" },
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  qwen: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  custom: { baseUrl: "", model: "" },
};

const BATCH_CHAR_OPTIONS = new Set([3500, 4000, 5000, 6000, 7000]);

function friendlyErrorText(raw, type) {
  const msg = String(raw || "");
  const lower = msg.toLowerCase();

  if (!msg) return "连接失败，请检查配置后重试";
  if (lower.includes("connection refused") || lower.includes("errno 61")) {
    return type === "comfy"
      ? "连接被拒绝，请确认 ComfyUI 已启动且地址正确"
      : "连接被拒绝，请确认模型服务地址可访问";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "请求超时，请检查网络或代理设置";
  }
  if (lower.includes("name or service not known") || lower.includes("nodename nor servname")) {
    return "域名或地址无法解析，请检查 API Base URL";
  }
  if (lower.includes("api key") && lower.includes("不能为空")) {
    return "请先填写 API Key 再测试";
  }
  if (lower.includes("认证失败") || lower.includes("http 401") || lower.includes("http 403")) {
    return "认证失败，请检查 API Key 是否正确";
  }
  if (lower.includes("http 404")) {
    return "接口地址不可用，请检查 API Base URL";
  }
  if (lower.includes("http 429") || lower.includes("频率") || lower.includes("额度")) {
    return "请求过于频繁或额度不足，请稍后重试";
  }
  if (lower.includes("http 5")) {
    return "服务暂时不可用，请稍后重试";
  }
  if (type === "comfy" && lower.includes("system_stats")) {
    return "连接成功，ComfyUI 接口可访问";
  }
  if (type === "llm" && lower.includes("模型接口可调用")) {
    return "连接成功，模型可正常调用";
  }
  return msg.length > 60 ? `${msg.slice(0, 60)}...` : msg;
}

function load(settings) {
  const llm = settings.llm || {};
  document.getElementById("comfyUrl").value = settings.comfyUrl || "";
  document.getElementById("proxyUrl").value = settings.proxyUrl || "";
  document.getElementById("llmProvider").value = llm.provider || "grok";
  document.getElementById("llmBase").value = llm.baseUrl || "";
  document.getElementById("llmModel").value = llm.model || "";
  document.getElementById("llmKey").value = llm.apiKey || "";
  document.getElementById("llmTemperature").value = llm.temperature ?? 0.3;
  document.getElementById("llmTokens").value = llm.maxTokens ?? 8192;
  const batchChars = Number(llm.batchMaxChars || 3500);
  document.getElementById("llmBatchChars").value = BATCH_CHAR_OPTIONS.has(batchChars)
    ? String(batchChars)
    : "3500";
}

function readSettingsForm() {
  return {
    comfyUrl: document.getElementById("comfyUrl").value.trim(),
    proxyUrl: document.getElementById("proxyUrl").value.trim(),
    llm: {
      provider: document.getElementById("llmProvider").value,
      baseUrl: document.getElementById("llmBase").value.trim(),
      model: document.getElementById("llmModel").value.trim(),
      apiKey: document.getElementById("llmKey").value.trim(),
      temperature: Number(document.getElementById("llmTemperature").value),
      maxTokens: Number(document.getElementById("llmTokens").value),
      batchMaxChars: Number(document.getElementById("llmBatchChars").value || 3500),
    },
  };
}

function setTestResult(id, status, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("ok", "fail");
  if (status === "ok") el.classList.add("ok");
  if (status === "fail") el.classList.add("fail");
  el.textContent = text;
}

async function testComfy() {
  setTestResult("testComfyResult", "", "测试中...");
  const payload = readSettingsForm();
  try {
    const res = await fetch("/api/settings/test-comfy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    setTestResult("testComfyResult", "ok", `可用 · ${friendlyErrorText(data.message || "连接成功", "comfy")}`);
    toast("ComfyUI 连接正常");
  } catch (err) {
    const text = friendlyErrorText(err.message, "comfy");
    setTestResult("testComfyResult", "fail", `失败 · ${text}`);
    toast(`ComfyUI 测试失败：${text}`);
  }
}

async function testLlm() {
  setTestResult("testLlmResult", "", "测试中...");
  const payload = readSettingsForm();
  try {
    const res = await fetch("/api/settings/test-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    setTestResult("testLlmResult", "ok", `可用 · ${friendlyErrorText(data.message || "调用成功", "llm")}`);
    toast("LLM 连接正常");
  } catch (err) {
    const text = friendlyErrorText(err.message, "llm");
    setTestResult("testLlmResult", "fail", `失败 · ${text}`);
    toast(`LLM 测试失败：${text}`);
  }
}

function markComfyDirty() {
  setTestResult("testComfyResult", "", "未测试");
}

function markLlmDirty() {
  setTestResult("testLlmResult", "", "未测试");
}

function bindEvents() {
  document.getElementById("llmProvider").addEventListener("change", (event) => {
    const next = providerDefaults[event.target.value];
    document.getElementById("llmBase").value = next.baseUrl;
    document.getElementById("llmModel").value = next.model;
    markLlmDirty();
  });

  document.getElementById("comfyUrl").addEventListener("input", markComfyDirty);
  document.getElementById("proxyUrl").addEventListener("input", markLlmDirty);
  document.getElementById("llmBase").addEventListener("input", markLlmDirty);
  document.getElementById("llmModel").addEventListener("input", markLlmDirty);
  document.getElementById("llmKey").addEventListener("input", markLlmDirty);
  document.getElementById("llmTemperature").addEventListener("input", markLlmDirty);
  document.getElementById("llmTokens").addEventListener("input", markLlmDirty);
  document.getElementById("llmBatchChars").addEventListener("change", markLlmDirty);

  document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
    await saveSettings(readSettingsForm());
    toast("配置已保存到数据库");
  });

  document.getElementById("testComfyBtn").addEventListener("click", () => {
    testComfy();
  });

  document.getElementById("testLlmBtn").addEventListener("click", () => {
    testLlm();
  });
}

async function init() {
  renderNav();
  bindEvents();
  const data = await getData();
  load(data.settings || {});
}

init().catch((err) => {
  renderNav();
  showPageError(err, "系统配置页初始化失败");
});
