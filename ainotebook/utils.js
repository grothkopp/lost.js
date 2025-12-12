
export function genId(prefix = "cell") {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 7)
  );
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function sanitizeHeaders(headers = {}) {
  const blocked = new Set(["authorization", "x-api-key"]);
  const out = {};
  Object.entries(headers || {}).forEach(([k, v]) => {
    if (!blocked.has(k.toLowerCase())) {
      out[k] = v;
    } else {
      out[k] = "<redacted>";
    }
  });
  return out;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function parseJsonOutput(text) {
  if (typeof text !== "string") return { isJson: false, value: text };
  let cleaned = text.trim();
  if (/^```json/i.test(cleaned)) {
    cleaned = cleaned.replace(/^```json\s*/i, "");
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();
  }
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1);
  }
  try {
    const parsed = JSON.parse(cleaned);
    return { isJson: true, value: parsed };
  } catch {
    return { isJson: false, value: text };
  }
}

export function getCollapsedHeight(textarea, lines = 4) {
  const cs = getComputedStyle(textarea);
  const lineHeight =
    parseFloat(cs.lineHeight) ||
    (parseFloat(cs.fontSize) ? parseFloat(cs.fontSize) * 1.4 : 18);
  const paddingY =
    (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const borderY =
    (parseFloat(cs.borderTopWidth) || 0) +
    (parseFloat(cs.borderBottomWidth) || 0);
  return Math.round(lineHeight * lines + paddingY + borderY);
}

export function applyTextareaHeight(textarea, mode = null) {
  if (!textarea) return;
  const desiredMode =
    mode || (document.activeElement === textarea ? "expanded" : "collapsed");
  textarea.style.height = "auto";
  textarea.rows = 1;
  let fullHeight = textarea.scrollHeight;
  const collapsedHeight = getCollapsedHeight(textarea, 4);
  const targetHeight =
    desiredMode === "expanded" || fullHeight <= collapsedHeight
      ? fullHeight
      : collapsedHeight;
  const viewportCap = Math.max(240, Math.floor(window.innerHeight * 0.8));
  const finalHeight = Math.min(targetHeight, viewportCap);
  textarea.style.maxHeight = `${viewportCap}px`;
  textarea.style.height = `${finalHeight}px`;
}
