
export class TemplateManager {
  constructor(getParsedOutputs, getEnv) {
    // getParsedOutputs is a function that returns the Map of parsed outputs
    this.getParsedOutputs = getParsedOutputs;
    this.getEnv = getEnv || (() => ({}));
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

  resolveTemplateValue(expr, cells) {
    const { base, path } = this.parseKeyPath(expr);
    if (!base) return "";

    let current = null;

    if (base === "ENV") {
      current = this.getEnv();
    } else {
      // Find the cell directly from the fresh cells array
      let cell = null;
      const cellIndexMatch = base.match(/^#(\d+)$/) || base.match(/^out(\d+)$/);
      if (cellIndexMatch) {
        const idx = parseInt(cellIndexMatch[1], 10) - 1;
        cell = cells[idx];
      } else {
        cell = cells.find((c) => c.id === base || c.name === base);
      }

      if (cell) {
        current = this.getCellValue(cell);
        // If we have a path or the value looks like JSON, try to parse it
        if (typeof current === "string" && (path.length > 0 || /^\s*[\[\{]/.test(current))) {
          try {
            current = JSON.parse(current);
          } catch (e) {
            // Ignore parse error, treat as string
          }
        }
      } else {
        return "";
      }
    }

    // Traverse path
    for (const key of path) {
      if (current == null) return "";
      const isIndex = /^[0-9]+$/.test(key);
      if (isIndex && Array.isArray(current)) {
        current = current[Number(key)];
      } else if (
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

  getCellValue(cell) {
    if (cell.type === "prompt") return cell.lastOutput || "";
    if (cell.type === "code") return cell.lastOutput || "";
    return typeof cell.text === "string" ? cell.text : "";
  }

  expandTemplate(template, cells) {
    if (!template) return "";
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
      const trimmed = key.trim();
      return this.resolveTemplateValue(trimmed, cells);
    });
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
}
