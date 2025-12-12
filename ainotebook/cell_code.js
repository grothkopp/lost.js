
export class CodeCellManager {
  /**
   * Manages execution of code cells using sandboxed iframes.
   * Handles running, stopping, and timeouts for code execution.
   * @param {Object} app - The main AiNotebookApp instance.
   * @param {Function} updateCells - Callback to update cell state in the app.
   */
  constructor(app, updateCells) {
    this.app = app;
    this.updateCells = updateCells;
    this._sandboxes = new Map(); // cellId -> iframe
    this._codeRunTimers = new Map(); // cellId -> timeout id
    this._codeRunning = new Set(); // cellId -> running flag
    this._codeVersions = new Map(); // cellId -> version counter
    this._codeStartTimes = new Map(); // cellId -> start timestamp
    this._pendingResolvers = new Map(); // cellId -> { resolve, reject, version }
    
    this.handleSandboxMessage = this.handleSandboxMessage.bind(this);
    window.addEventListener("message", this.handleSandboxMessage);
  }

  /**
   * Ensures a sandbox iframe exists for a specific cell.
   * Creates one if it doesn't exist or was removed.
   * @param {string} cellId - The ID of the cell.
   * @returns {Promise<HTMLIFrameElement>} The sandbox iframe.
   */
  ensureSandbox(cellId) {
    let iframe = this._sandboxes.get(cellId);
    if (iframe && document.body.contains(iframe)) return Promise.resolve(iframe);

    return new Promise((resolve) => {
      iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.sandbox = "allow-scripts";
      iframe.onload = () => resolve(iframe);
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
    });
  }

  /**
   * Handles messages from sandbox iframes (results or errors).
   * @param {MessageEvent} event - The message event.
   */
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

    // Resolve pending promise
    const pending = this._pendingResolvers.get(cellId);
    if (pending && pending.version === version) {
      this._pendingResolvers.delete(cellId);
      pending.resolve(data);
    }

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
        { changedIds: [cellId], reason: "output" }
      );
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
  }

  /**
   * Schedules a code run with a debounce delay.
   * @param {string} cellId - The ID of the cell to run.
   * @param {number} delayMs - Delay in milliseconds (default 800).
   */
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

  /**
   * Executes the code in a cell immediately.
   * Expands templates, creates sandbox, sends code to iframe, and updates state.
   * @param {string} cellId - The ID of the cell to run.
   * @returns {Promise<Object>} Result object with type and value/error.
   */
  async runCodeCell(cellId) {
    // Cancel any pending scheduled run for this cell to prevent double execution
    const prevTimer = this._codeRunTimers.get(cellId);
    if (prevTimer) {
      clearTimeout(prevTimer);
      this._codeRunTimers.delete(cellId);
    }

    const item = this.app.lost.getCurrent();
    if (!item) return;
    const cells = Array.isArray(item.cells) ? item.cells : [];
    const cell = cells.find((c) => c.id === cellId);
    if (!cell || cell.type !== "code") return;

    // Use template manager to expand code with current values
    const code = this.app.templateManager.expandTemplate(cell.text || "", cells);
    
    // Direct call to render to show running state
    this.app.renderNotebook(); 
    this.app.cellRenderer.updateStaleStatus(cells);

    const iframe = await this.ensureSandbox(cellId);
    const nextVersion = (this._codeVersions.get(cellId) || 0) + 1;
    this._codeVersions.set(cellId, nextVersion);
    this._codeRunning.add(cellId);
    this._codeStartTimes.set(cellId, Date.now());
    
    // Update status again to show running state immediately
    this.app.cellRenderer.updateStaleStatus(cells);
    
    return new Promise((resolve) => {
      this._pendingResolvers.set(cellId, { resolve, version: nextVersion });

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
        this._pendingResolvers.delete(cellId);
        const msg =
          err && typeof err.message === "string"
            ? err.message
            : "Failed to start sandbox.";
        this.updateCells(
          (cells) =>
            cells.map((c) =>
              c.id === cellId ? { ...c, error: msg } : c
            ),
          { changedIds: [cellId], reason: "output" }
        );
        resolve({ type: "code-error", error: msg });
      }
    });
  }

  /**
   * Checks if a specific cell is currently executing code.
   * @param {string} cellId - The cell ID.
   * @returns {boolean} True if running.
   */
  isRunning(cellId) {
    return this._codeRunning.has(cellId);
  }
  
  /**
   * Stops execution of a code cell by removing its sandbox.
   * @param {string} cellId - The cell ID to stop.
   */
  stopCode(cellId) {
    if (!cellId) return;
    
    // Clear timer
    const timer = this._codeRunTimers.get(cellId);
    if (timer) clearTimeout(timer);
    this._codeRunTimers.delete(cellId);
    
    // Remove iframe to forcibly stop execution
    const iframe = this._sandboxes.get(cellId);
    if (iframe) {
      iframe.remove();
      this._sandboxes.delete(cellId);
    }
    
    this._codeRunning.delete(cellId);
    this._codeStartTimes.delete(cellId);
    
    // Reject pending promise
    const pending = this._pendingResolvers.get(cellId);
    if (pending) {
      this._pendingResolvers.delete(cellId);
      // We resolve with a specialized message or just do nothing?
      // Resolving prevents hanging awaits
      pending.resolve({ type: "code-error", error: "Stopped by user." });
    }
    
    this.updateCells(
      (cells) =>
        cells.map((c) =>
          c.id === cellId ? { ...c, lastRunInfo: { ...c.lastRunInfo, status: "stopped" } } : c
        ),
      { changedIds: [cellId] }
    );
  }

  /**
   * Stops all running code cells and clears all timers.
   */
  stopAll() {
    this._codeRunTimers.forEach((t) => clearTimeout(t));
    this._codeRunTimers.clear();
    this._codeRunning.clear();
    this._codeVersions.clear();
    this._codeStartTimes.clear();
  }
}
