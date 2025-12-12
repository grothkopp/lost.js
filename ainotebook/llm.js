import { genId, sanitizeHeaders } from "./utils.js";

export const DEFAULT_SYSTEM_PROMPT =
  "You are an AI assistant inside a local notebook app. Return concise answers in Markdown.";

export const DEFAULT_LLM_SETTINGS = {
  providers: [],
  cachedModels: [],
  cacheTimestamp: 0
};

export const LLM_SETTINGS_KEY = "ainotebook-llm-settings-v1";

export class LlmManager {
  constructor() {
    this.settings = this.loadSettings();
    this.refreshModelsInFlight = false;
    this.modelCacheStatus = null; // Element to update status
  }

  loadSettings() {
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
      const env = typeof parsed.env === "object" ? parsed.env : {};
      const normalizedCachedModels = cachedModels
        .filter(m => m && typeof m === 'object')
        .map((m) => {
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

      // Legacy migration
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
        cacheTimestamp,
        env: env || {}
      };
    } catch (err) {
      console.error("Error loading settings:", err);
      return { ...DEFAULT_LLM_SETTINGS };
    }
  }

  saveSettings() {
    try {
      localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(this.settings));
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
    return (this.settings.cachedModels || []).find((m) => m.id === id) || null;
  }

  getModelLabelById(id) {
    if (!id) return "";
    const m = this.getModelById(id);
    if (!m) return "";
    return this.formatModelDisplay(m);
  }

  getModelWithProvider(id) {
    const model = this.getModelById(id);
    if (!model) return null;
    const providers = Array.isArray(this.settings.providers)
      ? this.settings.providers
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
    const models = Array.isArray(this.settings.cachedModels)
      ? this.settings.cachedModels
      : [];
    if (!term) return models;
    return models.filter((m) => {
      const name = this.formatModelDisplay(m).toLowerCase();
      const raw = `${m.model || ""}`.toLowerCase();
      return name.includes(term) || raw.includes(term);
    });
  }

  setModelCacheStatusElement(el) {
    this.modelCacheStatus = el;
  }

  updateModelCacheStatus(text, type = "info") {
    if (!this.modelCacheStatus) return;
    this.modelCacheStatus.textContent = text;
    this.modelCacheStatus.dataset.type = type;
  }

  async refreshModelCache(providersFromDialog = null) {
    if (providersFromDialog) {
      this.settings.providers = providersFromDialog;
      this.saveSettings();
    }

    if (this.refreshModelsInFlight) return;
    const providers = this.settings.providers || [];
    if (!providers.length) {
      this.updateModelCacheStatus("Add a provider to fetch models.", "warn");
      return;
    }

    this.refreshModelsInFlight = true;
    this.updateModelCacheStatus("Refreshing model list…", "info");
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

    this.settings.cachedModels = collected;
    this.settings.cacheTimestamp = Date.now();
    this.saveSettings();

    if (errors && collected.length) {
      this.updateModelCacheStatus(
        `Fetched ${collected.length} models with ${errors} error(s).`,
        "warn"
      );
    } else if (errors && !collected.length) {
      this.updateModelCacheStatus(
        "Could not refresh models. Check provider settings.",
        "error"
      );
    } else {
      this.updateModelCacheStatus(
        `Fetched ${collected.length} models just now.`,
        "success"
      );
    }

    this.refreshModelsInFlight = false;
  }

  async fetchModelsForProvider(provider) {
    const baseUrl = (
      provider.baseUrl || this.getProviderDefaultBaseUrl(provider.provider)
    ).replace(/\/+$/, "");
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
        headers: sanitizeHeaders(requestHeaders),
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
        headers: sanitizeHeaders(requestHeaders),
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
        headers: sanitizeHeaders(requestHeaders),
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
