import { applyTextareaHeight } from "./utils.js";

/**
 * Creates a searchable model picker dropdown UI component.
 * @param {Object} config - Configuration object (selectedId, searchTerm, callbacks).
 * @param {Object} llmManager - Instance of LlmManager.
 * @returns {HTMLElement} The wrapper element for the picker.
 */
export function createModelPicker(config, llmManager) {
  const {
    selectedId = "",
    searchTerm = "",
    placeholder = "Search",
    defaultLabel = null,
    defaultValue = "",
    onSearchChange,
    onSelect
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
    return (
      llmManager.getModelLabelById(id) || id || defaultLabel || "Select model"
    );
  };

  const renderList = () => {
    list.innerHTML = "";
    const models = llmManager.getFilteredModels(currentSearch);
    const addEntry = (id, label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "model-picker-item";
      btn.textContent = label;
      if (id === currentId) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        currentId = id;
        pill.textContent = getLabel(currentId);
        if (typeof onSelect === "function") {
          onSelect(id);
        }
        panel.style.display = "none";
      });
      list.appendChild(btn);
    };

    if (defaultLabel !== null) {
      addEntry(defaultValue, defaultLabel);
    }
    models.forEach((m) =>
      addEntry(m.id, llmManager.formatModelDisplay(m))
    );
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
    if (typeof onSearchChange === "function") {
      onSearchChange(currentSearch);
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

/**
 * Creates a UI component for editing additional parameters (as key=value text).
 * @param {string} initialValue - The initial parameter string.
 * @param {Function} onChange - Callback when parameters change.
 * @returns {HTMLElement} The wrapper element.
 */
export function createParamsUi(initialValue, onChange) {
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

export class LogOverlay {
  /**
   * Manages the overlay for displaying raw LLM request/response logs.
   */
  constructor() {
    this.overlay = null;
    this.textarea = null;
  }

  /**
   * Builds the overlay DOM elements if they don't exist.
   */
  build() {
    if (this.overlay) return;
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

    this.overlay = overlay;
    this.textarea = textarea;
  }

  /**
   * Shows the overlay with formatted log data.
   * @param {Object} log - The log data object containing _rawRequest and _rawResponse.
   */
  show(log) {
    if (!this.overlay) this.build();
    const payload = log
      ? {
          request: log._rawRequest ?? null,
          response: log._rawResponse ?? null
        }
      : { message: "No request/response recorded." };
    this.textarea.value = JSON.stringify(payload, null, 2);
    this.overlay.style.display = "flex";
    this.textarea.focus();
  }
}
