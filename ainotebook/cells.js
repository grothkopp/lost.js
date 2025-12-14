import {
  applyTextareaHeight,
  parseJsonOutput,
  formatDuration,
  escapeHtml,
  genId
} from "./utils.js";
import { createModelPicker, createParamsUi } from "./ui.js";
import { DEFAULT_SYSTEM_PROMPT } from "./llm.js";

const OUTPUT_COLLAPSE_MAX_HEIGHT = 250;

export class CellManager {
  /**
   * Manages cell state and operations (add, remove, update, stale propagation).
   * @param {Object} app - The main AiNotebookApp instance.
   * @param {Object} lost - The LOST instance for state management.
   */
  constructor(app, lost) {
    this.app = app;
    this.lost = lost;
  }

  /**
   * Adds a new cell of the specified type to the end of the notebook.
   * @param {string} type - The type of cell to add (markdown, prompt, variable, code).
   */
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

  /**
   * Adds a new cell of the specified type at a specific index.
   * @param {string} type - The type of cell to add.
   * @param {number} index - The index to insert the cell at.
   */
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
          ? "// JavaScript code runs in a sandbox.\n// Template other cells with {{ <name> }}. Quote strings yourself, e.g. const notes = \"{{ <name> }}\";\n// Return a value or assign to `output`.\nreturn \"Hello \" + \`{{notes}}\`;"
          : `Explain {{md_${Math.max(1, insertIndex)} || notes}}`,
      systemPrompt: type === "prompt" ? DEFAULT_SYSTEM_PROMPT : "",
      params: "",
      _outputExpanded: false,
      modelId: "",
      lastOutput: "",
      error: "",
      _stale: false,
      autorun: true
    };
    cells.splice(insertIndex, 0, cell);
    this.lost.update(item.id, { cells });
  }

  /**
   * Updates cells using a transform function and handles side effects (staleness, autorun).
   * @param {Function} transformFn - Function that takes current cells and returns new cells.
   * @param {Object} options - Options for the update (changedIds, reason).
   */
  updateCells(transformFn, options = {}) {
    // Invalidate output cache for changed cells if output changed, forcing a re-render of the output content
    if (options.reason === "output" && options.changedIds && this.app.cellRenderer) {
      options.changedIds.forEach((id) => this.app.cellRenderer.outputCache.delete(id));
    }

    const item = this.lost.getCurrent();
    if (!item) return;
    const prevCells = Array.isArray(item.cells) ? [...item.cells] : [];
    const newCellsRaw = transformFn(prevCells.map((c) => ({ ...c }))) || [];
    const nextCells = Array.isArray(newCellsRaw) ? newCellsRaw : [];
    const finalCells = this.applyStaleness(prevCells, nextCells, options);

    // Auto-run stale code cells and refresh stale markdown cells
    finalCells.forEach(cell => {
      if ((cell.type === 'code' || cell.type === 'markdown') && cell._stale) {
        const refs = this.app.templateManager.parseReferencesFromText(cell.text);
        const hasStaleDep = refs.some(ref => {
          let depCell = finalCells.find(c => c.name === ref || c.id === ref);
          if (!depCell) {
            const m = ref.match(/^(?:#|out)(\d+)$/);
            if (m) {
              depCell = finalCells[parseInt(m[1], 10) - 1];
            }
          }
          return depCell && depCell._stale;
        });

        if (!hasStaleDep) {
          if (cell.type === 'code') {
            const isSelfEdit = options.changedIds && options.changedIds.includes(cell.id);
            if (cell.autorun !== false || !isSelfEdit) {
              this.app.codeCellManager.scheduleCodeRun(cell.id, 300);
            }
          } else {
            // Markdown: mark fresh immediately so it renders with new values
            cell._stale = false;
          }
        }
      }
    });

    this.lost.update(item.id, { cells: finalCells });
    this.app.cellRenderer.updateStaleStatus(finalCells);
  }

  /**
   * Calculates and applies staleness to cells based on dependency graph.
   * @param {Array} prevCells - The previous state of cells.
   * @param {Array} newCells - The new state of cells.
   * @param {Object} options - Update options (changedIds, reason).
   * @returns {Array} The cells with updated staleness flags.
   */
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

    const tm = this.app.templateManager;
    const refPrev = tm.buildReferenceIndex(prevList);
    const refNew = tm.buildReferenceIndex(next);

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
      if (reason === "ui") {
        // UI changes (e.g. collapse) do not affect staleness
        return;
      }
      if (reason === "output") {
        cell._stale = false;
        // Output updated: mark this cell as fresh, but propagate staleness to its dependents
        pushQueue(id, true);
      } else if (cell.type === "prompt" || cell.type === "code") {
        cell._stale = true;
        staleSeeds.add(cell.id);
        pushQueue(id, true); // Content dirty -> propagate staleness (dependents are stale until this runs)
      } else {
        // markdown/variable edits themselves are fresh (output=content), but their dependents should become stale
        pushQueue(id, true);
      }
    });

    // Persisted stale prompts (not refreshed this cycle) remain stale sources
    prevList.forEach((cell) => {
      if (
        cell._stale &&
        (cell.type === "prompt" || cell.type === "code") &&
        !(reason === "output" && changedIds.has(cell.id))
      ) {
        const cur = next.find((c) => c.id === cell.id);
        if (cur) {
          cur._stale = true;
          staleSeeds.add(cur.id);
          pushQueue(cur.id, true); // Propagate persistent staleness
        }
      }
    });

    const staleClosure = new Set(staleSeeds);

    // Propagate staleness
    while (queue.length) {
      const { id, causeStale } = queue.shift();
      if (!causeStale) continue;
      const keys = tm.collectCellKeys(prevList, next, id);
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
}

export class CellRenderer {
  /**
   * Handles the DOM rendering of notebook cells.
   * @param {Object} app - The main AiNotebookApp instance.
   */
  constructor(app) {
    this.app = app;
    this.templateHoverCache = new WeakMap();
    this.varTooltipEl = null;
    this.outputCache = new Map();
  }

  get container() {
    return this.app.cellsContainer;
  }

  /**
   * Renders all cells into the container.
   * Clears parsed outputs map before rendering.
   */
  render() {
    if (!this.container) return;
    const item = this.app.currentNotebook;
    const cells = Array.isArray(item.cells) ? item.cells : [];
    
    // Clear parsed outputs map before rendering fresh content
    this.app.parsedOutputs.clear();

    this.container.innerHTML = "";

    cells.forEach((cell, index) => {
      this.renderCell(cell, index, cells);
    });

    if (cells.length === 0) {
      this.renderAddRow(0);
    }
  }

  /**
   * Updates the visual status of cells (stale, running, error) without full re-render.
   * @param {Array} cells - The current list of cells.
   */
  updateStaleStatus(cells) {
    if (!this.container) return;
    cells.forEach((cell, index) => {
      const cellEl = this.container.querySelector(`article.cell[data-id="${cell.id}"]`);
      if (!cellEl) return;

      if (cell._stale) {
        cellEl.classList.add("stale");
      } else {
        cellEl.classList.remove("stale");
      }

      const statusSpan = cellEl.querySelector(".cell-status");
      if (statusSpan) {
        statusSpan.className = "cell-status";
        statusSpan.textContent = "";
        
        const promptRunning = this.app.promptCellManager.runningCells.has(cell.id);
        const codeRunning = this.app.codeCellManager.isRunning(cell.id);
        
        if (promptRunning) {
          statusSpan.classList.add("running");
          statusSpan.textContent = "Running…";
          const timerSpan = document.createElement("span");
          timerSpan.className = "running-timer";
          const startedAt = this.app.promptCellManager.runningStartTimes.get(cell.id);
          timerSpan.textContent = formatDuration(startedAt ? Date.now() - startedAt : 0);
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
        }
      }
      
      // Update output stale class and content
      const output = cellEl.querySelector(".cell-output");
      if (output) {
        if (cell._stale) {
          output.classList.add("stale");
        } else {
          output.classList.remove("stale");
        }

        // Check if content needs update
        let outputText =
          cell.type === "prompt"
            ? cell.lastOutput || ""
            : cell.type === "variable"
            ? cell.text || ""
            : cell.type === "code"
            ? cell.lastOutput || ""
            : cell.text || "";
            
        let contentToCompare = outputText;
        if (cell.type === "markdown") {
             contentToCompare = this.app.templateManager.expandTemplate(cell.text || "", cells);
        }
        
        const cached = this.outputCache.get(cell.id);
        // Only update if content changed AND we are not currently editing this specific cell's output (which we can't really do anyway)
        // Also don't update if running? No, we might want streaming updates later, but for now safe to update if changed.
        if (cached !== contentToCompare) {
             this.updateCellOutput(cell, output, index, cells);
        }
      }

      // Update code meta/error inline without full re-render (important when we skip render during editing)
      if (cell.type === "code") {
        let meta = cellEl.querySelector(".cell-run-meta");
        const info = cell.lastRunInfo || {};
        if (cell.error) {
          if (!meta) {
            meta = document.createElement("div");
            meta.className = "cell-run-meta cell-run-meta-error";
            cellEl.querySelector(".cell-body")?.appendChild(meta);
          }
          meta.className = "cell-run-meta cell-run-meta-error";
          meta.textContent = `Error: ${cell.error}`;
        } else if (info && (info.durationMs != null || info.status)) {
          if (!meta) {
            meta = document.createElement("div");
            meta.className = "cell-run-meta";
            cellEl.querySelector(".cell-body")?.appendChild(meta);
          }
          meta.className = "cell-run-meta";
          const parts = [];
          if (info.status) parts.push(info.status === "ok" ? "Ran" : info.status);
          if (info.durationMs != null) parts.push(`time: ${formatDuration(info.durationMs)}`);
          meta.textContent = parts.join(" · ");
        } else if (meta) {
          meta.remove();
        }
      }

      // Update run button state if exists
      const runBtn = cellEl.querySelector(".run-btn");
      if (runBtn) {
        const isStale = !!cell._stale || !cell.lastOutput;
        const promptRunning = this.app.promptCellManager.runningCells.has(cell.id);
        const codeRunning = this.app.codeCellManager.isRunning(cell.id);
        const isRunning = promptRunning || codeRunning;
        
        runBtn.disabled = isRunning;
        runBtn.classList.toggle("is-stale", isStale && !isRunning);
        runBtn.classList.toggle("is-running", isRunning);
      }
    });
  }

  /**
   * Renders a single cell.
   * @param {Object} cell - The cell object.
   * @param {number} index - The cell index.
   * @param {Array} cells - All cells (for context).
   */
  renderCell(cell, index, cells) {
    const root = document.createElement("article");
    const typeClass = cell.type ? `type-${cell.type}` : "type-markdown";
    root.className = `cell ${typeClass}`;
    if (cell.collapsed) {
      root.classList.add("collapsed");
    }
    if (cell._stale) {
      root.classList.add("stale");
    }
    root.dataset.id = cell.id;
    const baseRef = this.app.getPreferredRef(cell, index);

    // Header
    const header = this.renderHeader(cell, index, typeClass);
    root.appendChild(header);

    // Body
    const body = this.renderBody(cell, index, cells, baseRef);
    root.appendChild(body);

    // Running state classes
    const promptRunning = this.app.promptCellManager.runningCells.has(cell.id);
    const codeRunning = this.app.codeCellManager.isRunning(cell.id);
    const isRunning = promptRunning || codeRunning;
    if (isRunning) {
      root.classList.add("is-running");
    }

    this.container.appendChild(root);

    // Add inline add-buttons below cell
    this.renderAddRow(index);

    // Initialize textareas
    const systemTextarea = body.querySelector(".cell-system-textarea");
    const textarea = body.querySelector(".cell-user-textarea");
    if (systemTextarea) this.applyHeight(systemTextarea, "collapsed");
    if (textarea) this.applyHeight(textarea, "collapsed");
  }

  /**
   * Renders the header of a cell (title, type, actions).
   * @param {Object} cell - The cell object.
   * @param {number} index - The cell index.
   * @param {string} typeClass - CSS class for cell type.
   * @returns {HTMLElement} The header element.
   */
  renderHeader(cell, index, typeClass) {
    const header = document.createElement("header");
    header.className = "cell-header";

    const idxSpan = document.createElement("span");
    idxSpan.className = "cell-index";
    idxSpan.textContent = `#${index + 1}`;
    header.appendChild(idxSpan);

    // Type Pill
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

    // Type Dropdown
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
          this.app.cellManager.updateCells(
            (cells) => {
              return cells.map((c) =>
                c.id === cell.id
                  ? {
                      ...c,
                      type: opt.value,
                      error: ""
                    }
                  : c
              );
            },
            { changedIds: [cell.id] }
          );
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

    // LLM Picker for prompt cells
    if (cell.type === "prompt") {
      const searchTerm = this.app.cellModelSearch.get(cell.id) || "";
      const picker = createModelPicker(
        {
          selectedId: cell.modelId || "",
          searchTerm,
          placeholder: "Search models",
          defaultLabel: "Use notebook default",
          defaultValue: "",
          onSearchChange: (term) => {
            this.app.cellModelSearch.set(cell.id, term);
          },
          onSelect: (id) => {
            this.app.cellManager.updateCells(
              (cells) =>
                cells.map((c) =>
                  c.id === cell.id ? { ...c, modelId: id } : c
                ),
              { changedIds: [cell.id] }
            );
          }
        },
        this.app.llmManager
      );
      header.appendChild(picker);

      const paramsUi = createParamsUi(cell.params || "", (val) => {
        this.app.cellManager.updateCells(
          (cells) =>
            cells.map((c) => (c.id === cell.id ? { ...c, params: val } : c)),
          { changedIds: [cell.id] }
        );
      });
      header.appendChild(paramsUi);
    }

    // Status
    const statusSpan = document.createElement("span");
    statusSpan.className = "cell-status";
    const promptRunning = this.app.promptCellManager.runningCells.has(cell.id);
    const codeRunning = this.app.codeCellManager.isRunning(cell.id);
    if (promptRunning) {
      statusSpan.classList.add("running");
      statusSpan.textContent = "Running…";
      const timerSpan = document.createElement("span");
      timerSpan.className = "running-timer";
      const startedAt = this.app.promptCellManager.runningStartTimes.get(cell.id);
      timerSpan.textContent = formatDuration(
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
    } else if (
      cell.lastOutput &&
      (cell.type === "prompt" || cell.type === "code")
    ) {
      statusSpan.textContent = "Done";
    }
    header.appendChild(statusSpan);

    // Actions
    const actions = document.createElement("div");
    actions.className = "cell-actions";

    if (cell.type === "prompt" || cell.type === "code") {
      if (cell.type === "code") {
        const autorunLabel = document.createElement("label");
        autorunLabel.className = "cell-autorun-label";
        const autorunCheck = document.createElement("input");
        autorunCheck.type = "checkbox";
        autorunCheck.checked = cell.autorun !== false; // default true
        autorunCheck.addEventListener("change", (e) => {
          this.app.cellManager.updateCells(
            (cells) =>
              cells.map((c) => (c.id === cell.id ? { ...c, autorun: e.target.checked } : c)),
            { changedIds: [] }
          );
        });
        autorunLabel.appendChild(autorunCheck);
        autorunLabel.appendChild(document.createTextNode(" autorun"));
        actions.appendChild(autorunLabel);
      }

      const runBtn = document.createElement("button");
      runBtn.type = "button";
      runBtn.className = "cell-action-btn run-btn";
      runBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" /></svg>';
      const isStale = !!cell._stale || !cell.lastOutput;
      const isRunning = promptRunning || codeRunning;
      runBtn.disabled = isRunning;
      runBtn.classList.toggle("is-stale", isStale && !isRunning);
      runBtn.classList.toggle("is-running", isRunning);
      actions.appendChild(runBtn);

      const stopBtn = document.createElement("button");
      stopBtn.type = "button";
      stopBtn.className = "cell-action-btn stop-btn";
      stopBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M17 4h-10a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3 -3v-10a3 3 0 0 0 -3 -3z" /></svg>';
      stopBtn.disabled = !isRunning;
      stopBtn.classList.toggle("is-running", isRunning);
      actions.appendChild(stopBtn);

      runBtn.addEventListener("click", () => {
        if (cell.type === "prompt") {
          this.app.promptCellManager.runPromptCell(cell.id);
        } else {
          this.app.codeCellManager.runCodeCell(cell.id);
        }
      });
      stopBtn.addEventListener("click", () => {
        if (cell.type === "prompt") {
          this.app.promptCellManager.stopCell(cell.id);
        } else {
          this.app.codeCellManager.stopCode(cell.id);
        }
      });
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

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "icon-btn toggle-btn";
    const isCollapsed = !!cell.collapsed;
    toggleBtn.title = isCollapsed ? "Expand cell" : "Collapse cell";
    toggleBtn.innerHTML = isCollapsed
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
    actions.appendChild(toggleBtn);

    header.appendChild(actions);

    // Listeners
    nameInput.addEventListener("input", (e) => {
      const val = e.target.value;
      if (val.trim().toUpperCase() === "ENV") {
        e.target.setCustomValidity("Cell name cannot be 'ENV'");
        e.target.reportValidity();
        return;
      }
      e.target.setCustomValidity("");
      
      this.app.cellManager.updateCells(
        (cells) => {
          const next = cells.map((c) =>
            c.id === cell.id ? { ...c, name: val } : c
          );
          return next;
        },
        { changedIds: [cell.id] }
      );
    });
    nameInput.addEventListener("focus", () => {
      this.app.lastFocusedEditor = nameInput;
    });

    upBtn.addEventListener("click", () => {
      this.app.cellManager.updateCells((cells) => {
        const idx = cells.findIndex((c) => c.id === cell.id);
        if (idx <= 0) return cells;
        const next = [...cells];
        const [removed] = next.splice(idx, 1);
        next.splice(idx - 1, 0, removed);
        return next;
      });
    });

    downBtn.addEventListener("click", () => {
      this.app.cellManager.updateCells((cells) => {
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
      this.app.cellManager.updateCells((cells) => cells.filter((c) => c.id !== cell.id));
    });

    toggleBtn.addEventListener("click", () => {
      this.app.cellManager.updateCells(
        (cells) =>
          cells.map((c) =>
            c.id === cell.id ? { ...c, collapsed: !c.collapsed } : c
          ),
        { changedIds: [cell.id], reason: "ui" }
      );
    });

    return header;
  }

  /**
   * Renders the body of a cell (inputs, outputs).
   * @param {Object} cell - The cell object.
   * @param {number} index - The cell index.
   * @param {Array} cells - All cells.
   * @param {string} baseRef - The reference name for this cell.
   * @returns {HTMLElement} The body element.
   */
  renderBody(cell, index, cells, baseRef) {
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
      help.textContent = "Markdown text (rendered as plain text for now).";
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

    // Output
    const output = document.createElement("div");
    output.className = "cell-output";
    this.updateCellOutput(cell, output, index, cells);
    
    if (cell._stale) {
      output.classList.add("stale");
    }
    
    // Metadata
    if (cell.type === "prompt" && cell.lastRunInfo) {
      const meta = document.createElement("div");
      meta.className = "cell-run-meta";
      const info = cell.lastRunInfo || {};
      const parts = [];
      if (info.tokensIn != null) parts.push(`tokens in: ${info.tokensIn}`);
      if (info.tokensOut != null) parts.push(`tokens out: ${info.tokensOut}`);
      if (info.durationMs != null)
        parts.push(`time: ${formatDuration(info.durationMs)}`);
      if (info.model) parts.push(`model: ${info.model}`);
      if (info.params && Object.keys(info.params).length > 0) {
        const p = Object.entries(info.params)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ");
        parts.push(p);
      }
      meta.textContent = parts.join(" · ");
      meta.title = "Click to view request/response log";
      meta.addEventListener("click", () => this.app.showLogOverlay(info));
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
          parts.push(`time: ${formatDuration(info.durationMs)}`);
        meta.textContent = parts.join(" · ");
        body.appendChild(meta);
      }
    }

    output.addEventListener("click", (e) => {
      const target = e.target.closest(".ref-click");
      if (target?.dataset?.ref) {
        e.preventDefault();
        e.stopPropagation();
        this.insertReference(target.dataset.ref, { ensureVisible: true });
        return;
      }
      if (cell.type === "prompt" && !output.classList.contains("cell-output-json")) {
        e.preventDefault();
        e.stopPropagation();
        this.insertReference(`{{ ${baseRef} }}`, { ensureVisible: true });
      }
    });
    body.appendChild(output);

    // Textarea listeners
    if (systemTextarea) {
      systemTextarea.addEventListener("input", (e) => {
        const systemPrompt = e.target.value;
        this.app.pendingFocusState = {
          cellId: cell.id,
          role: "system-textarea",
          selection:
            typeof systemTextarea.selectionStart === "number"
              ? {
                  start: systemTextarea.selectionStart,
                  end: systemTextarea.selectionEnd
                }
              : null
        };
        this.templateHoverCache.delete(systemTextarea);
        this.applyHeight(systemTextarea);
        this.app.cellManager.updateCells(
          (cells) =>
            cells.map((c) =>
              c.id === cell.id ? { ...c, systemPrompt, error: "" } : c
            ),
          { changedIds: [cell.id] }
        );
      });
      systemTextarea.addEventListener("focus", () => {
        this.app.lastFocusedEditor = systemTextarea;
        this.applyHeight(systemTextarea, "expanded");
      });
      systemTextarea.addEventListener("blur", () => {
        this.applyHeight(systemTextarea, "collapsed");
      });
      const handleSystemHover = (e) => this.handleTextareaHover(e, cells);
      systemTextarea.addEventListener("mousemove", handleSystemHover);
      systemTextarea.addEventListener("mouseleave", () =>
        this.hideVariableTooltip()
      );
    }

    textarea.addEventListener("input", (e) => {
      const text = e.target.value;
      this.app.pendingFocusState = {
        cellId: cell.id,
        role: "textarea",
        selection:
          typeof textarea.selectionStart === "number"
            ? {
                start: textarea.selectionStart,
                end: textarea.selectionEnd
              }
            : null
      };
      this.templateHoverCache.delete(textarea);
      this.applyHeight(textarea);
      this.app.cellManager.updateCells(
        (cells) =>
          cells.map((c) => (c.id === cell.id ? { ...c, text, error: "" } : c)),
        { changedIds: [cell.id] }
      );
    });
    textarea.addEventListener("focus", () => {
      this.app.lastFocusedEditor = textarea;
      this.applyHeight(textarea, "expanded");
    });
    textarea.addEventListener("blur", () => {
      this.applyHeight(textarea, "collapsed");
    });
    const handleHoverMove = (e) => this.handleTextareaHover(e, cells);
    textarea.addEventListener("mousemove", handleHoverMove);
    textarea.addEventListener("mouseleave", () =>
      this.hideVariableTooltip()
    );

    return body;
  }

  /**
   * Updates the cell output DOM element.
   * @param {Object} cell - The cell object.
   * @param {HTMLElement} output - The output container.
   * @param {number} index - The cell index.
   * @param {Array} cells - All cells.
   */
  updateCellOutput(cell, output, index, cells) {
    const baseRef = this.app.getPreferredRef(cell, index);
    let outputText =
      cell.type === "prompt"
        ? cell.lastOutput || ""
        : cell.type === "variable"
        ? cell.text || ""
        : cell.type === "code"
        ? cell.lastOutput || ""
        : cell.text || "";

    output.innerHTML = "";
    output.className = "cell-output";

    const parsed =
      cell.type === "prompt" || cell.type === "variable" || cell.type === "code"
        ? parseJsonOutput(outputText)
        : { isJson: false, value: outputText };

    if (!outputText) {
      output.classList.add("cell-output-empty");
      output.textContent =
        cell.type === "prompt"
          ? "No output yet. Run this cell."
          : "Empty.";
    } else if (cell.type === "markdown") {
      output.classList.add("cell-output-markdown");
      const expanded = this.app.templateManager.expandTemplate(cell.text || "", cells);
      output.innerHTML = this.app.md.render(expanded);
      // Cache expanded content for comparison
      this.outputCache.set(cell.id, expanded);
    } else if (parsed.isJson) {
      output.classList.add("cell-output-json");
      this.app.storeParsedOutputKeys(cell, index, parsed.value);
      output.innerHTML = this.renderJsonInteractive(parsed.value, baseRef);
      this.outputCache.set(cell.id, outputText);
    } else {
      output.textContent = outputText;
      this.outputCache.set(cell.id, outputText);
    }

    // Actions container
    const actions = document.createElement("div");
    actions.className = "output-actions";

    // Copy Button
    let contentToCopy = outputText;
    if (cell.type === "markdown") {
      contentToCopy = this.outputCache.get(cell.id) || "";
    } else if (parsed.isJson) {
      try {
        contentToCopy = JSON.stringify(parsed.value, null, 2);
      } catch (e) {}
    }

    if (contentToCopy) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "output-action-btn";
      copyBtn.title = "Copy output";
      copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      copyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(contentToCopy).then(() => {
          const original = copyBtn.innerHTML;
          copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          setTimeout(() => {
             copyBtn.innerHTML = original;
          }, 1500);
        }).catch(err => console.error('Failed to copy', err));
      });
      actions.appendChild(copyBtn);
    }

    if (
      cell.type === "markdown" ||
      cell.type === "variable" ||
      ( cell.type === "code" && !parsed.isJson) ||
      (cell.type === "prompt" && !parsed.isJson)
    ) {
      const insertBtn = document.createElement("button");
      insertBtn.type = "button";
      insertBtn.className = "output-action-btn";
      insertBtn.textContent = "{ }";
      insertBtn.title = `Insert reference {{ ${baseRef} }}`;
      insertBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.insertReference(`{{ ${baseRef} }}`, { ensureVisible: true });
      });
      actions.appendChild(insertBtn);
    }

    if (actions.children.length > 0) {
      output.appendChild(actions);
    }

    this.setupCollapseUi(cell, output);
  }

  setupCollapseUi(cell, output) {
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "output-expand-btn";
    const expandedFlag = !!(cell._outputExpanded ?? cell.outputExpanded);
    toggleBtn.textContent = expandedFlag ? "⇱" : "⇲";
    toggleBtn.title = expandedFlag ? "Collapse output" : "Expand output";
    toggleBtn.style.display = "none";

    toggleBtn.addEventListener("click", () => {
      const expanded = !!(cell._outputExpanded ?? cell.outputExpanded);
      this.app.cellManager.updateCells(
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
        output.scrollHeight > OUTPUT_COLLAPSE_MAX_HEIGHT + 4;
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

  /**
   * Renders the row of add buttons (Markdown, Prompt, etc.) after a cell.
   * @param {number} index - The index to insert at.
   */
  renderAddRow(index) {
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
        this.app.cellManager.addCellAt(t.type, index);
      });
      addPillContainer.appendChild(pill);
    });
    addRow.appendChild(addLabel);
    addRow.appendChild(addPillContainer);
    this.container.appendChild(addRow);
  }

  applyHeight(textarea, mode = null) {
    applyTextareaHeight(textarea, mode);
  }

  renderJsonInteractive(value, baseRef, path = [], depth = 0) {
    const pad = "  ".repeat(depth);
    const refExpr = this.app.buildRefExpression(baseRef, path);

    const renderPrimitive = (val) => {
      if (val === null) return `<span class="json-null">null</span>`;
      if (typeof val === "string")
        return `<span class="json-string">"${escapeHtml(val)}"</span>`;
      if (typeof val === "number")
        return `<span class="json-number">${val}</span>`;
      if (typeof val === "boolean")
        return `<span class="json-boolean">${val}</span>`;
      return `<span>${escapeHtml(String(val))}</span>`;
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
            `${pad}  <span class="json-key ref-click" data-ref="{{ ${this.app.buildRefExpression(
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
        const keyRef = this.app.buildRefExpression(baseRef, nextPath);
        return `${pad}  "<span class="json-key ref-click" data-ref="{{ ${keyRef} }}">${escapeHtml(
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

  // --- Tooltips & References ---

  handleTextareaHover(e, cells) {
    const textarea = e.currentTarget;
    const value = textarea.value || "";
    const hoverData = this.getTextareaHoverMirror(textarea, value);
    const { spans, mirror } = hoverData;
    if (!spans.length) {
      this.hideVariableTooltip();
      return;
    }

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
    const valueResolved = this.app.templateManager.resolveTemplateValue(expr, cells);
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

  /**
   * Builds HTML for the mirrored overlay used in hover detection.
   * @param {string} text - The textarea content.
   * @returns {string} HTML string with spans for template refs.
   */
  buildTextareaHoverHtml(text) {
    if (!text) return "";
    const parts = [];
    let lastIndex = 0;
    const regex = /\{\{\s*([^}]+?)\s*\}\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index);
      if (before)
        parts.push(escapeHtml(before).replace(/\n/g, "<br>"));
      const expr = match[1].trim();
      const escapedExpr = escapeHtml(expr);
      const display = escapeHtml(match[0]).replace(/\n/g, "<br>");
      parts.push(
        `<span class="template-ref" data-expr="${escapedExpr}">${display}</span>`
      );
      lastIndex = regex.lastIndex;
    }
    const rest = text.slice(lastIndex);
    if (rest) parts.push(escapeHtml(rest).replace(/\n/g, "<br>"));
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

  /**
   * Inserts a reference string into the last focused editor or active element.
   * @param {string} ref - The reference string to insert.
   * @param {Object} opts - Options (ensureVisible).
   */
  insertReference(ref, opts = {}) {
    const { ensureVisible = false } = opts;
    const target =
      this.app.lastFocusedEditor && document.body.contains(this.app.lastFocusedEditor)
        ? this.app.lastFocusedEditor
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
}
