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
        "Respond with a JSON Array like [\"point 1\", \"point 2\", \"point 3\"].",
      systemPrompt: "{{ var_systemprompt }}",
      params: "",
      _outputExpanded: false,
      modelId: "",
      lastOutput: "",
      error: "",
      _stale: false
    },
    {
      id: "cell_format",
      type: "code",
      name: "formatted",
      text: "const items = {{summary}};\nreturn items.map(i => \"- \" + i).join(\"\\n\");",
      modelId: "",
      lastOutput: "",
      error: "",
      _stale: false,
      autorun: true
    }
  ]
};

class AiNotebookApp {
  /**
   * Initializes the AI Notebook application.
   * Sets up LOST framework, managers, UI components, and event listeners.
   */
  constructor() {
    // ---------- LOST core ----------
    this.lost = new Lost({
      storageKey: STORAGE_KEY,
      defaultData: DEFAULT_NOTEBOOK,
      validator: (data) => this.validateNotebook(data),
      fileExtension: 'ainb',
      downloadFormat: 'json',
      download: 'yes'
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
    
    // Flag to track if the update originates from the local user interaction
    // to prevent forced re-renders that would interrupt editing.
    this.isLocalUpdate = false;

    // Listen for settings updates
    window.addEventListener("llm-settings-updated", () => this.renderNotebook());
    window.addEventListener("llm-models-updated", () => this.renderNotebook());

    this.init();
  }

  /**
   * Initializes DOM elements and binds events.
   * Loads initial data from LOST.
   */
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

  /**
   * Sets up contenteditable behavior for the notebook title in the header.
   */
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
        this.isLocalUpdate = true;
        this.lost.update(item.id, { title: text });
        this.isLocalUpdate = false;
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

  /**
   * Binds global event listeners for toolbar and other app-wide actions.
   */
  bindEvents() {
    // Toolbar
    if (this.notebookModelSelect) {
      this.notebookModelSelect.addEventListener("change", (e) => {
        const item = this.lost.getCurrent();
        if (!item) return;
        this.isLocalUpdate = true;
        this.lost.update(item.id, { notebookModelId: e.target.value });
        this.isLocalUpdate = false;
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

  /**
   * Validates the notebook data structure.
   * @param {Object} data - The notebook data to validate.
   * @returns {boolean} True if valid.
   */
  validateNotebook(data) {
    if (!data || typeof data !== "object") return false;
    if (!Array.isArray(data.cells)) return false;
    return true;
  }

  /**
   * Handles notebook updates from LOST.
   * Normalizes legacy fields and triggers rendering.
   * @param {Object} item - The updated notebook object.
   */
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
    // Only force render if it's not a local update (e.g. import, load)
    this.renderNotebook({ force: !this.isLocalUpdate });
  }

  // ---------- Notebook operations ----------

  /**
   * Creates a new notebook with default structure.
   */
  createNotebook() {
    this.lost.create({
      ...DEFAULT_NOTEBOOK,
      title: "New Notebook"
    });
  }

  // ---------- Helpers ----------

  /**
   * Gets the preferred reference name for a cell.
   * @param {Object} cell - The cell object.
   * @param {number} index - The cell index (0-based).
   * @returns {string} The reference name (e.g., "my_cell" or "out1").
   */
  getPreferredRef(cell, index) {
    const name = (cell?.name || "").trim();
    if (name) return name;
    return `out${index + 1}`;
  }

  /**
   * Builds a reference expression string.
   * @param {string} base - The base reference name.
   * @param {Array} path - The property path.
   * @returns {string} The constructed expression (e.g. "base['key']").
   */
  buildRefExpression(base, path = []) {
    const parts =
      Array.isArray(path) && path.length
        ? path.map((p) => (String(p).match(/^[0-9]+$/) ? `[${p}]` : `['${p}']`))
        : [];
    return `${base}${parts.join("")}`;
  }

  /**
   * Stores parsed output keys in the template manager's map.
   * @param {Object} cell - The cell object.
   * @param {number} index - The cell index.
   * @param {any} value - The parsed value.
   */
  storeParsedOutputKeys(cell, index, value) {
    const keys = this.templateManager.getCellKeys(cell, index);
    keys.forEach((k) => this.parsedOutputs.set(k, value));
  }

  // ---------- Rendering ----------

  /**
   * Renders the entire notebook UI.
   * Handles partial updates and focus preservation.
   * @param {Object} [options] - Render options.
   * @param {boolean} [options.force] - If true, forces a full render even if an input is focused.
   */
  renderNotebook(options = {}) {
    const item = this.currentNotebook;
    if (!item) return;

    // Skip render if we are editing a text field to prevent focus loss (unless forced)
    const active = document.activeElement;
    if (
      !options.force &&
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

    // Save scroll position
    const scrollY = window.scrollY;

    // parsedOutputs is cleared in CellRenderer.render()

    // Toolbar actions state
    const anyRunning = this.promptCellManager.runningCells.size > 0 || 
                       (this.codeCellManager._codeRunning ? this.codeCellManager._codeRunning.size : 0) > 0;
    
    const runAllInFlight = this.promptCellManager.runAllInFlight;
    
    if (this.runAllBtn) {
       this.runAllBtn.disabled = runAllInFlight || anyRunning;
       this.runAllBtn.classList.toggle("is-running", runAllInFlight);
    }
    if (this.stopAllBtn) {
       this.stopAllBtn.disabled = !anyRunning;
       this.stopAllBtn.classList.toggle("is-running", anyRunning);
    }

    // Toolbar
    this.renderNotebookModelSelect();
    this.cellRenderer.render();
    if (this.uiShell?.setTitle) {
      this.uiShell.setTitle(item.title || "Untitled notebook");
    }

    // Restore scroll position
    if (scrollY > 0) {
      window.scrollTo(0, scrollY);
    }
  }

  /**
   * Renders the global notebook model selector in the toolbar.
   */
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
          this.isLocalUpdate = true;
          this.lost.update(item.id, { notebookModelId: id });
          this.isLocalUpdate = false;
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
        this.isLocalUpdate = true;
        this.lost.update(item.id, { notebookParams: val });
        this.isLocalUpdate = false;
      }
    );
    row.appendChild(paramsUi);

    container.appendChild(row);
  }

  /**
   * Shows the log overlay with the given log data.
   * @param {Object} log - The log data to display.
   */
  showLogOverlay(log) {
    this.logOverlay.show(log);
  }
}

new AiNotebookApp();
