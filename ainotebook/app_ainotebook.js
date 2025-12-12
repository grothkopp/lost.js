import { Lost } from "/lost.js";
import { LostUI } from "/lost-ui.js";
import MarkdownIt from "https://esm.sh/markdown-it@13.0.1";

const STORAGE_KEY = "app-ainotebook-v1";
const LLM_SETTINGS_KEY = "ainotebook-llm-settings-v1";
const OUTPUT_COLLAPSE_MAX_HEIGHT = 250;

const DEFAULT_SYSTEM_PROMPT =
  "You are an AI assistant inside a local notebook app. Return concise answers in Markdown.";

const DEFAULT_NOTEBOOK = {
  title: "New Notebook",
  notebookModelId: "",
  notebookParams: "",
  cells: [
    {
      id: "cell_intro",
      type: "markdown",
      name: "notes",
      text: "# New notebook\n\nWrite some notes here…",
      modelId: "",
      lastOutput: "",
      error: "",
      _stale: false
    },
    {
      id: "cell_var_systemprompt",
      type: "variable",
      name: "var_systemprompt",
      text: DEFAULT_SYSTEM_PROMPT,
      modelId: "",
      lastOutput: "",
      error: "",
      _stale: false
    },
    {
      id: "cell_summary",
      type: "prompt",
      name: "summary",
      text:
        "Summarize the notes from {{notes}} in 3 bullet points. " +
        "Respond in Markdown.",
      systemPrompt: "{{ var_systemprompt }}",
      params: "",
      _outputExpanded: false,
      modelId: "",
      lastOutput: "",
      error: "",
      _stale: false
    }
  ]
};

const DEFAULT_LLM_SETTINGS = {
  providers: [],
  cachedModels: [],
  cacheTimestamp: 0
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

    this.bindEvents();
    this.buildLogOverlay();
    this.onNotebookUpdate(this.lost.getCurrent());

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
    this.setupHeaderTitleEditing();

    // ---------- DOM references ----------
    this.stageEl = document.getElementById("app-stage");
    this.cellsContainer = document.getElementById("cells-container");

    this.notebookModelSelect = document.getElementById("notebookModelSelect");
    this.notebookModelSearch = document.getElementById("notebookModelSearch");
    this.notebookModelLabel =
      this.notebookModelSelect?.closest(".notebook-toolbar-label") || null;
    if (this.notebookModelSelect) this.notebookModelSelect.style.display = "none";
    if (this.notebookModelSearch) this.notebookModelSearch.style.display = "none";

    this.settingsDialog = document.getElementById("settingsDialog");
    this.llmListEl = document.getElementById("llmList");
    this.addLlmBtn = document.getElementById("addLlmBtn");
    this.refreshModelsBtn = document.getElementById("refreshModelsBtn");
    this.modelSearchInput = document.getElementById("modelSearchInput");
    this.modelSearchNotebookInput =
      document.getElementById("modelSearchNotebookInput");

    this.settingsCloseBtn = document.getElementById("settingsCloseBtn");
    this.settingsCancelBtn = document.getElementById("settingsCancelBtn");
    this.runAllBtn = document.getElementById("runAllBtn");
    this.stopAllBtn = document.getElementById("stopAllBtn");

    // LLM log overlay elements
    this.logOverlay = null;
    this.logOverlayTextarea = null;
    this.logOverlayClose = null;

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
      typographer: true
    });
    this.referenceMenu = null;
    this.varTooltipEl = null;
    this.templateHoverCache = new WeakMap();
    this.runningStartTimes = new Map(); // cellId -> timestamp
    this.runningTimerId = null;
    this.modelSearchTermNotebook = "";
    this.cellModelSearch = new Map(); // cellId -> search term
    this.refreshModelsInFlight = false;
    this.pendingFocusState = null;
    this._sandboxes = new Map(); // cellId -> iframe
    this._codeRunTimers = new Map(); // cellId -> timeout id
    this._codeResolvers = new Map(); // cellId -> resolver
    this._codeRunning = new Set(); // cellId -> running flag
    this._codeVersions = new Map(); // cellId -> version counter
    this._codeStartTimes = new Map(); // cellId -> start timestamp
    this.handleSandboxMessage = this.handleSandboxMessage.bind(this);
    window.addEventListener("message", this.handleSandboxMessage);

    this.bindEvents();
    this.init();
  }

  setupHeaderTitleEditing() {
    const titleEl = this.uiShell?.elements?.title;
    if (!titleEl) return;

    const makeEditable = () => {
      titleEl.contentEditable = "true";
      titleEl.dataset.editing = "true";
      const range = document.createRange();
      range.selectNodeContents(titleEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      titleEl.focus();
    };

    const commitTitle = () => {
      titleEl.contentEditable = "false";
      titleEl.dataset.editing = "";
      const text = titleEl.textContent || "";
      const item = this.lost.getCurrent();
      if (!item) return;
      if (text !== item.title) {
        this.lost.update(item.id, { title: text });
      }
    };

    titleEl.addEventListener("click", () => {
      if (titleEl.dataset.editing === "true") return;
      makeEditable();
    });
    titleEl.addEventListener("blur", commitTitle);
    titleEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitTitle();
        titleEl.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        titleEl.textContent = this.currentNotebook?.title || "";
        titleEl.blur();
      }
    });
  }

  // ---------- Initialization ----------

  async init() {
    this.lost.load();
    this.uiShell.load();
  }

  bindEvents() {
    // Toolbar
    if (this.notebookModelSelect) {
      this.notebookModelSelect.addEventListener("change", (e) => {
        const item = this.lost.getCurrent();
        if (!item) return;
        this.lost.update(item.id, { notebookModelId: e.target.value });
      });
    }

    this.runAllBtn?.addEventListener("click", () => this.runAllPromptCells());
    this.stopAllBtn?.addEventListener("click", () => this.stopAllCells());

    // Settings dialog
    this.addLlmBtn?.addEventListener("click", () => this.addLlmRow());
    if (this.refreshModelsBtn) {
      this.refreshModelsBtn.addEventListener("click", () =>
        this.refreshModelCache()
      );
    }
    this.settingsCloseBtn?.addEventListener("click", () => {
      this.saveLlmSettingsFromDialog();
      this.settingsDialog?.close();
    });
    this.settingsCancelBtn?.addEventListener("click", () => {
      this.settingsDialog?.close();
    });
    if (this.notebookModelSearch) {
      this.notebookModelSearch.addEventListener("input", (e) => {
        this.modelSearchTermNotebook = e.target.value;
        this.renderNotebookModelSelect();
      });
    }
  }

  // ---------- LOST: validation & update ----------

  validateNotebook(data) {
    if (!data || typeof data !== "object") return false;
    if (!Array.isArray(data.cells)) return false;
    return true;
  }

  onNotebookUpdate(item) {
    if (!item) return;
    // Normalize legacy fields into local-only flags
    if (Array.isArray(item.cells)) {
      item.cells = item.cells.map((c) => ({
        ...c,
        _stale: c._stale ?? c.stale ?? false,
        _outputExpanded: c._outputExpanded ?? c.outputExpanded ?? false,
        lastRunInfo: c.lastRunInfo
          ? {
              ...c.lastRunInfo,
              _rawRequest:
                c.lastRunInfo._rawRequest ?? c.lastRunInfo.rawRequest ?? null,
              _rawResponse:
                c.lastRunInfo._rawResponse ?? c.lastRunInfo.rawResponse ?? null
            }
          : c.lastRunInfo
      }));
    }
    this.currentNotebook = item;
    this.renderNotebook();
  }

  // ---------- LLM settings ----------

  loadLlmSettings() {
    try {
      const raw = localStorage.getItem(LLM_SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const providers = Array.isArray(parsed.providers)
        ? parsed.providers
        : [];
      const cachedModels = Array.isArray(parsed.cachedModels)
        ? parsed.cachedModels
        : [];
      const cacheTimestamp =
        typeof parsed.cacheTimestamp === "number" ? parsed.cacheTimestamp : 0;
      const normalizedCachedModels = cachedModels.map((m) => {
        const providersList = Array.isArray(providers) ? providers : [];
        const provider =
          providersList.find((p) => p.id === m.providerId) ||
          providersList.find((p) => p.provider === m.provider);
        const providerName = provider?.provider || m.provider || "openai";
        return {
          ...m,
          provider: providerName,
          providerId: m.providerId || provider?.id,
          apiKey: m.apiKey || provider?.apiKey || "",
          baseUrl:
            m.baseUrl ||
            provider?.baseUrl ||
            this.getProviderDefaultBaseUrl(providerName)
        };
      });

      // Legacy migration: old shape stored models with model/label/baseUrl/apiKey
      if (!providers.length && Array.isArray(parsed.models)) {
        const map = new Map();
        parsed.models.forEach((m) => {
          if (!m) return;
          const key = `${m.provider || "openai"}|${m.baseUrl || ""}`;
          if (!map.has(key)) {
            map.set(key, {
              id: genId("provider"),
              provider: m.provider || "openai",
              baseUrl: m.baseUrl || "",
              apiKey: m.apiKey || ""
            });
          }
        });
        map.forEach((val) => providers.push(val));
      }

      return {
        ...DEFAULT_LLM_SETTINGS,
        providers,
        cachedModels: normalizedCachedModels,
        cacheTimestamp
      };
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

  getProviderDefaultBaseUrl(provider) {
    if (provider === "claude") return "https://api.anthropic.com/v1";
    if (provider === "openrouter") return "https://openrouter.ai/api/v1";
    if (provider === "custom") return "";
    return "https://api.openai.com/v1";
  }

  getProviderLabel(provider) {
    if (provider === "claude") return "Anthropic";
    if (provider === "openrouter") return "OpenRouter";
    if (provider === "custom") return "Custom";
    return "OpenAI";
  }

  formatModelDisplay(model) {
    if (!model) return "";
    const providerName = this.getProviderLabel(model.provider);
    const modelName = model.displayName || model.model || model.id || "";
    return `${providerName}/${modelName}`;
  }

  getModelById(id) {
    if (!id) return null;
    return (this.llmSettings.cachedModels || []).find((m) => m.id === id) || null;
  }

  getModelWithProvider(id) {
    const model = this.getModelById(id);
    if (!model) return null;
    const providers = Array.isArray(this.llmSettings.providers)
      ? this.llmSettings.providers
      : [];
    const provider =
      providers.find((p) => p.id === model.providerId) ||
      providers.find((p) => p.provider === model.provider);
    const providerBase =
      provider?.baseUrl ||
      this.getProviderDefaultBaseUrl(provider?.provider || model.provider);
    return {
      ...model,
      provider: provider?.provider || model.provider,
      apiKey: model.apiKey || provider?.apiKey || "",
      baseUrl: model.baseUrl || providerBase
    };
  }

  getFilteredModels(searchTerm = "") {
    const term = (searchTerm || "").trim().toLowerCase();
    const models = Array.isArray(this.llmSettings.cachedModels)
      ? this.llmSettings.cachedModels
      : [];
    if (!term) return models;
    return models.filter((m) => {
      const name = this.formatModelDisplay(m).toLowerCase();
      const raw = `${m.model || ""}`.toLowerCase();
      return name.includes(term) || raw.includes(term);
    });
  }

  setModelCacheStatus(text, type = "info") {
    if (!this.modelCacheStatus) return;
    this.modelCacheStatus.textContent = text;
    this.modelCacheStatus.dataset.type = type;
  }

  async refreshModelCache() {
    // If settings dialog is open, read latest provider edits before fetching
    if (this.settingsDialog?.open) {
      const providersFromDialog = this.collectProvidersFromDialog();
      if (providersFromDialog) {
        this.llmSettings.providers = providersFromDialog;
        this.saveLlmSettings();
      }
    }

    if (this.refreshModelsInFlight) return;
    const providers = this.llmSettings.providers || [];
    if (!providers.length) {
      this.setModelCacheStatus("Add a provider to fetch models.", "warn");
      return;
    }

    this.refreshModelsInFlight = true;
    this.setModelCacheStatus("Refreshing model list…", "info");
    const collected = [];
    let errors = 0;

    for (const provider of providers) {
      try {
        const models = await this.fetchModelsForProvider(provider);
        models.forEach((m) =>
          collected.push({
            ...m,
            id: `${provider.id}:${m.model}`,
            providerId: provider.id,
            provider: provider.provider,
            apiKey: provider.apiKey,
            baseUrl:
              provider.baseUrl ||
              this.getProviderDefaultBaseUrl(provider.provider)
          })
        );
      } catch (err) {
        console.error("Model fetch failed", provider, err);
        errors += 1;
      }
    }

    this.llmSettings.cachedModels = collected;
    this.llmSettings.cacheTimestamp = Date.now();
    this.saveLlmSettings();
    this.renderNotebook();

    if (errors && collected.length) {
      this.setModelCacheStatus(
        `Fetched ${collected.length} models with ${errors} error(s).`,
        "warn"
      );
    } else if (errors && !collected.length) {
      this.setModelCacheStatus(
        "Could not refresh models. Check provider settings.",
        "error"
      );
    } else {
      this.setModelCacheStatus(
        `Fetched ${collected.length} models just now.`,
        "success"
      );
    }

    this.refreshModelsInFlight = false;
  }

  async fetchModelsForProvider(provider) {
    const baseUrl = (provider.baseUrl || this.getProviderDefaultBaseUrl(provider.provider)).replace(
      /\/+$/,
      ""
    );
    const headers = {
      "Content-Type": "application/json"
    };
    if (!provider.apiKey) {
      throw new Error("Missing API key");
    }

    if (provider.provider === "claude") {
      headers["x-api-key"] = provider.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
      const res = await fetch(`${baseUrl}/models`, { headers, method: "GET" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Claude models error ${res.status}: ${text}`);
      }
      const json = await res.json();
      const data = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.models)
        ? json.models
        : [];
      return data
        .map((m) => ({
          model: m?.id || m?.name,
          displayName: m?.display_name || m?.id || m?.name,
          createdAt: m?.created_at
        }))
        .filter((m) => !!m.model);
    }

    if (provider.provider === "openrouter") {
      headers["Authorization"] = `Bearer ${provider.apiKey}`;
      const res = await fetch(`${baseUrl}/models`, { headers, method: "GET" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OpenRouter models error ${res.status}: ${text}`);
      }
      const json = await res.json();
      const data = Array.isArray(json.data) ? json.data : json.models || [];
      return data
        .map((m) => m?.id || m?.model)
        .filter(Boolean)
        .map((id) => ({ model: id }));
    }

    // default openai
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
    const res = await fetch(`${baseUrl}/models`, { headers, method: "GET" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI models error ${res.status}: ${text}`);
    }
    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : [];
    return data
      .map((m) => m?.id)
      .filter(Boolean)
      .map((id) => ({ model: id }));
  }

  openSettingsDialog() {
    this.renderLlmSettingsDialog();
    this.settingsDialog.showModal();
  }

  renderLlmSettingsDialog() {
    this.llmListEl.innerHTML = "";
    const providers = this.llmSettings.providers;

    if (!providers.length) {
      // Add one empty row to start with
      providers.push({
        id: genId("provider"),
        provider: "openai",
        baseUrl: this.getProviderDefaultBaseUrl("openai"),
        apiKey: ""
      });
    }

    for (const provider of providers) {
      const row = document.createElement("div");
      row.className = "llm-row";
      row.dataset.id = provider.id;

      // Provider
      const providerField = document.createElement("div");
      providerField.className = "llm-field";
      providerField.innerHTML =
        '<span>Provider</span>' +
        '<select class="llm-provider-select">' +
        '<option value="openai">OpenAI</option>' +
        '<option value="claude">Anthropic</option>' +
        '<option value="openrouter">OpenRouter</option>' +
        '<option value="custom">Custom</option>' +
        "</select>";
      const providerSelect = providerField.querySelector("select");
      providerSelect.value = provider.provider || "openai";
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
      const baseInput = connField.querySelector(".llm-baseurl-input");
      baseInput.value =
        provider.baseUrl ||
        this.getProviderDefaultBaseUrl(provider.provider || "openai");
      connField.querySelector(".llm-apikey-input").value = provider.apiKey || "";
      row.appendChild(connField);

      // Actions
      const actions = document.createElement("div");
      actions.className = "llm-actions";
      actions.innerHTML =
        '<button type="button" class="icon-btn llm-delete-btn" title="Delete">✕</button>';
      row.appendChild(actions);

      // Provider change default base URL
      providerSelect.addEventListener("change", () => {
        const defaultBase = this.getProviderDefaultBaseUrl(providerSelect.value);
        if (defaultBase) {
          baseInput.value = defaultBase;
        } else if (!baseInput.value.trim()) {
          baseInput.value = "";
        }
      });

      // Delete button
      actions
        .querySelector(".llm-delete-btn")
        .addEventListener("click", () => {
          const idx = this.llmSettings.providers.findIndex(
            (m) => m.id === provider.id
          );
          if (idx >= 0) {
            this.llmSettings.providers.splice(idx, 1);
            this.renderLlmSettingsDialog();
          }
        });

      this.llmListEl.appendChild(row);
    }
  }

  addLlmRow() {
    this.llmSettings.providers.push({
      id: genId("provider"),
      provider: "openai",
      baseUrl: "",
      apiKey: ""
    });
    this.renderLlmSettingsDialog();
  }

  saveLlmSettingsFromDialog() {
    const providers = this.collectProvidersFromDialog();
    this.llmSettings.providers = providers;
    // Drop cached models that no longer have a provider backing them
    this.llmSettings.cachedModels = (this.llmSettings.cachedModels || []).filter(
      (m) => providers.some((p) => p.id === m.providerId)
    );
    this.saveLlmSettings();
    this.renderNotebook(); // refresh model selects
  }

  collectProvidersFromDialog() {
    if (!this.llmListEl) return [];
    const rows = Array.from(this.llmListEl.querySelectorAll(".llm-row"));
    const providers = [];

    for (const row of rows) {
      const id = row.dataset.id || genId("provider");
      const provider =
        row.querySelector(".llm-provider-select")?.value || "openai";
      const baseUrl =
        row.querySelector(".llm-baseurl-input")?.value?.trim() || "";
      const apiKey =
        row.querySelector(".llm-apikey-input")?.value?.trim() || "";

      if (!apiKey && !baseUrl) {
        // completely empty row, skip
        continue;
      }

      providers.push({
        id,
        provider,
        baseUrl,
        apiKey
      });
    }

    return providers;
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
    if (type === "code") name = `code_${index}`;

    const cell = {
      id: genId("cell"),
      type,
      name,
      text:
        type === "markdown"
          ? `# Cell ${index}\n`
          : type === "variable"
          ? ""
          : type === "code"
          ? "// JavaScript code runs in a sandbox.\n// Template other cells with {{name}}. Quote strings yourself, e.g. const notes = \"{{notes}}\";\nconst notes = \"{{notes}}\";\nconst summary = `Summary: ${notes}`;\nreturn summary;"
          : `Explain {{md_${index - 1} || notes}}`,
      systemPrompt: type === "prompt" ? DEFAULT_SYSTEM_PROMPT : "",
      params: "",
      _outputExpanded: false,
      modelId: "",
      lastOutput: "",
      error: "",
      _stale: false
    };

    cells.push(cell);
    this.lost.update(item.id, { cells });
  }

  addCellAt(type, index) {
    const item = this.lost.getCurrent();
    if (!item) return;
    const cells = Array.isArray(item.cells) ? [...item.cells] : [];
    const insertIndex = Math.max(0, Math.min(index + 1, cells.length));
    const nextNumber = cells.length + 1;
    let name = "";
    if (type === "markdown") name = `md_${nextNumber}`;
    if (type === "prompt") name = `cell_${nextNumber}`;
    if (type === "variable") name = `var_${nextNumber}`;
    if (type === "code") name = `code_${nextNumber}`;
    const cell = {
      id: genId("cell"),
      type,
      name,
      text:
        type === "markdown"
          ? `# Cell ${nextNumber}\n`
          : type === "variable"
          ? ""
          : type === "code"
          ? "// JavaScript code runs in a sandbox.\n// Template other cells with {{name}}. Quote strings yourself, e.g. const notes = \"{{notes}}\";\n// Return a value or assign to `output`.\nreturn \"Hello \" + \"{{notes}}\";"
          : `Explain {{md_${Math.max(1, insertIndex)} || notes}}`,
      systemPrompt: type === "prompt" ? DEFAULT_SYSTEM_PROMPT : "",
      params: "",
      _outputExpanded: false,
      modelId: "",
      lastOutput: "",
      error: "",
      _stale: false
    };
    cells.splice(insertIndex, 0, cell);
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
      if (
        cell.type !== "prompt" &&
        cell.type !== "markdown" &&
        cell.type !== "variable" &&
        cell.type !== "code"
      )
        return;
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
      _stale: !!c._stale
    }));
    const prevList = (Array.isArray(prevCells) ? prevCells : []).map((c) => ({
      ...c,
      _stale: !!c._stale
    }));

    const refPrev = this.buildReferenceIndex(prevList);
    const refNew = this.buildReferenceIndex(next);

    // Reset stale flags; we'll recompute.
    next.forEach((c) => {
      c._stale = false;
    });

    const staleSeeds = new Set();
    const queue = [];
    const seen = new Set();

    const pushQueue = (id, causeStale) => {
      const sig = `${id}::${causeStale ? 1 : 0}`;
      if (seen.has(sig)) return;
      seen.add(sig);
      queue.push({ id, causeStale });
    };

    // Prompts edited (non-output) become stale sources; output refresh clears staleness
    changedIds.forEach((id) => {
      const cell = next.find((c) => c.id === id);
      if (!cell) return;
      if (reason === "output") {
        cell._stale = false;
        pushQueue(id, false); // refreshed, do not stale downstream
      } else if (cell.type === "prompt" || cell.type === "code") {
        cell._stale = true;
        staleSeeds.add(cell.id);
        pushQueue(id, true);
      } else {
        // markdown/variable edits themselves are fresh, but their dependents should become stale
        pushQueue(id, true);
      }
    });

    // Persisted stale prompts (not refreshed this cycle) remain stale sources
    prevList.forEach((cell) => {
      if (
        cell._stale &&
        cell.type === "prompt" &&
        !(reason === "output" && changedIds.has(cell.id))
      ) {
        const cur = next.find((c) => c.id === cell.id);
        if (cur) {
          cur._stale = true;
          staleSeeds.add(cur.id);
          pushQueue(cur.id, true);
        }
      }
    });

    const staleClosure = new Set(staleSeeds);

    // Propagate staleness
    while (queue.length) {
      const { id, causeStale } = queue.shift();
      if (!causeStale) continue;
      const keys = this.collectCellKeys(prevList, next, id);
      keys.forEach((k) => {
        const refSet = new Set([
          ...(refPrev.get(k) || []),
          ...(refNew.get(k) || [])
        ]);
        refSet.forEach((dependentId) => {
          if (!staleClosure.has(dependentId)) {
            staleClosure.add(dependentId);
            pushQueue(dependentId, true);
          }
        });
      });
    }

    // Apply final staleness state
    return next.map((c) => ({
      ...c,
      _stale: staleClosure.has(c.id)
    }));
  }

  // ---------- Rendering ----------

  renderNotebook() {
    const item = this.currentNotebook;
    if (!item) return;

    const focusState =
      this.pendingFocusState || this.captureFocusState();
    this.pendingFocusState = null;
    this.parsedOutputs.clear();

    // Toolbar actions state
    const anyRunning = this.runningCells.size > 0;
    this.runAllBtn.disabled = this.runAllInFlight || anyRunning;
    this.stopAllBtn.disabled = !anyRunning;
    this.runAllBtn.classList.toggle("is-running", this.runAllInFlight);
    this.stopAllBtn.classList.toggle("is-running", anyRunning);

    // Toolbar
    this.renderNotebookModelSelect();
    this.renderCells();
    if (this.uiShell?.setTitle) {
      this.uiShell.setTitle(item.title || "Untitled notebook");
    }

    this.restoreFocusState(focusState);
  }

  renderNotebookModelSelect() {
    const container = this.notebookModelLabel;
    if (!container) return;
    container.innerHTML = "";

    const labelSpan = document.createElement("span");
    labelSpan.textContent = "Default LLM";
    labelSpan.className = "notebook-model-heading";
    container.appendChild(labelSpan);

    const row = document.createElement("div");
    row.className = "model-picker-row";

    const picker = this.createModelPicker({
      selectedId: this.currentNotebook?.notebookModelId || "",
      searchTerm: this.modelSearchTermNotebook || "",
      placeholder: "Search models",
      defaultLabel: "None",
      defaultValue: "",
      onSearchChange: (term) => {
        this.modelSearchTermNotebook = term;
      },
      onSelect: (id) => {
        const item = this.currentNotebook;
        if (!item) return;
        this.lost.update(item.id, { notebookModelId: id });
      }
    });
    row.appendChild(picker);

    const paramsUi = this.createParamsUi(
      this.currentNotebook?.notebookParams || "",
      (val) => {
        const item = this.currentNotebook;
        if (!item) return;
        this.lost.update(item.id, { notebookParams: val });
      }
    );
    row.appendChild(paramsUi);

    container.appendChild(row);
  }

  createParamsUi(initialValue, onChange) {
    const wrapper = document.createElement("div");
    wrapper.className = "model-params-wrapper";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "model-params-btn";
    btn.textContent = "+";
    btn.title = "Add parameters (temperature, etc.)";

    const hasValue = !!(initialValue && initialValue.trim());
    if (hasValue) {
      btn.classList.add("active");
    }

    const panel = document.createElement("div");
    panel.className = "model-params-panel";
    panel.style.display = "none";

    const textarea = document.createElement("textarea");
    textarea.className = "model-params-textarea";
    textarea.placeholder = "temperature=0.5\ntop_p=0.7\nfrequency_penalty=0.05";
    textarea.value = initialValue || "";

    textarea.addEventListener("input", (e) => {
      const val = e.target.value;
      if (val.trim()) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
      onChange(val);
    });

    const togglePanel = () => {
      const isHidden = panel.style.display === "none";
      if (isHidden) {
        panel.style.display = "block";
        textarea.focus();
        document.addEventListener("click", handleOutside, { capture: true });
      } else {
        closePanel();
      }
    };

    const closePanel = () => {
      panel.style.display = "none";
      document.removeEventListener("click", handleOutside, { capture: true });
    };

    const handleOutside = (e) => {
      if (!wrapper.contains(e.target)) {
        closePanel();
      }
    };

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel();
    });

    panel.appendChild(textarea);
    wrapper.appendChild(btn);
    wrapper.appendChild(panel);
    return wrapper;
  }


  createModelPicker(config) {
    const {
      selectedId = "",
      searchTerm = "",
      placeholder = "Search",
      defaultLabel = null,
      defaultValue = ""
    } = config || {};

    let currentId = selectedId;
    let currentSearch = searchTerm;

    const wrapper = document.createElement("div");
    wrapper.className = "model-picker";

    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "cell-add-pill model-picker-pill";
    const panel = document.createElement("div");
    panel.className = "model-picker-panel";
    panel.style.display = "none";

    const input = document.createElement("input");
    input.type = "search";
    input.className = "model-picker-search";
    input.placeholder = placeholder;
    input.value = currentSearch;

    const list = document.createElement("div");
    list.className = "model-picker-list";

    const getLabel = (id) => {
      if (!id && defaultLabel !== null) return defaultLabel;
      return this.getModelLabelById(id) || id || defaultLabel || "Select model";
    };

    const renderList = () => {
      list.innerHTML = "";
      const models =
        Array.isArray(this.llmSettings.cachedModels) &&
        this.llmSettings.cachedModels.length
          ? this.llmSettings.cachedModels
          : [];
      const term = (currentSearch || "").toLowerCase();
      const filtered = models.filter((m) => {
        const label = this.formatModelDisplay(m).toLowerCase();
        return label.includes(term);
      });

      const addEntry = (id, label) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "model-picker-item";
        btn.textContent = label;
        if (id === currentId) btn.classList.add("selected");
        btn.addEventListener("click", () => {
          currentId = id;
          pill.textContent = getLabel(currentId);
          if (typeof config.onSelect === "function") {
            config.onSelect(id);
          }
          panel.style.display = "none";
        });
        list.appendChild(btn);
      };

      if (defaultLabel !== null) {
        addEntry(defaultValue, defaultLabel);
      }
      filtered.forEach((m) => addEntry(m.id, this.formatModelDisplay(m)));
      pill.textContent = getLabel(currentId);
    };

    const openPanel = () => {
      panel.style.display = "block";
      input.focus();
      renderList();
      document.addEventListener("click", handleOutside, { once: true });
    };
    const closePanel = () => {
      panel.style.display = "none";
    };
    const handleOutside = (e) => {
      if (!wrapper.contains(e.target)) {
        closePanel();
      }
    };

    pill.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = panel.style.display === "none";
      if (willOpen) openPanel();
      else closePanel();
    });

    input.addEventListener("input", (e) => {
      currentSearch = e.target.value;
      if (typeof config.onSearchChange === "function") {
        config.onSearchChange(currentSearch);
      }
      renderList();
    });

    panel.appendChild(input);
    panel.appendChild(list);
    wrapper.appendChild(pill);
    wrapper.appendChild(panel);
    renderList();

    return wrapper;
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

      const typePill = document.createElement("div");
      typePill.className = `cell-type-pill ${typeClass}`;
      const typeLabel = document.createElement("span");
      typeLabel.className = "cell-type-label";
      typeLabel.textContent =
        cell.type === "prompt"
          ? "Prompt"
          : cell.type === "variable"
          ? "Variable"
          : cell.type === "code"
          ? "Code"
          : "Markdown";
      typePill.appendChild(typeLabel);

      const nameInput = document.createElement("input");
      nameInput.className = "cell-name-input";
      nameInput.type = "text";
      nameInput.placeholder = "Block name";
      nameInput.value = cell.name || "";
      typePill.appendChild(nameInput);

      const dropdownBtn = document.createElement("button");
      dropdownBtn.type = "button";
      dropdownBtn.className = "cell-type-dropdown";
      dropdownBtn.setAttribute("aria-label", "Change cell type");
      dropdownBtn.textContent = "▾";
      typePill.appendChild(dropdownBtn);

      const typeMenu = document.createElement("div");
      typeMenu.className = "cell-type-menu";
      const typeOptions = [
        { value: "markdown", label: "Markdown", className: "type-markdown" },
        { value: "prompt", label: "Prompt", className: "type-prompt" },
        { value: "variable", label: "Variable", className: "type-variable" },
        { value: "code", label: "Code", className: "type-code" }
      ];
      typeOptions
        .filter((opt) => opt.value !== (cell.type || "markdown"))
        .forEach((opt) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `cell-type-option ${opt.className}`;
          btn.textContent = opt.label;
          btn.addEventListener("click", () => {
            this.updateCells((cells) => {
              return cells.map((c) =>
                c.id === cell.id
                  ? {
                      ...c,
                      type: opt.value,
                      error: ""
                    }
                  : c
              );
            }, { changedIds: [cell.id] });
            closeTypeMenu();
          });
          typeMenu.appendChild(btn);
        });
      typePill.appendChild(typeMenu);

      const closeTypeMenu = () => {
        typeMenu.classList.remove("open");
        typePill.classList.remove("menu-open");
        document.removeEventListener("click", handleOutsideClick);
      };
      const handleOutsideClick = (event) => {
        if (!typePill.contains(event.target)) {
          closeTypeMenu();
        }
      };
      dropdownBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = !typeMenu.classList.contains("open");
        if (willOpen) {
          typeMenu.classList.add("open");
          typePill.classList.add("menu-open");
          document.addEventListener("click", handleOutsideClick);
        } else {
          closeTypeMenu();
        }
      });

      header.appendChild(typePill);

      let llmSelect = null;
      if (cell.type === "prompt") {
        const searchTerm = this.cellModelSearch.get(cell.id) || "";
        const picker = this.createModelPicker({
          selectedId: cell.modelId || "",
          searchTerm,
          placeholder: "Search models",
          defaultLabel: "Use notebook default",
          defaultValue: "",
          onSearchChange: (term) => {
            this.cellModelSearch.set(cell.id, term);
          },
          onSelect: (id) => {
            this.updateCells(
              (cells) =>
                cells.map((c) =>
                  c.id === cell.id ? { ...c, modelId: id } : c
                ),
              { changedIds: [cell.id] }
            );
          }
        });
        llmSelect = picker;
        header.appendChild(picker);

        const paramsUi = this.createParamsUi(
          cell.params || "",
          (val) => {
            this.updateCells(
              (cells) =>
                cells.map((c) => (c.id === cell.id ? { ...c, params: val } : c)),
              { changedIds: [cell.id] }
            );
          }
        );
        header.appendChild(paramsUi);
      }

      const statusSpan = document.createElement("span");
      statusSpan.className = "cell-status";
      const promptRunning = this.runningCells.has(cell.id);
      const codeRunning = this._codeRunning.has(cell.id);
      const isRunning = promptRunning || codeRunning;
      if (isRunning) {
        root.classList.add("is-running");
      }
      if (promptRunning) {
        statusSpan.classList.add("running");
        statusSpan.textContent = "Running…";
        const timerSpan = document.createElement("span");
        timerSpan.className = "running-timer";
        const startedAt = this.runningStartTimes.get(cell.id);
        timerSpan.textContent = this.formatDuration(
          startedAt ? Date.now() - startedAt : 0
        );
        statusSpan.appendChild(timerSpan);
      } else if (codeRunning) {
        statusSpan.classList.add("running");
        statusSpan.textContent = "Running…";
      } else if (cell.error) {
        statusSpan.classList.add("error");
        statusSpan.textContent = "Error";
      } else if (cell._stale) {
        statusSpan.classList.add("stale");
        statusSpan.textContent = "Stale";
      } else if (cell.lastOutput && (cell.type === "prompt" || cell.type === "code")) {
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
        runBtn.innerHTML =
          '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class=""><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" /></svg>';
        const isStale = !!cell._stale || !cell.lastOutput;
        runBtn.disabled = isRunning;
        runBtn.classList.toggle("is-stale", isStale && !isRunning);
        runBtn.classList.toggle("is-running", isRunning);
        actions.appendChild(runBtn);

        const stopBtn = document.createElement("button");
        stopBtn.type = "button";
        stopBtn.className = "cell-action-btn stop-btn";
        stopBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class=""><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M17 4h-10a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3 -3v-10a3 3 0 0 0 -3 -3z" /></svg>';
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

      let systemTextarea = null;
      if (cell.type === "prompt") {
        const systemLabel = document.createElement("div");
        systemLabel.className = "cell-subtitle";
        systemLabel.textContent = "System prompt";
        body.appendChild(systemLabel);

        systemTextarea = document.createElement("textarea");
        systemTextarea.className = "cell-textarea cell-system-textarea";
        systemTextarea.value =
          cell.systemPrompt != null && cell.systemPrompt !== ""
            ? cell.systemPrompt
            : DEFAULT_SYSTEM_PROMPT;
        body.appendChild(systemTextarea);

        const userLabel = document.createElement("div");
        userLabel.className = "cell-subtitle";
        userLabel.textContent = "User prompt";
        body.appendChild(userLabel);
      }

      const textarea = document.createElement("textarea");
      textarea.className = "cell-textarea cell-user-textarea";
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
      } else if (cell.type === "code") {
        help.textContent =
          "JavaScript runs in a sandbox. Use {{name}} to template in outputs. Return a value or assign to `output`.";
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
          : cell.type === "code"
          ? cell.lastOutput || ""
          : cell.text || "";
      const parsed =
        cell.type === "prompt" || cell.type === "variable" || cell.type === "code"
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
      if (
        cell.type === "markdown" ||
        cell.type === "variable" ||
        cell.type === "code" ||
        (cell.type === "prompt" && !parsed.isJson)
      ) {
        const insertBtn = document.createElement("button");
        insertBtn.type = "button";
        insertBtn.className = "output-insert-btn";
        insertBtn.textContent = "{}";
        insertBtn.title = `Insert reference {{ ${baseRef} }}`;
        insertBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.insertReference(`{{ ${baseRef} }}`, { ensureVisible: true });
        });
        output.appendChild(insertBtn);
      }
      if (cell._stale) {
        output.classList.add("stale");
      }
      if (true) {
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "output-expand-btn";
        const expandedFlag = !!(cell._outputExpanded ?? cell.outputExpanded);
        toggleBtn.textContent = expandedFlag ? "⇱" : "⇲";
        toggleBtn.title = expandedFlag ? "Collapse output" : "Expand output";
        toggleBtn.style.display = "none";

        toggleBtn.addEventListener("click", () => {
          const expanded = !!(cell._outputExpanded ?? cell.outputExpanded);
          this.updateCells(
            (cells) =>
              cells.map((c) =>
                c.id === cell.id ? { ...c, _outputExpanded: !expanded } : c
              ),
            { changedIds: [] }
          );
        });

        const applyCollapseUi = () => {
          const expanded = !!(cell._outputExpanded ?? cell.outputExpanded);
          const isOverflow =
            output.scrollHeight >
            (OUTPUT_COLLAPSE_MAX_HEIGHT + 4);
          if (!isOverflow) {
            toggleBtn.style.display = "none";
            output.classList.remove("collapsed");
            output.style.maxHeight = "";
            output.style.overflow = "";
            return;
          }
          toggleBtn.textContent = expanded ? "⇱" : "⇲";
          toggleBtn.title = expanded ? "Collapse output" : "Expand output";
          toggleBtn.style.display = "inline-flex";
          output.classList.toggle("collapsed", !expanded);
          output.style.maxHeight = expanded
            ? ""
            : `${OUTPUT_COLLAPSE_MAX_HEIGHT}px`;
          output.style.overflow = expanded ? "auto" : "hidden";
          if (!output.contains(toggleBtn)) {
            output.appendChild(toggleBtn);
          }
        };

        requestAnimationFrame(applyCollapseUi);
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
        if (info.params && Object.keys(info.params).length > 0) {
          const p = Object.entries(info.params)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
          parts.push(p);
        }
        meta.textContent = parts.join(" · ");
        meta.title = "Click to view request/response log";
        meta.addEventListener("click", () => this.showLogOverlay(info));
        body.appendChild(meta);
      } else if (cell.type === "code") {
        const info = cell.lastRunInfo || {};
        if (cell.error) {
          const meta = document.createElement("div");
          meta.className = "cell-run-meta cell-run-meta-error";
          meta.textContent = `Error: ${cell.error}`;
          body.appendChild(meta);
        } else if (info && (info.durationMs != null || info.status)) {
          const meta = document.createElement("div");
          meta.className = "cell-run-meta";
          const parts = [];
          if (info.status) parts.push(info.status === "ok" ? "Ran" : info.status);
          if (info.durationMs != null)
            parts.push(`time: ${this.formatDuration(info.durationMs)}`);
          meta.textContent = parts.join(" · ");
          body.appendChild(meta);
        }
      }
      // Click to insert refs
      output.addEventListener("click", (e) => {
        const target = e.target.closest(".ref-click");
        if (target?.dataset?.ref) {
          e.preventDefault();
          e.stopPropagation();
          this.insertReference(target.dataset.ref, { ensureVisible: true });
          return;
        }
        if (cell.type === "prompt" && !parsed.isJson) {
          e.preventDefault();
          e.stopPropagation();
          this.insertReference(`{{ ${baseRef} }}`, { ensureVisible: true });
        }
      });
      body.appendChild(output);

      root.appendChild(body);
      this.cellsContainer.appendChild(root);

      // ----- Inline add-cell pills -----
      const addRow = document.createElement("div");
      addRow.className = "cell-add-row";
      const addLabel = document.createElement("span");
      addLabel.className = "cell-add-label";
      addLabel.textContent = "";
      const addPillContainer = document.createElement("div");
      addPillContainer.className = "cell-add-pills";
      const types = [
        { type: "markdown", label: "+ markdown", cls: "type-markdown" },
        { type: "prompt", label: "+ prompt", cls: "type-prompt" },
        { type: "variable", label: "+ variable", cls: "type-variable" },
        { type: "code", label: "+ code", cls: "type-code" }
      ];
      types.forEach((t) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = `cell-add-pill ${t.cls}`;
        pill.textContent = t.label;
        pill.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.addCellAt(t.type, index);
        });
        addPillContainer.appendChild(pill);
      });
      addRow.appendChild(addLabel);
      addRow.appendChild(addPillContainer);
      this.cellsContainer.appendChild(addRow);

      if (systemTextarea) {
        this.applyTextareaHeight(systemTextarea, "collapsed");
      }
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

      // Type switching handled via custom menu

      nameInput.addEventListener("focus", () => {
        this.lastFocusedEditor = nameInput;
      });

      if (systemTextarea) {
        systemTextarea.addEventListener("input", (e) => {
          const systemPrompt = e.target.value;
          this.pendingFocusState = {
            cellId: cell.id,
            role: "system-textarea",
            selection:
              typeof systemTextarea.selectionStart === "number" &&
              typeof systemTextarea.selectionEnd === "number"
                ? {
                    start: systemTextarea.selectionStart,
                    end: systemTextarea.selectionEnd
                  }
                : null
          };
          this.templateHoverCache.delete(systemTextarea);
          this.applyTextareaHeight(systemTextarea);
          this.updateCells((cells) =>
            cells.map((c) =>
              c.id === cell.id ? { ...c, systemPrompt, error: "" } : c
            ),
            { changedIds: [cell.id] }
          );
        });
        systemTextarea.addEventListener("focus", () => {
          this.lastFocusedEditor = systemTextarea;
          this.applyTextareaHeight(systemTextarea, "expanded");
        });
        systemTextarea.addEventListener("blur", () => {
          this.applyTextareaHeight(systemTextarea, "collapsed");
        });
        const handleSystemHover = (e) => this.handleTextareaHover(e, env);
        systemTextarea.addEventListener("mousemove", handleSystemHover);
        systemTextarea.addEventListener("mouseleave", () =>
          this.hideVariableTooltip()
        );
      }

      textarea.addEventListener("input", (e) => {
        const text = e.target.value;
        this.pendingFocusState = {
          cellId: cell.id,
          role: "textarea",
          selection:
            typeof textarea.selectionStart === "number" &&
            typeof textarea.selectionEnd === "number"
              ? {
                  start: textarea.selectionStart,
                  end: textarea.selectionEnd
                }
              : null
        };
        this.templateHoverCache.delete(textarea);
        this.applyTextareaHeight(textarea);
        this.updateCells((cells) =>
          cells.map((c) =>
            c.id === cell.id ? { ...c, text, error: "" } : c
          ),
          { changedIds: [cell.id] }
        );
        if (cell.type === "code") {
          this.scheduleCodeRun(cell.id);
        }
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
    const m = (this.llmSettings.cachedModels || []).find((m) => m.id === id);
    if (!m) return "";
    return this.formatModelDisplay(m);
  }

  // ---------- Focus preservation ----------

  captureFocusState() {
    const active = document.activeElement;
    if (!active) return null;

    if (active === this.notebookTitleInput) {
      return { type: "notebook-title" };
    }

    if (active.classList.contains("model-params-textarea")) {
      const cellEl = active.closest(".cell");
      if (cellEl) {
        return {
          cellId: cellEl.dataset.id,
          role: "params",
          selection:
            typeof active.selectionStart === "number"
              ? { start: active.selectionStart, end: active.selectionEnd }
              : null
        };
      }
      if (active.closest(".notebook-toolbar-label")) {
        return {
          type: "notebook-params",
          selection:
            typeof active.selectionStart === "number"
              ? { start: active.selectionStart, end: active.selectionEnd }
              : null
        };
      }
    }

    const cellEl = active.closest(".cell");
    if (!cellEl) return null;

    const cellId = cellEl.dataset.id;
    let role = null;
    if (active.classList.contains("cell-system-textarea"))
      role = "system-textarea";
    else if (active.classList.contains("cell-textarea")) role = "textarea";
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

    if (state.type === "notebook-params") {
      const container = this.notebookModelLabel;
      const btn = container?.querySelector(".model-params-btn");
      if (btn) {
        btn.click(); // Open panel
        const textarea = container.querySelector(".model-params-textarea");
        if (textarea) {
          textarea.focus({ preventScroll: true });
          if (state.selection) {
            textarea.setSelectionRange(
              state.selection.start,
              state.selection.end
            );
          }
        }
      }
      return;
    }

    if (!state.cellId) return;

    const cellEl = this.cellsContainer.querySelector(
      `article.cell[data-id="${state.cellId}"]`
    );
    if (!cellEl) return;

    if (state.role === "params") {
      const btn = cellEl.querySelector(".model-params-btn");
      if (btn) {
        btn.click(); // Open panel
        const textarea = cellEl.querySelector(".model-params-textarea");
        if (textarea) {
          textarea.focus({ preventScroll: true });
          if (state.selection) {
            textarea.setSelectionRange(
              state.selection.start,
              state.selection.end
            );
          }
        }
      }
      return;
    }

    let target = null;
    if (state.role === "system-textarea") {
      target =
        cellEl.querySelector(".cell-system-textarea") ||
        cellEl.querySelector(".cell-textarea");
    } else if (state.role === "textarea") {
      target =
        cellEl.querySelector(".cell-user-textarea") ||
        cellEl.querySelector(".cell-textarea");
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
    textarea.rows = 1;
    let fullHeight = textarea.scrollHeight
    /*
    const cs = getComputedStyle(textarea)
    const lineHeight = parseFloat(cs.lineHeight);
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const paddingBottom = parseFloat(cs.paddingBottom) || 0;

    let fullHeight = textarea.scrollHeight
    console.log("fullHeight:", fullHeight, "lineHeight:", lineHeight, "paddingTop:", paddingTop, "paddingBottom:", paddingBottom);
    if (fullHeight < (lineHeight * 2) + paddingTop + paddingBottom) {
      fullHeight -= lineHeight;
    }*/
    const collapsedHeight = this.getCollapsedHeight(textarea, 4);
    const targetHeight =
      desiredMode === "expanded" || fullHeight <= collapsedHeight
        ? fullHeight
        : collapsedHeight;
    const viewportCap = Math.max(240, Math.floor(window.innerHeight * 0.8));
    const finalHeight = Math.min(targetHeight, viewportCap);
    textarea.style.maxHeight = `${viewportCap}px`;
    textarea.style.height = `${finalHeight}px`;
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
          : c.type === "code"
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

  parseParams(str) {
    if (!str || !str.trim()) return {};
    const params = {};
    str.split("\n").forEach((line) => {
      const parts = line.split("=");
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const valStr = parts.slice(1).join("=").trim();
        let val = valStr;
        if (!isNaN(valStr) && valStr !== "") val = Number(valStr);
        else if (valStr === "true") val = true;
        else if (valStr === "false") val = false;
        params[key] = val;
      }
    });
    return params;
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

    const model = this.getModelWithProvider(modelId);
    if (!model || !model.apiKey || !model.model) {
      alert(
        "The selected LLM is not fully configured. Please add API key and model id."
      );
      return;
    }

    // Parse params
    const notebookParams = this.parseParams(item.notebookParams);
    const cellParams = this.parseParams(cell.params);
    let finalParams = {};
    if (cell.modelId) {
      // Cell has specific model override -> use only cell params (do not inherit notebook params)
      finalParams = cellParams;
    } else {
      // Cell uses default model -> use cell params override, or fallback to notebook params
      finalParams =
        Object.keys(cellParams).length > 0 ? cellParams : notebookParams;
    }

    // Build final prompt with environment
    const env = this.buildEnvironment(item);
    const finalPrompt = this.expandTemplate(cell.text || "", env);
    const finalSystemPrompt = this.expandTemplate(
      cell.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      env
    );

    const controller = new AbortController();
    this.runningControllers.set(cellId, controller);
    this.runningCells.add(cellId);
    this.runningStartTimes.set(cellId, Date.now());
    this.startRunningTimerLoop();
    this.renderNotebook();

    try {
      const result = await this.callLLM(
        model,
        finalPrompt,
        finalSystemPrompt,
        controller.signal,
        finalParams
      );
      const output =
        result && typeof result === "object" && "text" in result
          ? result.text
          : result;
      const usage =
        result && typeof result === "object" && result.usage
          ? result.usage
          : {};
      const rawRequest =
        result && typeof result === "object" && result._rawRequest
          ? result._rawRequest
          : null;
      const rawResponse =
        result && typeof result === "object" && result._rawResponse
          ? result._rawResponse
          : null;
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
                      "",
                    params: finalParams,
                    _rawRequest: rawRequest,
                    _rawResponse: rawResponse
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
    // Cancel any pending/running code cells
    this._codeRunTimers.forEach((t) => clearTimeout(t));
    this._codeRunTimers.clear();
    this._codeRunning.clear();
    this._codeVersions.clear();
    this._codeStartTimes.clear();
    this.renderNotebook();
  }

  // ---------- Code execution (sandbox) ----------

  ensureSandbox(cellId) {
    let iframe = this._sandboxes.get(cellId);
    if (iframe && document.body.contains(iframe)) return iframe;
    iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.sandbox = "allow-scripts";
    iframe.srcdoc = `
<!doctype html>
<html>
<body>
<script>
  (function() {
    const reply = (payload) => {
      try { parent.postMessage(payload, "*"); } catch (_) {}
    };
    window.addEventListener("message", async (event) => {
      const data = event.data || {};
      if (data.type !== "code-exec") return;
      const { cellId, code, version } = data;
      try {
        const runner = new Function(\`
          'use strict';
          return (async () => {
            let output;
            \${code}
            return typeof output !== "undefined" ? output : undefined;
          })();
        \`);
        const value = await runner();
        reply({ type: "code-result", cellId, version, value });
      } catch (err) {
        reply({
          type: "code-error",
          cellId,
          version,
          error: (err && err.message) ? err.message : String(err)
        });
      }
    });
  })();
<\/script>
</body>
</html>`;
    document.body.appendChild(iframe);
    this._sandboxes.set(cellId, iframe);
    return iframe;
  }

  handleSandboxMessage(event) {
    const data = event?.data || {};
    if (!data || (data.type !== "code-result" && data.type !== "code-error")) {
      return;
    }
    const { cellId, version } = data;
    if (!cellId) return;
    const currentVersion = this._codeVersions.get(cellId);
    if (currentVersion == null || version !== currentVersion) return;

    this._codeRunning.delete(cellId);
    this._codeRunTimers.delete(cellId);
    const startedAt = this._codeStartTimes.get(cellId);
    this._codeStartTimes.delete(cellId);
    const durationMs = startedAt ? Date.now() - startedAt : null;

    if (data.type === "code-error") {
      const message =
        data.error && typeof data.error === "string"
          ? data.error
          : "Code execution failed.";
      this.updateCells(
        (cells) =>
          cells.map((c) =>
            c.id === cellId
              ? {
                  ...c,
                  error: message,
                  lastRunInfo: {
                    durationMs,
                    status: "error"
                  }
                }
              : c
          ),
        { changedIds: [cellId] }
      );
      this.renderNotebook();
      return;
    }

    const value = data.value;
    let serialized = "";
    if (value === undefined || value === null) {
      serialized = "";
    } else if (typeof value === "string") {
      serialized = value;
    } else {
      try {
        serialized = JSON.stringify(value, null, 2);
      } catch {
        serialized = String(value);
      }
    }

    this.updateCells(
      (cells) =>
        cells.map((c) =>
          c.id === cellId
            ? {
                ...c,
                lastOutput: serialized,
                error: "",
                _stale: false,
                lastRunInfo: {
                  durationMs,
                  status: "ok"
                }
              }
            : c
        ),
      { changedIds: [cellId], reason: "output" }
    );
    this.renderNotebook();
  }

  scheduleCodeRun(cellId, delayMs = 800) {
    if (!cellId) return;
    const prev = this._codeRunTimers.get(cellId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this._codeRunTimers.delete(cellId);
      this.runCodeCell(cellId);
    }, delayMs);
    this._codeRunTimers.set(cellId, timer);
  }

  async runCodeCell(cellId) {
    const item = this.lost.getCurrent();
    if (!item) return;
    const cells = Array.isArray(item.cells) ? item.cells : [];
    const cell = cells.find((c) => c.id === cellId);
    if (!cell || cell.type !== "code") return;

    const env = this.buildEnvironment(item);
    const code = this.expandTemplate(cell.text || "", env);
    const iframe = this.ensureSandbox(cellId);
    const nextVersion = (this._codeVersions.get(cellId) || 0) + 1;
    this._codeVersions.set(cellId, nextVersion);
    this._codeRunning.add(cellId);
    this._codeStartTimes.set(cellId, Date.now());
    this.renderNotebook();

    try {
      iframe?.contentWindow?.postMessage(
        {
          type: "code-exec",
          cellId,
          code,
          version: nextVersion
        },
        "*"
      );
    } catch (err) {
      this._codeRunning.delete(cellId);
      const msg =
        err && typeof err.message === "string"
          ? err.message
          : "Failed to start sandbox.";
      this.updateCells(
        (cells) =>
          cells.map((c) =>
            c.id === cellId ? { ...c, error: msg } : c
          ),
        { changedIds: [cellId] }
      );
      this.renderNotebook();
    }
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

  insertReference(ref, opts = {}) {
    const { ensureVisible = false } = opts;
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
    if (ensureVisible) {
      const rect = target.getBoundingClientRect();
      const inView =
        rect.top >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight);
      if (!inView) {
        target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }

  sanitizeHeaders(headers = {}) {
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

  buildLogOverlay() {
    if (this.logOverlay) return;
    const overlay = document.createElement("div");
    overlay.className = "llm-log-overlay";
    overlay.style.display = "none";

    const panel = document.createElement("div");
    panel.className = "llm-log-panel";

    const header = document.createElement("div");
    header.className = "llm-log-header";
    header.textContent = "LLM Request & Response";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "llm-log-close";
    closeBtn.textContent = "✕";
    header.appendChild(closeBtn);

    const textarea = document.createElement("textarea");
    textarea.className = "llm-log-textarea";
    textarea.readOnly = true;

    panel.appendChild(header);
    panel.appendChild(textarea);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    closeBtn.addEventListener("click", () => {
      overlay.style.display = "none";
    });

    this.logOverlay = overlay;
    this.logOverlayTextarea = textarea;
    this.logOverlayClose = closeBtn;
  }

  showLogOverlay(log) {
    if (!this.logOverlay) this.buildLogOverlay();
    const overlay = this.logOverlay;
    const textarea = this.logOverlayTextarea;
    const payload = log
      ? {
          request: log._rawRequest ?? null,
          response: log._rawResponse ?? null
        }
      : { message: "No request/response recorded." };
    textarea.value = JSON.stringify(payload, null, 2);
    overlay.style.display = "flex";
    textarea.focus();
  }

  async callLLM(model, prompt, systemPrompt, signal, params = {}) {
    if (model.provider === "claude") {
      return this.callClaude(model, prompt, systemPrompt, signal, params);
    }
    if (model.provider === "openrouter") {
      return this.callOpenRouter(model, prompt, systemPrompt, signal, params);
    }
    // default to openai
    return this.callOpenAI(model, prompt, systemPrompt, signal, params);
  }

  async callOpenAI(model, prompt, systemPrompt, signal, params) {
    const baseUrl = (model.baseUrl || "https://api.openai.com/v1").replace(
      /\/+$/,
      ""
    );
    const url = `${baseUrl}/chat/completions`;

    const requestBody = {
      model: model.model,
      ...params,
      messages: [
        {
          role: "system",
          content: systemPrompt || DEFAULT_SYSTEM_PROMPT
        },
        { role: "user", content: prompt }
      ]
    };
    const requestHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`
    };

    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: requestHeaders,
      body: JSON.stringify(requestBody)
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
    const resHeaders = {};
    res.headers.forEach((v, k) => {
      resHeaders[k] = v;
    });
    return {
      text: String(content).trim(),
      usage: json.usage || {},
      _rawRequest: {
        url,
        method: "POST",
        headers: this.sanitizeHeaders(requestHeaders),
        body: requestBody
      },
      _rawResponse: {
        status: res.status,
        headers: resHeaders,
        body: json
      }
    };
  }

  async callClaude(model, prompt, systemPrompt, signal, params) {
    const baseUrl = (model.baseUrl || "https://api.anthropic.com/v1").replace(
      /\/+$/,
      ""
    );
    const url = `${baseUrl}/messages`;

    const requestBody = {
      model: model.model,
      max_tokens: 1024,
      ...params,
      system: systemPrompt || DEFAULT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }]
    };
    const requestHeaders = {
      "Content-Type": "application/json",
      "x-api-key": model.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    };

    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: requestHeaders,
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Claude error ${res.status}: ${text}`);
    }

    const json = await res.json();
    const contentArray = json.content || [];
    const firstText = contentArray.find((c) => c.type === "text");
    const content = firstText?.text || "";
    const resHeaders = {};
    res.headers.forEach((v, k) => (resHeaders[k] = v));
    return {
      text: String(content).trim(),
      usage: json.usage || {},
      _rawRequest: {
        url,
        method: "POST",
        headers: this.sanitizeHeaders(requestHeaders),
        body: requestBody
      },
      _rawResponse: {
        status: res.status,
        headers: resHeaders,
        body: json
      }
    };
  }

  async callOpenRouter(model, prompt, systemPrompt, signal, params) {
    const baseUrl = (model.baseUrl || "https://openrouter.ai/api/v1").replace(
      /\/+$/,
      ""
    );
    const url = `${baseUrl}/chat/completions`;

    const requestHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`
      // Optionally: 'HTTP-Referer' and 'X-Title' can be added here.
    };
    const requestBody = {
      model: model.model,
      ...params,
      messages: [
        {
          role: "system",
          content: systemPrompt || DEFAULT_SYSTEM_PROMPT
        },
        { role: "user", content: prompt }
      ]
    };

    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: requestHeaders,
      body: JSON.stringify(requestBody)
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
    const resHeaders = {};
    res.headers.forEach((v, k) => (resHeaders[k] = v));
    return {
      text: String(content).trim(),
      usage: json.usage || {},
      _rawRequest: {
        url,
        method: "POST",
        headers: this.sanitizeHeaders(requestHeaders),
        body: requestBody
      },
      _rawResponse: {
        status: res.status,
        headers: resHeaders,
        body: json
      }
    };
  }
}

new AiNotebookApp();
