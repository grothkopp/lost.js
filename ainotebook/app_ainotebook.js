import { Lost } from "/lost.js";
import { LostUI } from "/lost-ui.js";
import MarkdownIt from "https://esm.sh/markdown-it@13.0.1";

const STORAGE_KEY = "app-ainotebook-v1";
const LLM_SETTINGS_KEY = "ainotebook-llm-settings-v1";

const DEFAULT_NOTEBOOK = {
  title: "New Notebook",
  notebookModelId: "",
  cells: [
    {
      id: "cell_intro",
      type: "markdown",
      name: "notes",
      text: "# New notebook\n\nWrite some notes here…",
      modelId: "",
      lastOutput: "",
      error: "",
      stale: false
    },
    {
      id: "cell_summary",
      type: "prompt",
      name: "summary",
      text:
        "Summarize the notes from {{notes}} in 3 bullet points. " +
        "Respond in Markdown.",
      modelId: "",
      lastOutput: "",
      error: "",
      stale: false
    }
  ]
};

const DEFAULT_LLM_SETTINGS = {
  models: []
};

/**
 * Generate a simple id.
 */
function genId(prefix = "cell") {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 7)
  );
}

class AiNotebookApp {
  constructor() {
    // ---------- LOST core ----------
    this.lost = new Lost({
      storageKey: STORAGE_KEY,
      defaultData: DEFAULT_NOTEBOOK,
      validator: (data) => this.validateNotebook(data)
    });

    this.lost.addEventListener("update", (e) =>
      this.onNotebookUpdate(e.detail)
    );

    // ---------- LostUI shell ----------
    this.uiShell = new LostUI(this.lost, {
      container: document.body,
      showLightDarkButton: true,
      header: {
        title: "AI Notebook",
        menuTitle: "Notebooks",
        extraContent: () => {
          const btn = document.createElement("button");
          btn.className = "action-btn";
          btn.title = "LLM Settings";
          btn.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" ' +
            'width="20" height="20" viewBox="0 0 24 24" fill="none" ' +
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
            'stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path>' +
            '<path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37a1.724 1.724 0 0 0 2.572 -1.065"></path>' +
            '<path d="M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0 -6"></path></svg>';
          btn.addEventListener("click", () => this.openSettingsDialog());
          return btn;
        }
      },
      sidebar: {
        heading: "Notebooks",
        onNew: () => this.createNotebook(),
        title: (item) => item.title || "Untitled notebook",
        subline: (item) => {
          const count = Array.isArray(item?.cells) ? item.cells.length : 0;
          return `${count} cell${count === 1 ? "" : "s"}`;
        }
      },
      footer: {
        label: "Share this notebook:"
      }
    });

    // ---------- DOM references ----------
    this.stageEl = document.getElementById("app-stage");
    this.cellsContainer = document.getElementById("cells-container");

    this.notebookTitleInput = document.getElementById("notebookTitleInput");
    this.notebookModelSelect = document.getElementById("notebookModelSelect");

    this.addMarkdownBtn = document.getElementById("addMarkdownCellBtn");
    this.addPromptBtn = document.getElementById("addPromptCellBtn");
    this.addVarBtn = document.getElementById("addVarCellBtn");

    this.settingsDialog = document.getElementById("settingsDialog");
    this.llmListEl = document.getElementById("llmList");
    this.addLlmBtn = document.getElementById("addLlmBtn");
    this.settingsCloseBtn = document.getElementById("settingsCloseBtn");
    this.runAllBtn = document.getElementById("runAllBtn");
    this.stopAllBtn = document.getElementById("stopAllBtn");

    // ---------- runtime state ----------
    this.currentNotebook = null;
    this.llmSettings = this.loadLlmSettings();
    this.runningControllers = new Map(); // cellId -> AbortController
    this.runningCells = new Set(); // cellId
    this.stopAllRequested = false;
    this.parsedOutputs = new Map(); // key -> parsed JSON value
    this.runAllInFlight = false;
    this.lastFocusedEditor = null;
    this.md = new MarkdownIt({
      html: false,
      linkify: true,
      breaks: true
    });
    this.referenceMenu = null;
    this.varTooltipEl = null;
    this.templateHoverCache = new WeakMap();
    this.runningStartTimes = new Map(); // cellId -> timestamp
    this.runningTimerId = null;

    this.bindEvents();
    this.init();
  }

  // ---------- Initialization ----------

  async init() {
    this.lost.load();
    this.uiShell.load();
  }

  bindEvents() {
    // Toolbar
    this.notebookTitleInput.addEventListener("input", (e) => {
      const item = this.lost.getCurrent();
      if (!item) return;
      this.lost.update(item.id, { title: e.target.value });
    });

    this.notebookModelSelect.addEventListener("change", (e) => {
      const item = this.lost.getCurrent();
      if (!item) return;
      this.lost.update(item.id, { notebookModelId: e.target.value });
    });

    this.addMarkdownBtn.addEventListener("click", () =>
      this.addCell("markdown")
    );
    this.addPromptBtn.addEventListener("click", () => this.addCell("prompt"));
    this.addVarBtn.addEventListener("click", () => this.addCell("variable"));

    this.runAllBtn.addEventListener("click", () => this.runAllPromptCells());
    this.stopAllBtn.addEventListener("click", () => this.stopAllCells());

    // Settings dialog
    this.addLlmBtn.addEventListener("click", () => this.addLlmRow());
    this.settingsCloseBtn.addEventListener("click", () => {
      this.saveLlmSettingsFromDialog();
      this.settingsDialog.close();
    });
  }

  // ---------- LOST: validation & update ----------

  validateNotebook(data) {
    if (!data || typeof data !== "object") return false;
    if (!Array.isArray(data.cells)) return false;
    return true;
  }

  onNotebookUpdate(item) {
    if (!item) return;
    this.currentNotebook = item;
    this.renderNotebook();
  }

  // ---------- LLM settings ----------

  loadLlmSettings() {
    try {
      const raw = localStorage.getItem(LLM_SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_LLM_SETTINGS };
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.models)) {
        return { ...DEFAULT_LLM_SETTINGS };
      }
      return parsed;
    } catch {
      return { ...DEFAULT_LLM_SETTINGS };
    }
  }

  saveLlmSettings() {
    try {
      localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(this.llmSettings));
    } catch {
      // ignore
    }
  }

  openSettingsDialog() {
    this.renderLlmSettingsDialog();
    this.settingsDialog.showModal();
  }

  renderLlmSettingsDialog() {
    this.llmListEl.innerHTML = "";
    const models = this.llmSettings.models;

    if (!models.length) {
      // Add one empty row to start with
      models.push({
        id: genId("model"),
        label: "",
        provider: "openai",
        model: "",
        baseUrl: "",
        apiKey: ""
      });
    }

    for (const model of models) {
      const row = document.createElement("div");
      row.className = "llm-row";
      row.dataset.id = model.id;

      // Label
      const labelField = document.createElement("div");
      labelField.className = "llm-field";
      labelField.innerHTML =
        '<span>Label</span><input type="text" class="llm-label-input" />';
      labelField.querySelector("input").value = model.label || "";
      row.appendChild(labelField);

      // Provider + model
      const providerField = document.createElement("div");
      providerField.className = "llm-field";
      providerField.innerHTML =
        '<span>Provider &amp; Model</span>' +
        '<div style="display:flex; gap:6px;">' +
        '<select class="llm-provider-select">' +
        '<option value="openai">OpenAI</option>' +
        '<option value="claude">Claude</option>' +
        '<option value="openrouter">OpenRouter</option>' +
        "</select>" +
        '<input type="text" class="llm-model-input" placeholder="model id" />' +
        "</div>";
      const providerSelect = providerField.querySelector("select");
      const modelInput = providerField.querySelector("input");
      providerSelect.value = model.provider || "openai";
      modelInput.value = model.model || "";
      row.appendChild(providerField);

      // Base URL + key
      const connField = document.createElement("div");
      connField.className = "llm-field";
      connField.innerHTML =
        '<span>Base URL &amp; API key</span>' +
        '<div style="display:flex; flex-direction:column; gap:4px;">' +
        '<input type="text" class="llm-baseurl-input" placeholder="(optional) base URL" />' +
        '<input type="password" class="llm-apikey-input" placeholder="API key" />' +
        "</div>";
      connField.querySelector(".llm-baseurl-input").value = model.baseUrl || "";
      connField.querySelector(".llm-apikey-input").value = model.apiKey || "";
      row.appendChild(connField);

      // Actions
      const actions = document.createElement("div");
      actions.className = "llm-actions";
      actions.innerHTML =
        '<button type="button" class="icon-btn llm-delete-btn" title="Delete">✕</button>';
      row.appendChild(actions);

      // Provider change default base URL
      providerSelect.addEventListener("change", () => {
        const baseInput = connField.querySelector(".llm-baseurl-input");
        if (baseInput.value.trim()) return;
        if (providerSelect.value === "openai") {
          baseInput.value = "https://api.openai.com/v1";
        } else if (providerSelect.value === "claude") {
          baseInput.value = "https://api.anthropic.com/v1";
        } else if (providerSelect.value === "openrouter") {
          baseInput.value = "https://openrouter.ai/api/v1";
        }
      });

      // Delete button
      actions
        .querySelector(".llm-delete-btn")
        .addEventListener("click", () => {
          const idx = this.llmSettings.models.findIndex(
            (m) => m.id === model.id
          );
          if (idx >= 0) {
            this.llmSettings.models.splice(idx, 1);
            this.renderLlmSettingsDialog();
          }
        });

      this.llmListEl.appendChild(row);
    }
  }

  addLlmRow() {
    this.llmSettings.models.push({
      id: genId("model"),
      label: "",
      provider: "openai",
      model: "",
      baseUrl: "",
      apiKey: ""
    });
    this.renderLlmSettingsDialog();
  }

  saveLlmSettingsFromDialog() {
    const rows = Array.from(this.llmListEl.querySelectorAll(".llm-row"));
    const models = [];

    for (const row of rows) {
      const id = row.dataset.id || genId("model");
      const label = row.querySelector(".llm-label-input")?.value?.trim() || "";
      const provider =
        row.querySelector(".llm-provider-select")?.value || "openai";
      const modelId =
        row.querySelector(".llm-model-input")?.value?.trim() || "";
      const baseUrl =
        row.querySelector(".llm-baseurl-input")?.value?.trim() || "";
      const apiKey =
        row.querySelector(".llm-apikey-input")?.value?.trim() || "";

      if (!label && !modelId && !apiKey) {
        // completely empty row, skip
        continue;
      }

      models.push({
        id,
        label,
        provider,
        model: modelId,
        baseUrl,
        apiKey
      });
    }

    this.llmSettings.models = models;
    this.saveLlmSettings();
    this.renderNotebook(); // refresh model selects
  }

  // ---------- Notebook operations ----------

  createNotebook() {
    this.lost.create({
      ...DEFAULT_NOTEBOOK,
      title: "New Notebook"
    });
  }

  addCell(type) {
    const item = this.lost.getCurrent();
    if (!item) return;

    const cells = Array.isArray(item.cells) ? [...item.cells] : [];
    const index = cells.length + 1;

    let name = "";
    if (type === "markdown") name = `md_${index}`;
    if (type === "prompt") name = `cell_${index}`;
    if (type === "variable") name = `var_${index}`;

    const cell = {
      id: genId("cell"),
      type,
      name,
      text:
        type === "markdown"
          ? `# Cell ${index}\n`
          : type === "variable"
          ? ""
          : `Explain {{md_${index - 1} || notes}}`,
      modelId: "",
      lastOutput: "",
      error: "",
      stale: false
    };

    cells.push(cell);
    this.lost.update(item.id, { cells });
  }

  updateCells(transformFn, options = {}) {
    const item = this.lost.getCurrent();
    if (!item) return;
    const prevCells = Array.isArray(item.cells) ? [...item.cells] : [];
    const newCellsRaw = transformFn(prevCells.map((c) => ({ ...c }))) || [];
    const nextCells = Array.isArray(newCellsRaw) ? newCellsRaw : [];
    const finalCells = this.applyStaleness(prevCells, nextCells, options);
    this.lost.update(item.id, { cells: finalCells });
  }

  getCellKeys(cell, index) {
    const keys = [];
    if (!cell) return keys;
    const name = (cell.name || "").trim();
    keys.push(`#${index + 1}`);
    keys.push(`out${index + 1}`);
    if (cell.id) keys.push(cell.id);
    if (name) keys.push(name);
    return Array.from(keys);
  }

  getPreferredRef(cell, index) {
    const name = (cell?.name || "").trim();
    if (name) return name;
    return `out${index + 1}`;
  }

  buildRefExpression(base, path = []) {
    const parts =
      Array.isArray(path) && path.length
        ? path.map((p) => (String(p).match(/^[0-9]+$/) ? `[${p}]` : `['${p}']`))
        : [];
    return `${base}${parts.join("")}`;
  }

  storeParsedOutputKeys(cell, index, value) {
    const keys = this.getCellKeys(cell, index);
    keys.forEach((k) => this.parsedOutputs.set(k, value));
  }

  parseKeyPath(expr) {
    const trimmed = (expr || "").trim();
    const baseMatch = trimmed.match(/^([A-Za-z0-9_#]+)/);
    if (!baseMatch) return { base: "", path: [] };
    const base = baseMatch[1];
    let rest = trimmed.slice(base.length);
    const path = [];
    const bracketRe =
      /^\s*\[\s*(?:"([^"]+)"|'([^']+)'|([0-9]+))\s*\]\s*/;
    while (rest.length) {
      const m = rest.match(bracketRe);
      if (!m) break;
      const key = m[1] ?? m[2] ?? m[3];
      path.push(key);
      rest = rest.slice(m[0].length);
    }
    return { base, path };
  }

  parseReferencesFromText(text) {
    if (!text || typeof text !== "string") return [];
    const refs = new Set();
    text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
      const { base } = this.parseKeyPath(expr);
      if (base) refs.add(base);
      return "";
    });
    return Array.from(refs);
  }

  buildReferenceIndex(cells) {
    const map = new Map(); // baseKey -> Set(cellId)
    (Array.isArray(cells) ? cells : []).forEach((cell) => {
      if (cell.type !== "prompt" && cell.type !== "markdown") return;
      const refs = this.parseReferencesFromText(cell.text || "");
      refs.forEach((ref) => {
        if (!map.has(ref)) map.set(ref, new Set());
        map.get(ref).add(cell.id);
      });
    });
    return map;
  }

  collectCellKeys(prevCells, newCells, cellId) {
    const keys = new Set();
    const newIdx = newCells.findIndex((c) => c.id === cellId);
    if (newIdx >= 0) {
      this.getCellKeys(newCells[newIdx], newIdx).forEach((k) => keys.add(k));
    }
    const prevIdx = prevCells.findIndex((c) => c.id === cellId);
    if (prevIdx >= 0) {
      this.getCellKeys(prevCells[prevIdx], prevIdx).forEach((k) =>
        keys.add(k)
      );
    }
    return Array.from(keys);
  }

  applyStaleness(prevCells, newCells, options = {}) {
    const changedIds = new Set(options.changedIds || []);
    const reason = options.reason || "content";

    const next = (Array.isArray(newCells) ? newCells : []).map((c) => ({
      ...c,
      stale: !!c.stale
    }));
    const prevList = (Array.isArray(prevCells) ? prevCells : []).map((c) => ({
      ...c,
      stale: !!c.stale
    }));

    const refPrev = this.buildReferenceIndex(prevList);
    const refNew = this.buildReferenceIndex(next);

    const queue = [];
    const seenKeys = new Set();

    const enqueueKeys = (cellId) => {
      this.collectCellKeys(prevList, next, cellId).forEach((k) => {
        if (!seenKeys.has(k)) {
          seenKeys.add(k);
          queue.push(k);
        }
      });
    };

    // Initialize staleness on changed cells
    changedIds.forEach((id) => {
      const cell = next.find((c) => c.id === id);
      if (cell) {
        if (reason === "output") {
          cell.stale = false;
        } else {
          cell.stale = true;
        }
      }
      enqueueKeys(id);
    });

    // Propagate staleness to dependents recursively
    const markCellStale = (cellId) => {
      const cell = next.find((c) => c.id === cellId);
      if (cell && !cell.stale) {
        cell.stale = true;
        enqueueKeys(cellId);
      }
    };

    while (queue.length) {
      const key = queue.shift();
      const refSet = new Set([
        ...(refPrev.get(key) || []),
        ...(refNew.get(key) || [])
      ]);
      refSet.forEach((cellId) => {
        // Avoid marking the cell that just produced fresh output as stale
        if (reason === "output" && changedIds.has(cellId)) return;
        markCellStale(cellId);
      });
    }

    return next;
  }

  // ---------- Rendering ----------

  renderNotebook() {
    const item = this.currentNotebook;
    if (!item) return;

    const focusState = this.captureFocusState();
    this.parsedOutputs.clear();

    // Toolbar actions state
    const anyRunning = this.runningCells.size > 0;
    this.runAllBtn.disabled = this.runAllInFlight || anyRunning;
    this.stopAllBtn.disabled = !anyRunning;
    this.runAllBtn.classList.toggle("is-running", this.runAllInFlight);
    this.stopAllBtn.classList.toggle("is-running", anyRunning);

    // Toolbar
    if (document.activeElement !== this.notebookTitleInput) {
      this.notebookTitleInput.value = item.title || "";
    }

    this.renderNotebookModelSelect();
    this.renderCells();

    this.restoreFocusState(focusState);
  }

  renderNotebookModelSelect() {
    const models = this.llmSettings.models;
    const selected = this.currentNotebook?.notebookModelId || "";

    // Preserve selection while rebuilding options
    this.notebookModelSelect.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "None";
    this.notebookModelSelect.appendChild(noneOpt);

    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label || `${m.provider}:${m.model}`;
      this.notebookModelSelect.appendChild(opt);
    }

    this.notebookModelSelect.value = selected;
  }

  renderCells() {
    const item = this.currentNotebook;
    const cells = Array.isArray(item.cells) ? item.cells : [];
    const env = this.buildEnvironment(item);
    this.cellsContainer.innerHTML = "";

    cells.forEach((cell, index) => {
      const root = document.createElement("article");
      const typeClass = cell.type ? `type-${cell.type}` : "type-markdown";
      root.className = `cell ${typeClass}`;
      root.dataset.id = cell.id;
      const baseRef = this.getPreferredRef(cell, index);

      // ----- Header -----
      const header = document.createElement("header");
      header.className = "cell-header";

      const idxSpan = document.createElement("span");
      idxSpan.className = "cell-index";
      idxSpan.textContent = `#${index + 1}`;
      header.appendChild(idxSpan);

      const typePill = document.createElement("span");
      typePill.className = "cell-type-pill " + typeClass;
      typePill.textContent =
        cell.type === "prompt"
          ? "Prompt"
          : cell.type === "variable"
          ? "Variable"
          : "Markdown";
      header.appendChild(typePill);

      const nameInput = document.createElement("input");
      nameInput.className = "cell-name-input";
      nameInput.type = "text";
      nameInput.placeholder = "Block name";
      nameInput.value = cell.name || "";
      header.appendChild(nameInput);

      const typeSelect = document.createElement("select");
      typeSelect.className = "cell-type-select";
      typeSelect.innerHTML =
        '<option value="markdown">Markdown</option>' +
        '<option value="prompt">Prompt</option>' +
        '<option value="variable">Variable</option>';
      typeSelect.value = cell.type || "markdown";
      header.appendChild(typeSelect);

      let llmSelect = null;
      if (cell.type === "prompt") {
        llmSelect = document.createElement("select");
        llmSelect.className = "cell-llm-select";
        const useDefaultOpt = document.createElement("option");
        const nbModel = this.currentNotebook?.notebookModelId || "";
        const nbModelLabel = this.getModelLabelById(nbModel);
        useDefaultOpt.value = "";
        useDefaultOpt.textContent = nbModel
          ? `Use notebook default (${nbModelLabel})`
          : "Use notebook default";
        llmSelect.appendChild(useDefaultOpt);

        for (const m of this.llmSettings.models) {
          const opt = document.createElement("option");
          opt.value = m.id;
          opt.textContent = m.label || `${m.provider}:${m.model}`;
          llmSelect.appendChild(opt);
        }
        llmSelect.value = cell.modelId || "";
        header.appendChild(llmSelect);
      }

      const statusSpan = document.createElement("span");
      statusSpan.className = "cell-status";
      const isRunning = this.runningCells.has(cell.id);
      if (isRunning) {
        root.classList.add("is-running");
      }
      if (this.runningCells.has(cell.id)) {
        statusSpan.classList.add("running");
        statusSpan.textContent = "Running…";
        const timerSpan = document.createElement("span");
        timerSpan.className = "running-timer";
        const startedAt = this.runningStartTimes.get(cell.id);
        timerSpan.textContent = this.formatDuration(
          startedAt ? Date.now() - startedAt : 0
        );
        statusSpan.appendChild(timerSpan);
      } else if (cell.error) {
        statusSpan.classList.add("error");
        statusSpan.textContent = "Error";
      } else if (cell.type === "prompt" && cell.stale) {
        statusSpan.classList.add("stale");
        statusSpan.textContent = "Stale";
      } else if (cell.type === "prompt" && cell.lastOutput) {
        statusSpan.textContent = "Done";
      } else {
        statusSpan.textContent = "";
      }
      header.appendChild(statusSpan);

      const actions = document.createElement("div");
      actions.className = "cell-actions";

      // Run / stop only for prompt cells
      if (cell.type === "prompt") {
        const runBtn = document.createElement("button");
        runBtn.type = "button";
        runBtn.className = "cell-action-btn run-btn";
        runBtn.textContent = "▶";
        const isStale = !!cell.stale || !cell.lastOutput;
        runBtn.disabled = isRunning;
        runBtn.classList.toggle("is-stale", isStale && !isRunning);
        runBtn.classList.toggle("is-running", isRunning);
        actions.appendChild(runBtn);

        const stopBtn = document.createElement("button");
        stopBtn.type = "button";
        stopBtn.className = "cell-action-btn stop-btn";
        stopBtn.textContent = "■";
        stopBtn.disabled = !isRunning;
        stopBtn.classList.toggle("is-running", isRunning);
        actions.appendChild(stopBtn);

        runBtn.addEventListener("click", () => this.runPromptCell(cell.id));
        stopBtn.addEventListener("click", () => this.stopCell(cell.id));
      }

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "icon-btn";
      upBtn.title = "Move up";
      upBtn.textContent = "↑";
      actions.appendChild(upBtn);

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "icon-btn";
      downBtn.title = "Move down";
      downBtn.textContent = "↓";
      actions.appendChild(downBtn);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "icon-btn delete-btn";
      delBtn.title = "Delete cell";
      delBtn.textContent = "✕";
      actions.appendChild(delBtn);

      header.appendChild(actions);
      root.appendChild(header);

      // ----- Body -----
      const body = document.createElement("div");
      body.className = "cell-body";

      const textarea = document.createElement("textarea");
      textarea.className = "cell-textarea";
      textarea.value = cell.text || "";
      body.appendChild(textarea);

      const help = document.createElement("div");
      help.className = "cell-help";
      if (cell.type === "markdown") {
        help.textContent =
          "Markdown text (rendered as plain text for now).";
      } else if (cell.type === "variable") {
        help.textContent =
          "Variable value. Other cells can reference this by name, e.g. {{"
          .concat(cell.name || `var_${index + 1}`, "}}.");
      } else {
        help.textContent =
          "Prompt. Use {{name}} to reference other cells, e.g. {{notes}} or {{#1}}.";
      }
      body.appendChild(help);

      const output = document.createElement("div");
      output.className = "cell-output";
      let outputText =
        cell.type === "prompt"
          ? cell.lastOutput || ""
          : cell.type === "variable"
          ? cell.text || ""
          : cell.text || "";
      const parsed =
        cell.type === "prompt" || cell.type === "variable"
          ? this.parseJsonOutput(outputText)
          : { isJson: false, value: outputText };
      if (!outputText) {
        output.classList.add("cell-output-empty");
        outputText =
          cell.type === "prompt"
            ? "No output yet. Run this cell."
            : "Empty.";
      }
      if (cell.type === "markdown") {
        output.classList.add("cell-output-markdown");
        const expanded = this.expandTemplate(cell.text || "", env);
        output.innerHTML = this.md.render(expanded);
      } else if (parsed.isJson) {
        output.classList.add("cell-output-json");
        this.storeParsedOutputKeys(cell, index, parsed.value);
        output.innerHTML = this.renderJsonInteractive(parsed.value, baseRef);
      } else {
        output.textContent = outputText;
      }
      if (cell.stale && cell.type === "prompt") {
        output.classList.add("stale");
      }
      if (cell.type === "prompt" && cell.lastRunInfo) {
        const meta = document.createElement("div");
        meta.className = "cell-run-meta";
        const info = cell.lastRunInfo || {};
        const parts = [];
        if (info.tokensIn != null) parts.push(`tokens in: ${info.tokensIn}`);
        if (info.tokensOut != null) parts.push(`tokens out: ${info.tokensOut}`);
        if (info.durationMs != null)
          parts.push(`time: ${this.formatDuration(info.durationMs)}`);
        if (info.model) parts.push(`model: ${info.model}`);
        meta.textContent = parts.join(" · ");
        body.appendChild(meta);
      }
      // Click to insert refs
      output.addEventListener("click", (e) => {
        const target = e.target.closest(".ref-click");
        if (target?.dataset?.ref) {
          e.preventDefault();
          e.stopPropagation();
          this.insertReference(target.dataset.ref);
          return;
        }
        if (!parsed.isJson) {
          e.preventDefault();
          e.stopPropagation();
          this.insertReference(`{{ ${baseRef} }}`);
        }
      });
      body.appendChild(output);

      root.appendChild(body);
      this.cellsContainer.appendChild(root);

      this.applyTextareaHeight(textarea, "collapsed");

      // ----- Per-cell event handlers -----

      nameInput.addEventListener("input", (e) => {
        this.updateCells((cells) => {
          const next = cells.map((c) =>
            c.id === cell.id ? { ...c, name: e.target.value } : c
          );
          return next;
        }, { changedIds: [cell.id] });
      });

      typeSelect.addEventListener("change", (e) => {
        const newType = e.target.value;
        this.updateCells((cells) => {
          return cells.map((c) =>
            c.id === cell.id
              ? {
                  ...c,
                  type: newType,
                  // keep text / lastOutput; they may still be useful
                  error: ""
                }
              : c
          );
        }, { changedIds: [cell.id] });
      });

      if (llmSelect) {
        llmSelect.addEventListener("change", (e) => {
          const value = e.target.value;
          this.updateCells((cells) =>
            cells.map((c) =>
              c.id === cell.id ? { ...c, modelId: value } : c
            ),
            { changedIds: [cell.id] }
          );
        });
      }

      textarea.addEventListener("input", (e) => {
        const text = e.target.value;
        this.templateHoverCache.delete(textarea);
        this.applyTextareaHeight(textarea);
        this.updateCells((cells) =>
          cells.map((c) =>
            c.id === cell.id ? { ...c, text, error: "" } : c
          ),
          { changedIds: [cell.id] }
        );
      });
      textarea.addEventListener("focus", () => {
        this.lastFocusedEditor = textarea;
        this.applyTextareaHeight(textarea, "expanded");
      });
      textarea.addEventListener("blur", () => {
        this.applyTextareaHeight(textarea, "collapsed");
      });
      const handleHoverMove = (e) => this.handleTextareaHover(e, env);
      textarea.addEventListener("mousemove", handleHoverMove);
      textarea.addEventListener("mouseleave", () => this.hideVariableTooltip());

      upBtn.addEventListener("click", () => {
        this.updateCells((cells) => {
          const idx = cells.findIndex((c) => c.id === cell.id);
          if (idx <= 0) return cells;
          const next = [...cells];
          const [removed] = next.splice(idx, 1);
          next.splice(idx - 1, 0, removed);
          return next;
        });
      });

      downBtn.addEventListener("click", () => {
        this.updateCells((cells) => {
          const idx = cells.findIndex((c) => c.id === cell.id);
          if (idx < 0 || idx >= cells.length - 1) return cells;
          const next = [...cells];
          const [removed] = next.splice(idx, 1);
          next.splice(idx + 1, 0, removed);
          return next;
        });
      });

      delBtn.addEventListener("click", () => {
        const ok = confirm("Delete this cell?");
        if (!ok) return;
        this.updateCells((cells) => cells.filter((c) => c.id !== cell.id));
      });
    });
  }

  getModelLabelById(id) {
    if (!id) return "";
    const m = this.llmSettings.models.find((m) => m.id === id);
    if (!m) return "";
    return m.label || `${m.provider}:${m.model}`;
  }

  // ---------- Focus preservation ----------

  captureFocusState() {
    const active = document.activeElement;
    if (!active) return null;

    if (active === this.notebookTitleInput) {
      return { type: "notebook-title" };
    }

    const cellEl = active.closest(".cell");
    if (!cellEl) return null;

    const cellId = cellEl.dataset.id;
    let role = null;
    if (active.classList.contains("cell-textarea")) role = "textarea";
    else if (active.classList.contains("cell-name-input")) role = "name";
    else if (active.classList.contains("cell-type-select")) role = "type";
    else if (active.classList.contains("cell-llm-select")) role = "llm";

    const selection =
      typeof active.selectionStart === "number" &&
      typeof active.selectionEnd === "number"
        ? { start: active.selectionStart, end: active.selectionEnd }
        : null;

    return { cellId, role, selection };
  }

  restoreFocusState(state) {
    if (!state) return;

    if (state.type === "notebook-title") {
      this.notebookTitleInput.focus({ preventScroll: true });
      return;
    }

    if (!state.cellId || !state.role) return;

    const cellEl = this.cellsContainer.querySelector(
      `article.cell[data-id="${state.cellId}"]`
    );
    if (!cellEl) return;

    let target = null;
    if (state.role === "textarea") {
      target = cellEl.querySelector(".cell-textarea");
    } else if (state.role === "name") {
      target = cellEl.querySelector(".cell-name-input");
    } else if (state.role === "type") {
      target = cellEl.querySelector(".cell-type-select");
    } else if (state.role === "llm") {
      target = cellEl.querySelector(".cell-llm-select");
    }

    if (target) {
      target.focus({ preventScroll: true });
      if (
        state.selection &&
        typeof target.setSelectionRange === "function"
      ) {
        const { start, end } = state.selection;
        target.setSelectionRange(start, end);
      }
    }
  }

  // ---------- Textarea sizing ----------

  applyTextareaHeight(textarea, mode = null) {
    if (!textarea) return;
    const desiredMode =
      mode || (document.activeElement === textarea ? "expanded" : "collapsed");
    textarea.style.height = "auto";
    const cs = getComputedStyle(textarea)
    const lineHeight = parseFloat(cs.lineHeight);
    let fullHeight = textarea.scrollHeight
    if (fullHeight < lineHeight * 3) {
      fullHeight -= lineHeight;
    }
    const collapsedHeight = this.getCollapsedHeight(textarea, 4);
    const targetHeight =
      desiredMode === "expanded" || fullHeight <= collapsedHeight
        ? fullHeight
        : collapsedHeight;
    textarea.style.height = `${targetHeight}px`;
  }

  getCollapsedHeight(textarea, lines = 4) {
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

  // ---------- Prompt execution ----------

  buildEnvironment(notebook) {
    const env = {};
    const cells = Array.isArray(notebook.cells) ? notebook.cells : [];

    cells.forEach((c, index) => {
      const value =
        c.type === "prompt"
          ? c.lastOutput || ""
          : typeof c.text === "string"
          ? c.text
          : "";

      const idxKey = `#${index + 1}`;
      env[idxKey] = value;
      const outKey = `out${index + 1}`;
      env[outKey] = value;

      if (c.id) env[c.id] = value;

      const name = (c.name || "").trim();
      if (name) {
        env[name] = value;
      }
    });

    return env;
  }

  resolveTemplateValue(expr, env) {
    const { base, path } = this.parseKeyPath(expr);
    if (!base) return "";

    const baseValue =
      this.parsedOutputs.has(base) && path.length
        ? this.parsedOutputs.get(base)
        : env[base];

    if (path.length) {
      let current =
        this.parsedOutputs.has(base) && baseValue === undefined
          ? this.parsedOutputs.get(base)
          : baseValue;
      if (current === undefined) return "";
      for (const key of path) {
        const isIndex = /^[0-9]+$/.test(key);
        if (isIndex && Array.isArray(current)) {
          current = current[Number(key)];
        } else if (
          current !== null &&
          typeof current === "object" &&
          Object.prototype.hasOwnProperty.call(current, key)
        ) {
          current = current[key];
        } else {
          return "";
        }
      }
      if (current === undefined || current === null) return "";
      if (typeof current === "object") return JSON.stringify(current);
      return String(current);
    }

    if (baseValue === undefined || baseValue === null) return "";
    if (typeof baseValue === "object") return JSON.stringify(baseValue);
    return String(baseValue);
  }

  expandTemplate(template, env) {
    if (!template) return "";
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
      const trimmed = key.trim();
      return this.resolveTemplateValue(trimmed, env);
    });
  }

  async runPromptCell(cellId) {
    const item = this.lost.getCurrent();
    if (!item) return;

    const cells = Array.isArray(item.cells) ? item.cells : [];
    const cell = cells.find((c) => c.id === cellId);
    if (!cell || cell.type !== "prompt") return;

    const modelId = cell.modelId || item.notebookModelId;
    if (!modelId) {
      alert("Please select a default LLM for the notebook or this cell.");
      return;
    }

    const model = this.llmSettings.models.find((m) => m.id === modelId);
    if (!model || !model.apiKey || !model.model) {
      alert(
        "The selected LLM is not fully configured. Please add API key and model id."
      );
      return;
    }

    // Build final prompt with environment
    const env = this.buildEnvironment(item);
    const finalPrompt = this.expandTemplate(cell.text || "", env);

    const controller = new AbortController();
    this.runningControllers.set(cellId, controller);
    this.runningCells.add(cellId);
    this.runningStartTimes.set(cellId, Date.now());
    this.startRunningTimerLoop();
    this.renderNotebook();

    try {
      const result = await this.callLLM(model, finalPrompt, controller.signal);
      const output =
        result && typeof result === "object" && "text" in result
          ? result.text
          : result;
      const usage =
        result && typeof result === "object" && result.usage
          ? result.usage
          : {};
      const durationMs = Date.now() - this.runningStartTimes.get(cellId);
      // Persist output & clear error
      this.updateCells(
        (cells) =>
          cells.map((c) =>
            c.id === cellId
              ? {
                  ...c,
                  lastOutput: output || "",
                  error: "",
                  lastRunInfo: {
                    tokensIn:
                      usage.prompt ??
                      usage.input ??
                      usage.prompt_tokens ??
                      usage.input_tokens ??
                      null,
                    tokensOut:
                      usage.completion ??
                      usage.output ??
                      usage.completion_tokens ??
                      usage.output_tokens ??
                      null,
                    durationMs,
                    model:
                      this.getModelLabelById(modelId) ||
                      model.label ||
                      model.model ||
                      model.id ||
                      ""
                  }
                }
              : c
          ),
        { changedIds: [cellId], reason: "output" }
      );
    } catch (err) {
      if (err?.name === "AbortError") {
        // Silently ignore aborts
      } else {
        console.error("LLM call failed", err);
        const msg =
          err && typeof err.message === "string"
            ? err.message
            : "LLM request failed.";
        this.updateCells(
          (cells) =>
            cells.map((c) =>
              c.id === cellId
                ? {
                    ...c,
                    error: msg
                  }
                : c
            ),
          { changedIds: [cellId] }
        );
        alert("LLM error: " + msg);
      }
    } finally {
      this.runningControllers.delete(cellId);
      this.runningCells.delete(cellId);
      this.runningStartTimes.delete(cellId);
      if (!this.runningCells.size) {
        this.stopRunningTimerLoop();
      }
      this.renderNotebook();
    }
  }

  stopCell(cellId) {
    const controller = this.runningControllers.get(cellId);
    if (controller) {
      controller.abort();
      this.runningControllers.delete(cellId);
    }
    this.runningCells.delete(cellId);
    this.runningStartTimes.delete(cellId);
    if (!this.runningCells.size) this.stopRunningTimerLoop();
    this.renderNotebook();
  }

  async runAllPromptCells() {
    const item = this.lost.getCurrent();
    if (!item) return;
    const promptCells = (Array.isArray(item.cells) ? item.cells : []).filter(
      (c) => c.type === "prompt"
    );
    if (!promptCells.length) return;

    this.stopAllRequested = false;
    this.runAllInFlight = true;
    this.renderNotebook();

    for (const cell of promptCells) {
      if (this.stopAllRequested) break;
      await this.runPromptCell(cell.id);
    }

    this.runAllInFlight = false;
    this.stopAllRequested = false;
    this.renderNotebook();
  }

  stopAllCells() {
    this.stopAllRequested = true;
    this.runningControllers.forEach((controller) => controller.abort());
    this.runningControllers.clear();
    this.runningCells.clear();
    this.runningStartTimes.clear();
    this.stopRunningTimerLoop();
    this.runAllInFlight = false;
    this.renderNotebook();
  }

  parseJsonOutput(text) {
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

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  renderJsonHighlighted(value) {
    const jsonStr = JSON.stringify(value, null, 2);
    const escaped = this.escapeHtml(jsonStr);
    const highlighted = escaped.replace(
      /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g,
      (match, str, _p2, _p3, number, boolOrNull) => {
        if (str) {
          const isKey = /"$/.test(str) && /:$/.test(match);
          return `<span class="${isKey ? "json-key" : "json-string"}">${str}</span>`;
        }
        if (number !== undefined) {
          return `<span class="json-number">${number}</span>`;
        }
        if (boolOrNull !== undefined) {
          const cls = boolOrNull === "null" ? "json-null" : "json-boolean";
          return `<span class="${cls}">${boolOrNull}</span>`;
        }
        return match;
      }
    );
    return highlighted;
  }

  renderJsonInteractive(value, baseRef, path = [], depth = 0) {
    const pad = "  ".repeat(depth);
    const refExpr = this.buildRefExpression(baseRef, path);

    const renderPrimitive = (val) => {
      if (val === null) return `<span class="json-null">null</span>`;
      if (typeof val === "string")
        return `<span class="json-string">"${this.escapeHtml(val)}"</span>`;
      if (typeof val === "number")
        return `<span class="json-number">${val}</span>`;
      if (typeof val === "boolean")
        return `<span class="json-boolean">${val}</span>`;
      return `<span>${this.escapeHtml(String(val))}</span>`;
    };

    if (value === null || typeof value !== "object") {
      return `<span class="ref-click" data-ref="{{ ${refExpr} }}">${renderPrimitive(
        value
      )}</span>`;
    }

    if (Array.isArray(value)) {
      const inner = value
        .map(
          (v, i) =>
            `${pad}  <span class="json-key ref-click" data-ref="{{ ${this.buildRefExpression(
              baseRef,
              [...path, i]
            )} }}">[${i}]</span>: ${this.renderJsonInteractive(
              v,
              baseRef,
              [...path, i],
              depth + 1
            )}`
        )
        .join("\n");
      return `[\n${inner}\n${pad}]`;
    }

    // object
    const entries = Object.entries(value);
    const inner = entries
      .map(([k, v]) => {
        const nextPath = [...path, k];
        const keyRef = this.buildRefExpression(baseRef, nextPath);
        return `${pad}  "<span class="json-key ref-click" data-ref="{{ ${keyRef} }}">${this.escapeHtml(
          k
        )}</span>": ${this.renderJsonInteractive(
          v,
          baseRef,
          nextPath,
          depth + 1
        )}`;
      })
      .join("\n");
    return `{\n${inner}\n${pad}}`;
  }

  handleTextareaHover(e, env) {
    const textarea = e.currentTarget;
    const value = textarea.value || "";
    const hoverData = this.getTextareaHoverMirror(textarea, value);
    const { spans, mirror } = hoverData;
    if (!spans.length) {
      this.hideVariableTooltip();
      return;
    }

    // Keep mirror aligned with textarea position and scroll
    const rect = textarea.getBoundingClientRect();
    mirror.style.left = `${rect.left + window.scrollX}px`;
    mirror.style.top = `${rect.top + window.scrollY}px`;
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;

    const x = e.clientX + window.scrollX;
    const y = e.clientY + window.scrollY;
    let matched = null;
    for (const span of spans) {
      const srect = span.getBoundingClientRect();
      if (x >= srect.left + window.scrollX &&
          x <= srect.right + window.scrollX &&
          y >= srect.top + window.scrollY &&
          y <= srect.bottom + window.scrollY) {
        matched = span;
        break;
      }
    }

    if (!matched) {
      this.hideVariableTooltip();
      return;
    }

    const expr = matched.dataset.expr;
    const valueResolved = this.resolveTemplateValue(expr, env);
    const content = this.formatTooltipValue(valueResolved);
    this.showVariableTooltip(content, e.clientX, e.clientY);
  }

  getTextareaHoverMirror(textarea, value) {
    const cached = this.templateHoverCache.get(textarea);
    if (cached && cached.value === value) {
      return cached;
    }
    if (cached?.mirror) {
      cached.mirror.remove();
    }

    const mirror = document.createElement("div");
    const cs = getComputedStyle(textarea);
    const rect = textarea.getBoundingClientRect();
    mirror.className = "textarea-hover-mirror";
    mirror.style.position = "absolute";
    mirror.style.left = `${rect.left + window.scrollX}px`;
    mirror.style.top = `${rect.top + window.scrollY}px`;
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.style.height = `${textarea.clientHeight}px`;
    mirror.style.padding = cs.padding;
    mirror.style.font = cs.font;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordBreak = "break-word";
    mirror.style.overflow = "hidden";
    mirror.style.visibility = "hidden";
    mirror.style.pointerEvents = "none";
    mirror.style.zIndex = "-1";
    mirror.innerHTML = this.buildTextareaHoverHtml(value);
    document.body.appendChild(mirror);
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;

    const spans = Array.from(mirror.querySelectorAll(".template-ref"));
    const payload = { mirror, spans, value };
    this.templateHoverCache.set(textarea, payload);
    return payload;
  }

  buildTextareaHoverHtml(text) {
    if (!text) return "";
    const parts = [];
    let lastIndex = 0;
    const regex = /\{\{\s*([^}]+?)\s*\}\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index);
      if (before)
        parts.push(this.escapeHtml(before).replace(/\n/g, "<br>"));
      const expr = match[1].trim();
      const escapedExpr = this.escapeHtml(expr);
      const display = this.escapeHtml(match[0]).replace(/\n/g, "<br>");
      parts.push(
        `<span class="template-ref" data-expr="${escapedExpr}">${display}</span>`
      );
      lastIndex = regex.lastIndex;
    }
    const rest = text.slice(lastIndex);
    if (rest) parts.push(this.escapeHtml(rest).replace(/\n/g, "<br>"));
    return parts.join("");
  }

  formatTooltipValue(val) {
    if (val === undefined || val === null) return "(empty)";
    let str = "";
    if (typeof val === "string") str = val;
    else if (typeof val === "object") {
      try {
        str = JSON.stringify(val);
      } catch {
        str = String(val);
      }
    } else {
      str = String(val);
    }
    const compact = str.replace(/\s+/g, " ").trim();
    if (!compact) return "(empty)";
    return compact.length > 160 ? compact.slice(0, 160) + "…" : compact;
  }

  showVariableTooltip(content, x, y) {
    if (!this.varTooltipEl) {
      const el = document.createElement("div");
      el.className = "var-tooltip";
      document.body.appendChild(el);
      this.varTooltipEl = el;
    }
    this.varTooltipEl.textContent = content;
    this.varTooltipEl.style.display = "block";
    this.varTooltipEl.style.left = `${x + 12}px`;
    this.varTooltipEl.style.top = `${y + 12}px`;
  }

  hideVariableTooltip() {
    if (this.varTooltipEl) {
      this.varTooltipEl.style.display = "none";
    }
  }

  startRunningTimerLoop() {
    if (this.runningTimerId) return;
    this.runningTimerId = setInterval(() => this.updateRunningTimerDom(), 1000);
  }

  stopRunningTimerLoop() {
    if (this.runningTimerId) {
      clearInterval(this.runningTimerId);
      this.runningTimerId = null;
    }
  }

  updateRunningTimerDom() {
    const now = Date.now();
    this.runningStartTimes.forEach((start, cellId) => {
      const el = document.querySelector(
        `article.cell[data-id="${cellId}"] .cell-status .running-timer`
      );
      if (el) {
        el.textContent = this.formatDuration(now - start);
      }
    });
    if (!this.runningStartTimes.size) {
      this.stopRunningTimerLoop();
    }
  }

  formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  insertReference(ref) {
    const target =
      this.lastFocusedEditor && document.body.contains(this.lastFocusedEditor)
        ? this.lastFocusedEditor
        : document.activeElement;
    if (!target || target.tagName !== "TEXTAREA") {
      navigator.clipboard?.writeText?.(ref).catch(() => {});
      return;
    }
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const before = target.value.slice(0, start);
    const after = target.value.slice(end);
    target.value = before + ref + after;
    const newPos = before.length + ref.length;
    target.setSelectionRange(newPos, newPos);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.focus({ preventScroll: true });
  }

  async callLLM(model, prompt, signal) {
    if (model.provider === "claude") {
      return this.callClaude(model, prompt, signal);
    }
    if (model.provider === "openrouter") {
      return this.callOpenRouter(model, prompt, signal);
    }
    // default to openai
    return this.callOpenAI(model, prompt, signal);
  }

  async callOpenAI(model, prompt, signal) {
    const baseUrl = (model.baseUrl || "https://api.openai.com/v1").replace(
      /\/+$/,
      ""
    );
    const url = `${baseUrl}/chat/completions`;

    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${model.apiKey}`
      },
      body: JSON.stringify({
        model: model.model,
        messages: [
          {
            role: "system",
            content:
              "You are an AI assistant inside a local notebook app. " +
              "Return concise answers in Markdown."
          },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI error ${res.status}: ${text}`);
    }

    const json = await res.json();
    const content =
      json.choices?.[0]?.message?.content ||
      json.choices?.[0]?.text ||
      "";
    return {
      text: String(content).trim(),
      usage: json.usage || {}
    };
  }

  async callClaude(model, prompt, signal) {
    const baseUrl = (model.baseUrl || "https://api.anthropic.com/v1").replace(
      /\/+$/,
      ""
    );
    const url = `${baseUrl}/messages`;

    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": model.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: model.model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Claude error ${res.status}: ${text}`);
    }

    const json = await res.json();
    const contentArray = json.content || [];
    const firstText = contentArray.find((c) => c.type === "text");
    const content = firstText?.text || "";
    return {
      text: String(content).trim(),
      usage: json.usage || {}
    };
  }

  async callOpenRouter(model, prompt, signal) {
    const baseUrl = (model.baseUrl || "https://openrouter.ai/api/v1").replace(
      /\/+$/,
      ""
    );
    const url = `${baseUrl}/chat/completions`;

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`
      // Optionally: 'HTTP-Referer' and 'X-Title' can be added here.
    };

    const res = await fetch(url, {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify({
        model: model.model,
        messages: [
          {
            role: "system",
            content:
              "You are an AI assistant inside a local notebook app. " +
              "Return concise answers in Markdown."
          },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenRouter error ${res.status}: ${text}`);
    }

    const json = await res.json();
    const content =
      json.choices?.[0]?.message?.content ||
      json.choices?.[0]?.text ||
      "";
    return {
      text: String(content).trim(),
      usage: json.usage || {}
    };
  }
}

new AiNotebookApp();
