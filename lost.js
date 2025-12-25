
/**
 * Lost: A lightweight state management and sharing library.
 * Handles localStorage persistence, URL hash sharing (compression/encoding),
 * and object lifecycle (create, read, update, delete).
 */
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (!window.__lostSwRegistered) {
    window.__lostSwRegistered = true;
    navigator.serviceWorker.register('./sw.js', { scope: '/' }).catch(() => {});
  }
}

export class Lost extends EventTarget {
  /**
   * Create a new Lost instance.
   * @param {Object} config - Configuration object.
   * @param {string} [config.storageKey='lost-store-v1'] - LocalStorage key for data.
   * @param {string} [config.currentKey='lost-current-v1'] - LocalStorage key for current item ID.
   * @param {Object} [config.defaultData={}] - Default data for new items.
   * @param {Function} [config.validator] - Function to validate data on load. Returns boolean.
   * @param {Function} [config.filter] - Function to filter data before saving/encoding.
   * @param {string} [config.compressionMethod='deflate'] - Compression method ('deflate', 'gzip', or 'none').
   */
  constructor(config) {
    super();
    this.storageKey = config.storageKey || 'lost-store-v1';
    this.currentKey = config.currentKey || 'lost-current-v1';
    this.defaultData = config.defaultData || {};
    this.validator = config.validator || (() => true);
    this.filter = config.filter || Lost.defaultFilter;
    this.compressionMethod = config.compressionMethod || 'deflate';
    
    // New Configs
    this.download = config.download || 'auto'; // yes, no, auto
    this.fileExtension = config.fileExtension || 'lost';
    this.downloadFormat = config.downloadFormat || 'binary'; // binary, json
    this.maxUrlSize = config.maxUrlSize || 8192;
    this.urlShare = config.urlShare || 'auto'; // yes, no, auto
    
    this.items = {};
    this.currentId = null;
    
    // Hash management state
    this.currentHash = '';
    this.pendingHashCheck = false;
    this.ignoreHashes = new Set();
  }

  // ----- Utils -----
  static generateId() {
    return 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  static deepEqual(obj1, obj2) {
    if (obj1 === obj2) return true;
    if (obj1 == null || obj2 == null) return false;
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;
    
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    
    if (keys1.length !== keys2.length) return false;
    
    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (!Lost.deepEqual(obj1[key], obj2[key])) return false;
    }
    
    return true;
  }

  static defaultFilter(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(item => Lost.defaultFilter(item));
    }
    
    const result = {};
    for (const key of Object.keys(obj)) {
      if (!key.startsWith('_')) {
        result[key] = Lost.defaultFilter(obj[key]);
      }
    }
    return result;
  }

  // ----- Compression / Encoding -----
  static async compress(string, encoding = 'gzip') {
    const byteArray = new TextEncoder().encode(string);
    const cs = new CompressionStream(encoding);
    const writer = cs.writable.getWriter();
    writer.write(byteArray);
    writer.close();
    return new Response(cs.readable).arrayBuffer();
  }

  static async decompress(byteArray, encoding = 'gzip') {
    const cs = new DecompressionStream(encoding);
    const writer = cs.writable.getWriter();
    writer.write(byteArray);
    writer.close();
    return new Response(cs.readable).arrayBuffer().then(function (arrayBuffer) {
      return new TextDecoder().decode(arrayBuffer);
    });
  }

  static arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  async encode(data) {
    try {
      const filteredData = this.filter(data);
      const json = JSON.stringify(filteredData);
      let base64;
      
      if(this.compressionMethod === 'none'){
        base64 = btoa(unescape(encodeURIComponent(json)));
      }
      else {
        const compressed = await Lost.compress(json, this.compressionMethod);
        base64 = Lost.arrayBufferToBase64(compressed);
      }

      let prefix = '';
      if (this.compressionMethod == 'gzip') prefix = '$';
      if (this.compressionMethod == 'deflate') prefix = '!';

      return prefix + base64; // Prepend prefix to mark compressed data
    } catch (e) {
      console.error('Failed to encode data:', e);
      return null;
    }
  }

  async decode(base64) {
    try {
      let json;
      // Check if data is compressed (starts with '$')
      if (base64.startsWith('$') || base64.startsWith('!')) {
        // Compressed format
        const method = base64.startsWith('$') ? 'gzip' : 'deflate';
        const compressedBase64 = base64.slice(1); // Remove '$' prefix
        const binaryString = atob(compressedBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        json = await Lost.decompress(bytes, method);
      } else {
        // Legacy uncompressed format support (if needed)
        json = decodeURIComponent(escape(atob(base64)));
      }
      
      const data = JSON.parse(json);
      if (!this.validator(data)) return null;
      return data;
    } catch (e) {
      console.error('Failed to decode data:', e);
      return null;
    }
  }

  // ----- Persistence -----
  /**
   * Loads data from localStorage and initializes state.
   * If no data exists, creates a default item.
   * Triggers 'update' event.
   */
  load() {
    try {

      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        // Initialize first item
        const id = Lost.generateId();
        this.items = {
            [id]: { id, ...this.defaultData }
        };
        this.currentId = id;
        this.save();
        this.initUrlHandling();
        this.notify();
        return;
      }
      
      this.items = JSON.parse(raw);

      // Load current ID
      let currentId = this.getQueryKey();
      if (!currentId) {
        currentId = localStorage.getItem(this.currentKey);
      }

      if (currentId && this.items[currentId]) {
        this.currentId = currentId;
      } else {
        // Pick first
        const ids = Object.keys(this.items);
        this.currentId = ids.length > 0 ? ids[0] : null;
        if (!this.currentId) {
            const id = Lost.generateId();
            this.items[id] = { id, ...this.defaultData };
            this.currentId = id;
        }
      }
    } catch (e) {
      console.error('Error loading state:', e);
      const id = Lost.generateId();
      this.items = { [id]: { id, ...this.defaultData } };
      this.currentId = id;
    }

    this.initUrlHandling();
    this.notify();
  }

  /**
   * Saves current state to localStorage.
   */
  save() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.items));
    localStorage.setItem(this.currentKey, this.currentId);
  }

  /**
   * Dispatches 'update' event with current item data.
   * Also updates the URL hash if applicable.
   */
  notify() {
    this.dispatchEvent(new CustomEvent('update', { detail: this.getCurrent() }));
    // Trigger URL update asynchronously to avoid blocking
    if (this.currentHash !== undefined) {
      this.updateURL();
    }
  }

  // ----- CRUD -----
  /**
   * Returns map of all items.
   * @returns {Object} Map of ID to item data.
   */
  getAll() {
    return this.items;
  }

  /**
   * Get an item by ID.
   * @param {string} id - Item ID.
   * @returns {Object|null} Item data or null.
   */
  getItem(id) {
    return this.items[id] || null;
  }

  /**
   * Get the currently active item.
   * @returns {Object|null} Current item data.
   */
  getCurrent() {
    return this.items[this.currentId] || null;
  }

  /**
   * Set the current active item by ID.
   * Saves state and triggers update.
   * @param {string} id - Item ID to activate.
   */
  setCurrent(id) {
    if (this.items[id] && id !== this.currentId) {
      this.currentId = id;
      this.save();
      this.notify();
    }
  }

  /**
   * Create a new item with provided data.
   * Generates a new ID, saves, sets as current, and returns the ID.
   * @param {Object} data - Item data.
   * @returns {string} New item ID.
   */
  create(data) {
    let id = Lost.generateId();
    if(data.id) {
      id = data.id;
      delete data.id;
    }

    this.items[id] = { id, ...data };
    this.setCurrent(id);
    return id;
  }

  /**
   * Update an existing item.
   * @param {string} id - Item ID.
   * @param {Object} data - Data to merge into existing item.
   * @param {boolean} [notify=true] - Whether to trigger update event.
   */
  update(id, data, notify = true) {
    if (this.items[id]) {
      this.items[id] = { ...this.items[id], ...data };
      this.save();
      if (notify) this.notify();
      else if (this.currentHash !== undefined) {
        this.updateURL();
      }
    }
  }

  /**
   * Delete an item by ID.
   * Prevents deleting the last remaining item.
   * If current item is deleted, switches to another item.
   * @param {string} id - Item ID.
   * @returns {boolean} True if deleted, false if could not delete (e.g. last item).
   */
  delete(id) {
    const ids = Object.keys(this.items);
    if (ids.length <= 1) {
      return false; // Cannot delete last item
    }

    delete this.items[id];
    
    if (id === this.currentId) {
      const remainingIds = Object.keys(this.items);
      this.setCurrent(remainingIds[0]);
    } else {
      this.save();
      this.notify();
    }
    return true;
  }

  /**
   * Determine sharing capability based on content length and config.
   * @param {number} length - Length of encoded content.
   * @returns {Object} { canShare, offerDownload }
   */
  getShareStatus(length) {
    let canShare = true;
    if (this.urlShare === 'no') canShare = false;
    else if (this.urlShare === 'auto') canShare = length <= this.maxUrlSize;

    let offerDownload = false;
    if (this.download === 'yes') offerDownload = true;
    else if (this.download === 'no') offerDownload = false;
    else if (this.download === 'auto') offerDownload = length > this.maxUrlSize;

    // Fallback: If URL sharing is disabled/impossible, offer download (unless explicitly disabled)
    if (!canShare && this.download !== 'no') {
        offerDownload = true;
    }
    
    return { canShare, offerDownload };
  }

  // ----- URL Sharing -----
  getQueryKey() {
    const query = window.location.search.slice(1);
    if (!query) return null;

    const ids = Object.keys(this.items);
    for (const id of ids) {
      const token = id.split('_').pop();
      if (token === query) {
        return id;
      }
    }
    return null;
  }

  buildShareUrl(id, hash, tokenStr = null) {
    const token = tokenStr || (id ? id.split('_').pop() : '');
    const baseUrl = window.location.origin + window.location.pathname;
    const query = token ? '?' + token : '';
    return {
      url: baseUrl + query + '#' + hash,
      token
    };
  }
  
  async importFromHash(hash) {
    if (!hash) return null;

    // Decode
    const data = await this.decode(hash);
    if (!data || !data.id) return null;

    // Check existence
    const existing = this.items[data.id];
    if (existing && Lost.deepEqual(this.filter(existing), this.filter(data))) {
        this.setCurrent(data.id);
        return { status: 'exists_identical', id: data.id };
    }

    if (existing) {
        return { status: 'exists_diff', data, existing };
    }

    return { status: 'new', data };
  }

  /**
   * Import data from a URL hash and confirm with user if needed.
   * Handles 'exists_identical', 'exists_diff', and 'new' states.
   * @param {string} hash - URL hash string.
   * @returns {Promise<boolean>} True if imported/switched, false otherwise.
   */
  async importAndConfirm(hash) {
      const result = await this.importFromHash(hash);
      if (!result) return false;

      /*if(result.existing) {
        console.log('existing', result.data.id);
        this.setCurrent(result.data.id);
      }*/

      if (result.status === 'exists_identical') {
          // Already handled in importFromHash? No, importFromHash just returns status.
          // We need to ensure it is set as current.
          return true;
      }

      const message = result.existing
        ? `"${result.data.title}" already exists. Do you want to update it?`
        : `Do you want to import: "${result.data.title}"`;
      const shouldImport = confirm(message);
      
      if (shouldImport) {
          if (result.existing) {
            this.update(result.data.id, result.data);
          } else {
            this.create(result.data);
          }
          this.setCurrent(result.data.id);
          return true;
      }
      return false;
  }

  /**
   * Generate a shareable URL for an item.
   * Encodes and compresses item data into the URL hash.
   * @param {string} id - Item ID.
   * @returns {Promise<string|null>} Full URL or null if failed.
   */
  async getShareUrl(id) {
    const item = this.getItem(id);
    if (!item) return null;

    const encoded = await this.encode(item);
    if (!encoded) return null;

    const { url } = this.buildShareUrl(item.id, encoded);
    return url;
  }

  // ----- Hash Handling -----
  initUrlHandling() {
    this.pendingHashCheck = !!window.location.hash;
    
    window.addEventListener('load', () => {
      setTimeout(async () => {
        await this.checkAndImportFromUrl();
        await this.updateURL();
      }, 100);
    });
    
    window.addEventListener('hashchange', () => this.checkAndImportFromUrl());
  }

  async checkAndImportFromUrl() {
    this.pendingHashCheck = false;
    const hash = window.location.hash.slice(1);
    
    if (!hash) {
      if (!this.currentHash) await this.updateURL();
      return;
    }

    // Ignore hashes we generated ourselves recently to prevent race conditions
    if (this.ignoreHashes.has(hash)) return;

    if (hash === this.currentHash) return;

    const current = this.getCurrent();
    if (current) {
      const currentEncoded = await this.encode(current);
      if (hash === currentEncoded) {
        this.currentHash = hash;
        return;
      }
    }

    await this.importAndConfirm(hash);
    await this.updateURL();
  }

  async updateURL() {
    const item = this.getCurrent();
    if (!item) return;

    const encoded = await this.encode(item);
    if (!encoded) {
      this.dispatchEvent(new CustomEvent('updateUrl', { 
        detail: { url: '', hash: '', canShare: false, offerDownload: false } 
      }));
      return;
    }

    const len = encoded.length;
    const { canShare: shouldUpdateUrl, offerDownload } = this.getShareStatus(len);

    const { url, token } = this.buildShareUrl(item.id, encoded);
    
    // Dispatch event with full details for UI
    this.dispatchEvent(new CustomEvent('updateUrl', { detail: {
        url: shouldUpdateUrl ? url : null,
        fullUrl: url,
        hash: encoded,
        canShare: shouldUpdateUrl,
        offerDownload: offerDownload,
        fileExtension: this.fileExtension
    }}));

    if (!shouldUpdateUrl) {
        // If URL sharing is disabled or state is too large, ensure hash is removed
        const baseUrl = window.location.origin + window.location.pathname;
        const query = token ? '?' + token : '';
        const cleanUrl = baseUrl + query;

        if (window.location.hash) {
             window.history.replaceState(null, '', cleanUrl);
             this.currentHash = ''; 
        }
        return;
    }

    if (this.pendingHashCheck && window.location.hash.slice(1) !== encoded) {
      return;
    }

    this.currentHash = encoded;
    const currentSearch = window.location.search.slice(1);
    const needsUpdate = window.location.hash.slice(1) !== encoded || currentSearch !== (token || '');
    
    if (needsUpdate) {
      // Add to ignore set to prevent self-importing this hash
      this.ignoreHashes.add(encoded);
      setTimeout(() => this.ignoreHashes.delete(encoded), 2000);

      // For iOS Safari compatibility, update hash before replaceState
      if (window.location.hash.slice(1) !== encoded) {
        window.location.hash = encoded;
      }
      // Small delay to ensure hash update registers before replaceState
      setTimeout(() => {
        window.history.replaceState(null, '', url);
      }, 0);
    }
  }
}
