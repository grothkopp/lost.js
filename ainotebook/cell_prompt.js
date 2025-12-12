import { DEFAULT_SYSTEM_PROMPT } from "./llm.js";
import { formatDuration, cleanJsonMarkdown } from "./utils.js";

export class PromptCellManager {
  /**
   * Manages execution of prompt (LLM) cells.
   * Handles running, stopping, parameter parsing, and timing.
   * @param {Object} app - The main AiNotebookApp instance.
   * @param {Function} updateCells - Callback to update cell state.
   */
  constructor(app, updateCells) {
    this.app = app;
    this.updateCells = updateCells;
    this.runningControllers = new Map(); // cellId -> AbortController
    this.runningCells = new Set(); // cellId
    this.runningStartTimes = new Map(); // cellId -> timestamp
    this.runningTimerId = null;
    this.stopAllRequested = false;
    this.runAllInFlight = false;
  }

  /**
   * Parses parameter string (key=value lines) into an object.
   * Supports numbers and booleans.
   * @param {string} str - The parameter string.
   * @returns {Object} Key-value pairs.
   */
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

  /**
   * Starts the interval loop to update running timers in the UI.
   */
  startRunningTimerLoop() {
    if (this.runningTimerId) return;
    this.runningTimerId = setInterval(() => this.updateRunningTimerDom(), 1000);
  }

  /**
   * Stops the running timer loop.
   */
  stopRunningTimerLoop() {
    if (this.runningTimerId) {
      clearInterval(this.runningTimerId);
      this.runningTimerId = null;
    }
  }

  /**
   * Updates the DOM elements for running timers.
   */
  updateRunningTimerDom() {
    const now = Date.now();
    this.runningStartTimes.forEach((start, cellId) => {
      const el = document.querySelector(
        `article.cell[data-id="${cellId}"] .cell-status .running-timer`
      );
      if (el) {
        el.textContent = formatDuration(now - start);
      }
    });
    if (!this.runningStartTimes.size) {
      this.stopRunningTimerLoop();
    }
  }

  /**
   * Executes a prompt cell.
   * Resolves templates, calls LLM manager, and handles result/error.
   * @param {string} cellId - The ID of the cell to run.
   */
  async runPromptCell(cellId) {
    const item = this.app.lost.getCurrent();
    if (!item) return;

    const cells = Array.isArray(item.cells) ? item.cells : [];
    const cell = cells.find((c) => c.id === cellId);
    if (!cell || cell.type !== "prompt") return;

    const modelId = cell.modelId || item.notebookModelId;
    if (!modelId) {
      alert("Please select a default LLM for the notebook or this cell.");
      return;
    }

    const model = this.app.llmManager.getModelWithProvider(modelId);
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

    // Build final prompt
    const finalPrompt = this.app.templateManager.expandTemplate(cell.text || "", cells);
    const finalSystemPrompt = this.app.templateManager.expandTemplate(
      cell.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      cells
    );

    const controller = new AbortController();
    this.runningControllers.set(cellId, controller);
    this.runningCells.add(cellId);
    this.runningStartTimes.set(cellId, Date.now());
    this.startRunningTimerLoop();
    this.app.renderNotebook();
    this.app.cellRenderer.updateStaleStatus(cells);

    try {
      const result = await this.app.llmManager.callLLM(
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
      const cleanedOutput = cleanJsonMarkdown(output || "");
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
                  lastOutput: cleanedOutput,
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
                      this.app.llmManager.getModelLabelById(modelId) ||
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
          { changedIds: [cellId], reason: "output" }
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
      this.app.renderNotebook();
      this.app.cellRenderer.updateStaleStatus(cells);
    }
  }

  /**
   * Stops a running prompt cell by aborting the controller.
   * @param {string} cellId - The cell ID to stop.
   */
  stopCell(cellId) {
    const controller = this.runningControllers.get(cellId);
    if (controller) {
      controller.abort();
      this.runningControllers.delete(cellId);
    }
    this.runningCells.delete(cellId);
    this.runningStartTimes.delete(cellId);
    if (!this.runningCells.size) this.stopRunningTimerLoop();
    this.app.renderNotebook();
    const cells = this.app.currentNotebook?.cells || [];
    this.app.cellRenderer.updateStaleStatus(cells);
  }

  /**
   * Sequentially runs all prompt and code cells in the notebook.
   */
  async runAllCells() {
    const item = this.app.lost.getCurrent();
    if (!item) return;
    const cells = Array.isArray(item.cells) ? item.cells : [];
    if (!cells.length) return;

    this.stopAllRequested = false;
    this.runAllInFlight = true;
    this.app.renderNotebook();

    for (const cell of cells) {
      if (this.stopAllRequested) break;
      if (cell.type === "prompt") {
        await this.runPromptCell(cell.id);
      } else if (cell.type === "code") {
        await this.app.codeCellManager.runCodeCell(cell.id);
      }
    }

    this.runAllInFlight = false;
    this.stopAllRequested = false;
    this.app.renderNotebook();
  }

  /**
   * Stops all currently running cells and aborts run-all sequence.
   */
  stopAllCells() {
    this.stopAllRequested = true;
    this.runningControllers.forEach((controller) => controller.abort());
    this.runningControllers.clear();
    this.runningCells.clear();
    this.runningStartTimes.clear();
    this.stopRunningTimerLoop();
    this.runAllInFlight = false;
    this.app.renderNotebook();
  }
}
