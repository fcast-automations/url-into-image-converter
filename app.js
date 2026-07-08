const fileInput = document.querySelector("#csvFile");
const startBtn = document.querySelector("#startBtn");
const fileStatus = document.querySelector("#fileStatus");
const countStatus = document.querySelector("#countStatus");
const progress = document.querySelector("#progress");
const log = document.querySelector("#log");
const zipNameInput = document.querySelector("#zipName");
const modeInput = document.querySelector("#mode");
const proxyTemplateInput = document.querySelector("#proxyTemplate");
const concurrencyInput = document.querySelector("#concurrency");
const runStatus = document.querySelector("#runStatus");

let urls = [];
let activeRun = null;
let lastPaint = 0;

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  urls = file ? extractUrls(await file.text()) : [];
  fileStatus.textContent = file ? file.name : "No file selected";
  countStatus.textContent = `${urls.length} links`;
  startBtn.disabled = urls.length === 0;
  progress.value = 0;
  runStatus.textContent = "Idle";
  log.textContent = "";
});

startBtn.addEventListener("click", async () => {
  if (activeRun) {
    activeRun.abort();
    return;
  }

  activeRun = new AbortController();
  startBtn.disabled = true;
  startBtn.textContent = "Stop";
  startBtn.disabled = false;
  log.textContent = "";
  progress.value = 0;

  const zip = new JSZip();
  const failed = [];
  const state = { done: 0, ok: 0, failed: 0 };

  try {
    await mapPool(urls, Number(concurrencyInput.value) || 48, async (url, index) => {
      try {
        const blob = await fetchImage(url, activeRun.signal);
        zip.file(fileName(url, index, blob.type), blob);
        state.ok += 1;
      } catch (error) {
        state.failed += 1;
        failed.push([url, error.message]);
        appendLog(url, error.message, true);
      } finally {
        state.done += 1;
        updateProgress(state, false);
      }
    });

    if (failed.length) {
      zip.file("failed-links.csv", toCsv(failed));
    }

    runStatus.textContent = "Creating ZIP...";
    downloadBlob(await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true }), cleanZipName(zipNameInput.value));
    runStatus.textContent = `${state.done}/${urls.length} done - ${state.ok} ok - ${state.failed} failed`;
  } catch (error) {
    appendLog("Run stopped", error.message, true);
  } finally {
    activeRun = null;
    startBtn.textContent = "Download ZIP";
    startBtn.disabled = urls.length === 0;
  }
});

function extractUrls(text) {
  return [...new Set(text.match(/https?:\/\/[^\s"',<>]+/gi) || [])];
}

async function fetchImage(url, signal) {
  const attempts = fetchAttempts(url);
  let lastError = new Error("download blocked");

  for (const attempt of attempts.filter(Boolean)) {
    try {
      const response = await fetch(attempt, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error(`not an image: ${blob.type || "unknown"}`);
      return blob;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function fetchAttempts(url) {
  if (modeInput.value === "proxy") return [proxiedUrl(url)];
  if (modeInput.value === "direct-proxy") return [url, proxiedUrl(url)];
  return [url];
}

async function mapPool(items, limit, worker) {
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, 128, items.length));
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function updateProgress(state, force) {
  const now = performance.now();
  if (!force && state.done < urls.length && now - lastPaint < 100) return;
  lastPaint = now;
  progress.value = Math.round((state.done / urls.length) * 100);
  runStatus.textContent = `${state.done}/${urls.length} done - ${state.ok} ok - ${state.failed} failed`;
}

function proxiedUrl(url) {
  const template = proxyTemplateInput.value.trim();
  return template ? template.replace("{url}", encodeURIComponent(url.replace(/^https?:\/\//, ""))) : "";
}

function fileName(url, index, type) {
  const pathName = new URL(url).pathname;
  const lastPart = pathName.split("/").filter(Boolean).pop() || `image-${index + 1}`;
  const clean = lastPart.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(clean);
  return `${String(index + 1).padStart(3, "0")}-${clean || "image"}${hasExt ? "" : extension(type)}`;
}

function extension(type) {
  return {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
  }[type] || ".img";
}

function cleanZipName(name) {
  const clean = name.trim().replace(/[^a-z0-9._-]+/gi, "-") || "images.zip";
  return clean.toLowerCase().endsWith(".zip") ? clean : `${clean}.zip`;
}

function downloadBlob(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function appendLog(url, note, failed) {
  const item = document.createElement("li");
  item.innerHTML = `<span>${escapeHtml(url)}</span><strong class="${failed ? "fail" : "ok"}">${escapeHtml(note)}</strong>`;
  log.prepend(item);
  while (log.children.length > 100) {
    log.lastElementChild.remove();
  }
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}
