import { genId } from "./utils.js";

export class SettingsDialog {
  constructor(llmManager) {
    this.llmManager = llmManager;
    this.dialog = document.getElementById("settingsDialog");
    this.llmListEl = document.getElementById("llmList");
    this.addLlmBtn = document.getElementById("addLlmBtn");
    this.refreshModelsBtn = document.getElementById("refreshModelsBtn");
    this.modelCacheStatus = document.getElementById("modelCacheStatus");
    this.envTextarea = document.getElementById("envTextarea");
    this.closeBtn = document.getElementById("settingsCloseBtn");
    this.cancelBtn = document.getElementById("settingsCancelBtn");

    if (this.modelCacheStatus) {
      this.llmManager.setModelCacheStatusElement(this.modelCacheStatus);
    }

    this.bindEvents();
  }

  bindEvents() {
    this.addLlmBtn?.addEventListener("click", () => this.addLlmRow());
    if (this.refreshModelsBtn) {
      this.refreshModelsBtn.addEventListener("click", () =>
        this.refreshModelCache()
      );
    }
    this.closeBtn?.addEventListener("click", () => {
      this.saveFromDialog();
      this.dialog?.close();
    });
    this.cancelBtn?.addEventListener("click", () => {
      this.dialog?.close();
    });
  }

  show() {
    this.render();
    this.dialog.showModal();
  }

  get isOpen() {
    return this.dialog?.open;
  }

  render() {
    this.llmListEl.innerHTML = "";
    const providers = this.llmManager.settings.providers;
    
    if (this.envTextarea) {
      const env = this.llmManager.settings.env || {};
      this.envTextarea.value = Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    }

    if (!providers.length) {
      // Add one empty row to start with
      providers.push({
        id: genId("provider"),
        provider: "openai",
        baseUrl: this.llmManager.getProviderDefaultBaseUrl("openai"),
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
        this.llmManager.getProviderDefaultBaseUrl(provider.provider || "openai");
      connField.querySelector(".llm-apikey-input").value =
        provider.apiKey || "";
      row.appendChild(connField);

      // Actions
      const actions = document.createElement("div");
      actions.className = "llm-actions";
      actions.innerHTML =
        '<button type="button" class="icon-btn llm-delete-btn" title="Delete">✕</button>';
      row.appendChild(actions);

      // Provider change default base URL
      providerSelect.addEventListener("change", () => {
        const defaultBase = this.llmManager.getProviderDefaultBaseUrl(
          providerSelect.value
        );
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
          const idx = this.llmManager.settings.providers.findIndex(
            (m) => m.id === provider.id
          );
          if (idx >= 0) {
            this.llmManager.settings.providers.splice(idx, 1);
            this.render();
          }
        });

      this.llmListEl.appendChild(row);
    }
  }

  addLlmRow() {
    this.llmManager.settings.providers.push({
      id: genId("provider"),
      provider: "openai",
      baseUrl: "",
      apiKey: ""
    });
    this.render();
  }

  saveFromDialog() {
    const providers = this.collectProviders();
    this.llmManager.settings.providers = providers;
    
    if (this.envTextarea) {
      const envLines = this.envTextarea.value.split("\n");
      const env = {};
      envLines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const idx = trimmed.indexOf("=");
        if (idx > 0) {
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim();
          if (key) env[key] = val;
        }
      });
      this.llmManager.settings.env = env;
    }

    // Drop cached models that no longer have a provider backing them
    this.llmManager.settings.cachedModels = (
      this.llmManager.settings.cachedModels || []
    ).filter((m) => providers.some((p) => p.id === m.providerId));
    this.llmManager.saveSettings();
    window.dispatchEvent(new CustomEvent("llm-settings-updated"));
  }

  collectProviders() {
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

  refreshModelCache() {
    // If settings dialog is open, read latest provider edits before fetching
    if (this.isOpen) {
      const providersFromDialog = this.collectProviders();
      this.llmManager.refreshModelCache(providersFromDialog).then(() => {
        // trigger re-render of notebook if needed? 
        // The main app should listen to something or we can emit an event.
        // For now, refreshModelCache updates the settings object. 
        // The main app calls renderNotebook() in its own refresh method.
        // I might need to accept a callback or emit event.
        window.dispatchEvent(new CustomEvent("llm-models-updated"));
      });
    }
  }
}
