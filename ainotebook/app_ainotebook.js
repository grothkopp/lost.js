import { Lost } from "/lost.js";
import { LostUI } from "/lost-ui.js";
import MarkdownIt from "https://esm.sh/markdown-it@13.0.1";

import { LlmManager, DEFAULT_SYSTEM_PROMPT } from "./llm.js";
import { SettingsDialog } from "./settings.js";
import { CellRenderer, CellManager } from "./cells.js";
import { createModelPicker, createParamsUi, LogOverlay } from "./ui.js";
import { TemplateManager } from "./template.js";
import { CodeCellManager } from "./cell_code.js";
import { PromptCellManager } from "./cell_prompt.js";

const STORAGE_KEY = "app-ainotebook-v1";

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

    // ---------- Components ----------
    this.llmManager = new LlmManager();
    this.settingsDialog = new SettingsDialog(this.llmManager);
    
    // Core Managers
    this.parsedOutputs = new Map(); // key -> parsed JSON value
    this.templateManager = new TemplateManager(
      () => this.parsedOutputs,
      () => this.llmManager.settings.env
    );
    
    this.cellManager = new CellManager(this, this.lost);
    this.codeCellManager = new CodeCellManager(this, (fn, opts) => this.cellManager.updateCells(fn, opts));
    this.promptCellManager = new PromptCellManager(this, (fn, opts) => this.cellManager.updateCells(fn, opts));
    
    this.cellRenderer = new CellRenderer(this);
    this.logOverlay = new LogOverlay();

    // ---------- DOM references ----------
    this.stageEl = null;
    this.cellsContainer = null;
    this.notebookModelSelect = null;
    this.notebookModelSearch = null;
    this.notebookModelLabel = null;
    this.runAllBtn = null;
    this.stopAllBtn = null;

    // ---------- runtime state ----------
    this.currentNotebook = null;
    this.lastFocusedEditor = null;
    this.md = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: true
    });
    this.modelSearchTermNotebook = "";
    this.cellModelSearch = new Map(); // cellId -> search term

    // Listen for settings updates
    window.addEventListener("llm-settings-updated", () => this.renderNotebook());
    window.addEventListener("llm-models-updated", () => this.renderNotebook());

    this.init();
  }

  // ---------- Initialization ----------

  async init() {
    this.stageEl = document.getElementById("app-stage");
    this.cellsContainer = document.getElementById("cells-container");

    this.notebookModelSelect = document.getElementById("notebookModelSelect");
    this.notebookModelSearch = document.getElementById("notebookModelSearch");
    this.notebookModelLabel =
      this.notebookModelSelect?.closest(".notebook-toolbar-label") || null;
    if (this.notebookModelSelect) this.notebookModelSelect.style.display = "none";
    if (this.notebookModelSearch) this.notebookModelSearch.style.display = "none";

    this.runAllBtn = document.getElementById("runAllBtn");
    this.stopAllBtn = document.getElementById("stopAllBtn");

    this.bindEvents();

    this.lost.load();
    // Initialize UI shell
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
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37a1.724 1.724 0 0 0 2.572 -1.065"></path><path d="M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0 -6"></path></svg>';
          btn.addEventListener("click", () => this.settingsDialog.show());
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
    this.uiShell.load();
    this.setupHeaderTitleEditing();
    this.onNotebookUpdate(this.lost.getCurrent());
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

  bindEvents() {
    // Toolbar
    if (this.notebookModelSelect) {
      this.notebookModelSelect.addEventListener("change", (e) => {
        const item = this.lost.getCurrent();
        if (!item) return;
        this.lost.update(item.id, { notebookModelId: e.target.value });
      });
    }

    this.runAllBtn?.addEventListener("click", () => this.promptCellManager.runAllCells());
    this.stopAllBtn?.addEventListener("click", () => {
      this.promptCellManager.stopAllCells();
      this.codeCellManager.stopAll();
      this.renderNotebook();
    });

    // Settings dialog listeners are in SettingsDialog class
    // But we need to update search term for notebook model select
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

  // ---------- Notebook operations ----------

  createNotebook() {
    this.lost.create({
      ...DEFAULT_NOTEBOOK,
      title: "New Notebook"
    });
  }

  // Cell ops now delegated to this.cellManager
  // but for compatibility if UI shell calls them directly, we can proxy or assume UI uses cellManager directly?
  // Actually UI shell mostly uses onNew which calls createNotebook.
  // The 'addCell' buttons are handled by CellRenderer which uses cellManager now.

  // ---------- Helpers ----------

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
    const keys = this.templateManager.getCellKeys(cell, index);
    keys.forEach((k) => this.parsedOutputs.set(k, value));
  }

  // ---------- Rendering ----------

  renderNotebook() {
    const item = this.currentNotebook;
    if (!item) return;

    // Skip render if we are editing a text field to prevent focus loss
    const active = document.activeElement;
    if (
      active &&
      (active.classList.contains("cell-user-textarea") ||
        active.classList.contains("cell-system-textarea") ||
        active.classList.contains("cell-name-input") ||
        active.classList.contains("model-params-textarea") ||
        active.dataset.editing === "true")
    ) {
      // Even if we skip a full re-render to preserve focus, still update statuses/outputs.
      this.cellRenderer.updateStaleStatus(item.cells || []);
      return;
    }

    // parsedOutputs is cleared in CellRenderer.render()

    // Toolbar actions state
    const anyRunning = this.promptCellManager.runningCells.size > 0 || this.codeCellManager.isRunning(null); // Fix: codeCellManager.isRunning takes id, but here we want to know if *any* is running. 
    // codeCellManager doesn't expose a 'size' or 'any' check. I should add it.
    // For now I'll check private property since I'm in same app space, or access ._codeRunning if exported (it's not exported by default from class instance unless I access it).
    // Wait, I can't access ._codeRunning easily if I didn't expose getter.
    // I should fix CodeCellManager to expose isAnyRunning or expose size.
    // Let's assume I fix it. For now let's use the codeCellManager._codeRunning directly if possible or assume I need to fix it.
    // CodeCellManager export uses private fields? No, just this._codeRunning = new Set().
    
    // I need to update CodeCellManager to expose size or something.
    // I'll check CodeCellManager content I wrote.
    // I wrote: this._codeRunning = new Set();
    // So I can access it via app.codeCellManager._codeRunning.size
    
    const codeRunningCount = this.codeCellManager._codeRunning ? this.codeCellManager._codeRunning.size : 0;
    const anyRunningEffective = this.promptCellManager.runningCells.size > 0 || codeRunningCount > 0;
    const runAllInFlight = this.promptCellManager.runAllInFlight;
    
    if (this.runAllBtn) {
       this.runAllBtn.disabled = runAllInFlight || anyRunningEffective;
       this.runAllBtn.classList.toggle("is-running", runAllInFlight);
    }
    if (this.stopAllBtn) {
       this.stopAllBtn.disabled = !anyRunningEffective;
       this.stopAllBtn.classList.toggle("is-running", anyRunningEffective);
    }

    // Toolbar
    this.renderNotebookModelSelect();
    this.cellRenderer.render();
    if (this.uiShell?.setTitle) {
      this.uiShell.setTitle(item.title || "Untitled notebook");
    }
  }

  renderNotebookModelSelect() {
    const container = this.notebookModelLabel;
    if (!container) return;
    container.innerHTML = "";

    const labelSpan = document.createElement("span");
    labelSpan.textContent = "Default LLM: ";
    labelSpan.className = "notebook-model-heading";
    container.appendChild(labelSpan);

    const row = document.createElement("div");
    row.className = "model-picker-row";

    const picker = createModelPicker(
      {
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
      },
      this.llmManager
    );
    row.appendChild(picker);

    const paramsUi = createParamsUi(
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

  showLogOverlay(log) {
    this.logOverlay.show(log);
  }
}

new AiNotebookApp();
