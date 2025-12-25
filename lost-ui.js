export class LostUI {
  /**
   * Create a new LostUI instance.
   * @param {Lost} lost - The Lost instance to bind to.
   * @param {Object} config - UI Configuration.
   * @param {HTMLElement} [config.container=document.body] - Container to append UI to.
   * @param {string} [config.theme='system'] - Theme preference ('system', 'light', 'dark', 'auto').
   * @param {boolean} [config.showLightDarkButton=true] - Show theme toggle in header.
   * @param {Object} [config.header] - Header configuration.
   * @param {boolean} [config.header.visible=true] - Show header.
   * @param {string} [config.header.title='Lost App'] - App title.
   * @param {Function} [config.header.extraContent] - Function returning HTMLElement for header actions.
   * @param {Object} [config.sidebar] - Sidebar configuration.
   * @param {boolean} [config.sidebar.visible=true] - Show sidebar.
   * @param {string} [config.sidebar.heading='Items'] - Sidebar heading text.
   * @param {Function} [config.sidebar.onNew] - Callback for "New" button.
   * @param {Function} [config.sidebar.title] - Function(item, id, isCurrent) returning list item title.
   * @param {Function} [config.sidebar.subline] - Function(item, id, isCurrent) returning list item subline.
   * @param {Object} [config.footer] - Footer configuration.
   * @param {boolean} [config.footer.visible=true] - Show footer (share box).
   */
  constructor(lost, config = {}) {
    this.lost = lost;
    const defaults = this.constructor.defaultConfig;
    const providedSidebar = config.sidebar || {};

    this.config = {
      ...defaults,
      ...config,
      header: { ...defaults.header, ...(config.header || {}) },
      sidebar: { ...defaults.sidebar, ...providedSidebar },
      footer: { ...defaults.footer, ...(config.footer || {}) },
      theme: config.theme || defaults.theme,
      showLightDarkButton: config.showLightDarkButton !== undefined ? config.showLightDarkButton : defaults.showLightDarkButton
    };

    const sidebar = this.config.sidebar;
    if (typeof providedSidebar.heading === 'string') {
      sidebar.heading = providedSidebar.heading;
    } else if (typeof providedSidebar.title === 'string') {
      sidebar.heading = providedSidebar.title;
    }
    if (typeof sidebar.heading !== 'string' || !sidebar.heading.trim()) {
      sidebar.heading = defaults.sidebar.heading;
    }

    if (typeof providedSidebar.itemTitle === 'function') {
      sidebar.title = providedSidebar.itemTitle;
    } else if (typeof providedSidebar.title === 'function') {
      sidebar.title = providedSidebar.title;
    }
    if (typeof sidebar.title !== 'function') {
      sidebar.title = defaults.sidebar.title;
    }

    if (typeof providedSidebar.itemSubline === 'function') {
      sidebar.subline = providedSidebar.itemSubline;
    } else if (typeof providedSidebar.subline === 'function') {
      sidebar.subline = providedSidebar.subline;
    }
    if (typeof sidebar.subline !== 'function') {
      sidebar.subline = defaults.sidebar.subline;
    }

    this.elements = {};
    this.initTheme();
    this.build();
    this.bindEvents();

    // Listen to lost events
    this.lost.addEventListener('update', (e) => {
      const item = e.detail;
      if (item) {
        // Use safe access for title as it might be raw data if listener order varies
        this.setTitle(item.title);
        this.updateSidebarList();
      }
    });

    this.lost.addEventListener('updateUrl', (e) => {
      this.updateShareBox(e.detail);
    });
  }

  static get defaultConfig() {
    return {
      container: document.body,
      header: {
        visible: true,
        title: 'Lost App',
        menuTitle: 'Menu',
        extraContent: null
      },
      sidebar: {
        visible: true,
        heading: 'Items',
        title: (item) => {
          if (item && typeof item.title === 'string' && item.title.trim()) {
            return item.title;
          }
          return 'Untitled Item';
        },
        subline: () => '',
        onNew: null,
        showImport: null
      },
      footer: {
        visible: true,
        label: 'Share:'
      }
    };
  }

  initTheme() {
    this.themeKey = 'lost.theme';
    this.themeSequence = ['system', 'light', 'dark'];
    this.themeIcons = {
      system: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M17 3.34a10 10 0 1 1 -15 8.66l.005 -.324a10 10 0 0 1 14.995 -8.336m-9 1.732a8 8 0 0 0 4.001 14.928l-.001 -16a8 8 0 0 0 -4 1.072" /></svg>`,
      light: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" /><path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7" /></svg>`,
      dark: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z" /></svg>`
    };
    this.themeLabels = { system: 'System default', light: 'Light', dark: 'Dark' };
    
    this.prefersDark = (typeof window !== 'undefined' && window.matchMedia)
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

    const current = this.loadThemePreference();
    this.applyThemePreference(current, { skipPersist: true });

    if (this.prefersDark) {
      const handlePrefChange = () => {
        const current = document.documentElement.dataset.theme || 'system';
        if (current === 'system') {
          this.applyThemePreference('system', { skipPersist: true });
        }
      };
      if (typeof this.prefersDark.addEventListener === 'function') {
        this.prefersDark.addEventListener('change', handlePrefChange);
      } else if (typeof this.prefersDark.addListener === 'function') {
        this.prefersDark.addListener(handlePrefChange);
      }
    }
  }

  loadThemePreference() {
    try {
      const raw = localStorage.getItem(this.themeKey);
      if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    } catch (_) {}
    return this.config.theme === 'auto' ? 'system' : (this.config.theme || 'system');
  }

  effectiveTheme(theme) {
    if (theme === 'light' || theme === 'dark') return theme;
    return (this.prefersDark && this.prefersDark.matches) ? 'dark' : 'light';
  }

  applyThemePreference(theme, opts = {}) {
    const normalized = (theme === 'light' || theme === 'dark' || theme === 'system') ? theme : 'system';
    document.documentElement.dataset.theme = normalized;
    const resolved = this.effectiveTheme(normalized);
    document.documentElement.dataset.themeResolved = resolved;
    document.documentElement.style.colorScheme = resolved;
    
    if (!opts.skipPersist) {
      try { localStorage.setItem(this.themeKey, normalized); } catch (_) {}
    }
    
    this.syncThemeButton(normalized);
    this.updateThemeMeta(resolved);
  }

  syncThemeButton(theme) {
    if (!this.elements.themeBtn) return;
    const icon = this.themeIcons[theme] || this.themeIcons.system;
    const label = this.themeLabels[theme] || theme;
    this.elements.themeBtn.dataset.theme = theme;
    this.elements.themeBtn.innerHTML = icon;
    const hint = `Switch color theme. Current: ${label}`;
    this.elements.themeBtn.setAttribute('aria-label', hint);
    this.elements.themeBtn.setAttribute('title', `${label} theme`);
  }

  updateThemeMeta(mode) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    // These colors should match your CSS variables for header background or similar
    const color = mode === 'dark' ? '#171a21' : '#ffffff'; 
    meta.setAttribute('content', color);
  }

  toggleTheme() {
    const current = document.documentElement.dataset.theme || 'system';
    const idx = this.themeSequence.indexOf(current);
    const next = this.themeSequence[(idx + 1) % this.themeSequence.length];
    this.applyThemePreference(next);
  }

  build() {
    const c = this.config.container;

    // 1. Header
    if (this.config.header.visible) {
      const header = document.createElement('header');
      
      // Menu Button
      if (this.config.sidebar.visible) {
        const menuBtn = document.createElement('button');
        menuBtn.className = 'action-btn';
        menuBtn.title = this.config.header.menuTitle;
        menuBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>';
        menuBtn.addEventListener('click', () => this.toggleSidebar());
        header.appendChild(menuBtn);
        this.elements.menuBtn = menuBtn;
      }

      // Title
      const h1 = document.createElement('h1');
      h1.id = 'title'; // Keep ID for backward compat if needed, or strictly use class
      h1.textContent = this.config.header.title;
      header.appendChild(h1);
      this.elements.title = h1;

      // Actions Container
      const actions = document.createElement('div');
      actions.className = 'header-actions';

      // Extra Content (e.g. Configure button)
      if (this.config.header.extraContent) {
        const extra = this.config.header.extraContent();
        if (extra) actions.appendChild(extra);
      }

      if (this.config.showLightDarkButton) {
        const themeBtn = document.createElement('button');
        themeBtn.className = 'action-btn';
        themeBtn.type = 'button';
        themeBtn.setAttribute('aria-label', 'Change color theme');
        themeBtn.title = 'Change color theme';
        themeBtn.addEventListener('click', () => this.toggleTheme());
        actions.appendChild(themeBtn);
        this.elements.themeBtn = themeBtn;
        this.syncThemeButton(document.documentElement.dataset.theme || 'system');
      }

      if (actions.childNodes.length > 0) {
        header.appendChild(actions);
      }

      // Insert header at top
      c.insertBefore(header, c.firstChild);
      this.elements.header = header;
    }

    // 2. Sidebar
    if (this.config.sidebar.visible) {
      // Overlay
      const overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      c.appendChild(overlay);
      this.elements.sidebarOverlay = overlay;

      // Sidebar container
      const sidebar = document.createElement('div');
      sidebar.className = 'sidebar';
      
      // Header
      const sbHeader = document.createElement('div');
      sbHeader.className = 'sidebar-header';
      
      const sbTitle = document.createElement('span');
      const sidebarHeading = this.config.sidebar.heading || this.constructor.defaultConfig.sidebar.heading;
      sbTitle.textContent = sidebarHeading;
      sbHeader.appendChild(sbTitle);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'sidebar-close-btn';
      closeBtn.title = 'Close';
      closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>';
      closeBtn.addEventListener('click', () => this.closeSidebar());
      sbHeader.appendChild(closeBtn);
      
      sidebar.appendChild(sbHeader);

      // List
      const list = document.createElement('div');
      list.className = 'item-list';
      sidebar.appendChild(list);
      this.elements.sidebarList = list;

      // Footer (Buttons)
      const sbFooter = document.createElement('div');
      sbFooter.className = 'sidebar-footer';

      if (this.config.sidebar.showImport !== false) {
        const importBtn = document.createElement('button');
        importBtn.className = 'new-item-btn';
        importBtn.style.display = 'none'; // Default hidden, app enables if needed
        importBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M12 11v6M9 14h6"></path></svg> Import';
        importBtn.addEventListener('click', () => this.importItemFromClipboard());
        sbFooter.appendChild(importBtn);
        this.elements.importBtn = importBtn;
      }

      if (this.config.sidebar.onNew) {
        const newBtn = document.createElement('button');
        newBtn.className = 'new-item-btn';
        newBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg> New';
        newBtn.addEventListener('click', () => this.config.sidebar.onNew());
        sbFooter.appendChild(newBtn);
      }

      sidebar.appendChild(sbFooter);
      c.appendChild(sidebar);
      this.elements.sidebar = sidebar;
    }

    // 3. Footer
    if (this.config.footer.visible) {
      document.body.style.paddingBottom = '60px';
      
      const footer = document.createElement('footer');
      footer.className = 'share-footer';
      
      const box = document.createElement('div');
      box.className = 'share-box';
      
      const label = document.createElement('div');
      label.className = 'share-box-label';
      label.textContent = this.config.footer.label;
      box.appendChild(label);

      const container = document.createElement('div');
      container.className = 'share-box-container';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'share-box-input';
      input.readOnly = true;
      container.appendChild(input);
      this.elements.shareInput = input;

      const copyBtn = document.createElement('button');
      copyBtn.className = 'share-box-copy-btn';
      copyBtn.textContent = 'Copy';
      container.appendChild(copyBtn);
      this.elements.copyBtn = copyBtn;

      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'download-btn';
      downloadBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download';
      downloadBtn.style.display = 'none'; 
      downloadBtn.addEventListener('click', () => this.handleDownload());
      container.appendChild(downloadBtn);
      this.elements.downloadBtn = downloadBtn;

      box.appendChild(container);
      footer.appendChild(box);
      c.appendChild(footer);
      this.elements.footer = footer;

      if (input && copyBtn) {
        this.bindCopyButton(copyBtn, input);
      }
    }

    // 4. Share Dialog
    const shareDialog = document.createElement('dialog');
    shareDialog.id = 'shareDialog';
    
    const dialogHeader = document.createElement('div');
    dialogHeader.className = 'share-dialog-header';
    dialogHeader.textContent = 'Share this item';
    shareDialog.appendChild(dialogHeader);
    
    const urlContainer = document.createElement('div');
    urlContainer.className = 'share-url-container';
    
    const shareUrlInput = document.createElement('input');
    shareUrlInput.type = 'text';
    shareUrlInput.className = 'share-url-input';
    shareUrlInput.id = 'shareUrlInput';
    shareUrlInput.readOnly = true;
    urlContainer.appendChild(shareUrlInput);
    
    const shareCopyBtn = document.createElement('button');
    shareCopyBtn.className = 'copy-btn';
    shareCopyBtn.id = 'copyBtn';
    shareCopyBtn.textContent = 'Copy';
    urlContainer.appendChild(shareCopyBtn);

    const shareDownloadBtn = document.createElement('button');
    shareDownloadBtn.className = 'download-btn';
    shareDownloadBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
    shareDownloadBtn.title = 'Download file';
    shareDownloadBtn.style.display = 'none';
    shareDownloadBtn.addEventListener('click', () => this.handleDownload());
    urlContainer.appendChild(shareDownloadBtn);
    this.elements.shareDialogDownloadBtn = shareDownloadBtn;
    
    shareDialog.appendChild(urlContainer);
    
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Share this link to let others import this item configuration.';
    shareDialog.appendChild(hint);
    
    const dialogFooter = document.createElement('div');
    dialogFooter.className = 'share-dialog-footer';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.id = 'shareDialogClose';
    closeBtn.textContent = 'Close';
    dialogFooter.appendChild(closeBtn);
    
    shareDialog.appendChild(dialogFooter);
    c.appendChild(shareDialog);
    
    this.elements.shareDialog = shareDialog;
    this.elements.shareDialogInput = shareUrlInput;
    this.elements.shareDialogCopyBtn = shareCopyBtn;
    this.bindCopyButton(shareCopyBtn, shareUrlInput);
    
    const closeHandler = () => {
        shareDialog.close();
        this.dialogShareContext = null;
    };
    closeBtn.addEventListener('click', closeHandler);
    this.elements.shareDialogCloseBtn = { button: closeBtn, handler: closeHandler };
  }

  bindEvents() {
    if (this.elements.sidebarOverlay) {
      this.elements.sidebarOverlay.addEventListener('click', () => this.closeSidebar());
    }
  }

  // ----- Public API -----

  /**
   * Initialize UI and start listening to window events (load).
   */
  load() {
    window.addEventListener('load', () => {
      this.setupDropzone();
      setTimeout(() => {
        this.updateImportButtonVisibility();
      }, 100);
    });
  }

  /**
   * Update the share box input value.
   * @param {Object|string} detail - The update detail (url or object).
   */
  updateShareBox(detail) {
    let url = detail;
    let canShare = true;
    let offerDownload = false;

    if (typeof detail === 'object' && detail !== null) {
        url = detail.url;
        canShare = detail.canShare !== false;
        offerDownload = detail.offerDownload === true;
        this.lastShareDetail = detail;
    } else {
        // Legacy/simple string support
        this.lastShareDetail = { url, hash: null }; 
    }

    // Update Input
    if (this.elements.shareInput) {
      this.elements.shareInput.value = url || '';
      // If no URL (too long or disabled), maybe show placeholder or empty?
      if (!url && canShare === false) {
          this.elements.shareInput.placeholder = 'State too large for URL sharing';
      } else {
          this.elements.shareInput.placeholder = '';
      }
    }
    if (this.elements.shareDialogInput) {
        this.elements.shareDialogInput.value = url || '';
    }

    // Toggle Buttons
    const toggle = (el, show) => { if (el) el.style.display = show ? 'flex' : 'none'; };
    
    // Copy button visible if we have a URL and sharing is allowed
    const showCopy = !!url && canShare;
    toggle(this.elements.copyBtn, showCopy);
    toggle(this.elements.shareDialogCopyBtn, showCopy);
    
    // Download button
    toggle(this.elements.downloadBtn, offerDownload);
    toggle(this.elements.shareDialogDownloadBtn, offerDownload);
  }

  /**
   * Update the header title.
   * @param {string} title - New title text.
   */
  setTitle(title) {
    if (this.elements.title) {
      this.elements.title.textContent = title;
    }
  }

  /**
   * Open or close the sidebar.
   */
  toggleSidebar() {
    if (!this.elements.sidebar) return;
    const isOpen = this.elements.sidebar.classList.toggle('open');
    if (isOpen) {
      this.elements.sidebarOverlay.classList.add('show');
      this.updateSidebarList(); // Refresh list when opening
    } else {
      this.elements.sidebarOverlay.classList.remove('show');
    }
  }

  /**
   * Close the sidebar.
   */
  closeSidebar() {
    if (!this.elements.sidebar) return;
    this.elements.sidebar.classList.remove('open');
    this.elements.sidebarOverlay.classList.remove('show');
  }

  /**
   * Set the URL in the footer share box directly.
   * @param {string} url 
   */
  setShareUrl(url) {
    if (this.elements.shareInput) {
      this.elements.shareInput.value = url;
    }
  }

  /**
   * Re-render the sidebar list items based on current Lost state.
   */
  updateSidebarList() {
    if (!this.elements.sidebarList) return;

    this.elements.sidebarList.innerHTML = '';
    const items = this.lost.getAll();
    const ids = Object.keys(items);

    ids.forEach(id => {
      const item = items[id];
      const isCurrent = id === this.lost.currentId;
      const el = this.renderSidebarItem(item, id, isCurrent);
      if (el) {
        this.elements.sidebarList.appendChild(el);
      }
    });
  }

  getSidebarItemTitle(item, id, isCurrent) {
    try {
      if (typeof this.config.sidebar.title === 'function') {
        const value = this.config.sidebar.title(item, id, isCurrent);
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
        if (value !== undefined && value !== null) {
          const str = String(value).trim();
          if (str) return str;
        }
      }
    } catch (err) {
      console.error('Sidebar title function failed:', err);
    }

    if (item && typeof item.title === 'string' && item.title.trim()) {
      return item.title.trim();
    }
    return 'Untitled Item';
  }

  getSidebarItemSubline(item, id, isCurrent) {
    try {
      if (typeof this.config.sidebar.subline === 'function') {
        const value = this.config.sidebar.subline(item, id, isCurrent);
        if (value === undefined || value === null) return '';
        return String(value);
      }
    } catch (err) {
      console.error('Sidebar subline function failed:', err);
    }
    return '';
  }

  renderSidebarItem(item, id, isCurrent) {
    const container = document.createElement('div');
    container.className = 'item-item';
    if (isCurrent) {
      container.classList.add('active');
    }

    const titleDiv = document.createElement('div');
    titleDiv.className = 'item-item-title';
    titleDiv.textContent = this.getSidebarItemTitle(item, id, isCurrent);
    container.appendChild(titleDiv);

    const sublineText = this.getSidebarItemSubline(item, id, isCurrent);
    if (typeof sublineText === 'string' && sublineText.trim()) {
      const sublineDiv = document.createElement('div');
      sublineDiv.className = 'item-item-count';
      sublineDiv.textContent = sublineText;
      container.appendChild(sublineDiv);
    }

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'item-item-actions';

    const shareBtn = document.createElement('button');
    shareBtn.className = 'share-item-btn';
    shareBtn.title = 'Share item';
    shareBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>';
    shareBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.shareItem(id);
    });
    actionsDiv.appendChild(shareBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-item-btn';
    deleteBtn.title = 'Delete item';
    deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2h2"></path><path d="M10 11v6M14 11v6"></path></svg>';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.deleteItem(id);
    });
    actionsDiv.appendChild(deleteBtn);

    container.appendChild(actionsDiv);
    container.addEventListener('click', () => this.lost.setCurrent(id));

    return container;
  }

  setShareDialog({ dialog, urlInput, copyBtn, closeBtn } = {}) {
    if (dialog) {
      this.elements.shareDialog = dialog;
    }
    if (urlInput) {
      this.elements.shareDialogInput = urlInput;
    }
    if (copyBtn && urlInput) {
      this.elements.shareDialogCopyBtn = copyBtn;
      this.bindCopyButton(copyBtn, urlInput);
    }
    if (closeBtn && dialog) {
      if (this.elements.shareDialogCloseBtn && this.elements.shareDialogCloseBtn.button && this.elements.shareDialogCloseBtn.handler) {
        this.elements.shareDialogCloseBtn.button.removeEventListener('click', this.elements.shareDialogCloseBtn.handler);
      }
      const closeHandler = () => {
          dialog.close();
          this.dialogShareContext = null;
      };
      closeBtn.addEventListener('click', closeHandler);
      this.elements.shareDialogCloseBtn = { button: closeBtn, handler: closeHandler };
    }
  }

  async shareItem(id) {
    try {
      const item = this.lost.getItem(id);
      if (!item) return;

      const encoded = await this.lost.encode(item);
      if (!encoded) {
        alert('Failed to encode item.');
        return;
      }

      const len = encoded.length;
      const { canShare, offerDownload } = this.lost.getShareStatus(len);

      let url = '';
      if (canShare) {
          const res = this.lost.buildShareUrl(item.id, encoded);
          url = res.url;
      }

      // Update Dialog UI
      if (this.elements.shareDialogInput) {
        this.elements.shareDialogInput.value = url;
        this.elements.shareDialogInput.placeholder = canShare ? '' : 'State too large for URL sharing';
      }
      
      // We need to set this.lastShareDetail for handleDownload to work
      // handleDownload uses this.lost.getCurrent(), but here we might be sharing a non-current item.
      // We should probably update handleDownload to accept an ID or hash, OR we just temporarily mock it?
      // Better: Update handleDownload to be more flexible, or just store the hash for this dialog context.
      
      // Issue: handleDownload gets current item to derive filename. 
      // If we are sharing a sidebar item (not current), handleDownload will download the WRONG item if we rely on getCurrent().
      
      // Fix: Store specific dialog context
      this.dialogShareContext = { hash: encoded, item: item };

      // Update buttons visibility
      const toggle = (el, show) => { if (el) el.style.display = show ? 'flex' : 'none'; };
      
      const showCopy = !!url && canShare;
      toggle(this.elements.shareDialogCopyBtn, showCopy);
      toggle(this.elements.shareDialogDownloadBtn, offerDownload);

      // Re-bind download button in dialog to use the context
      if (this.elements.shareDialogDownloadBtn) {
          // Remove old listeners? It's hard to remove anonymous listeners. 
          // We can just ensure handleDownload checks dialogShareContext first.
          // Or simpler: We create a new button or assume handleDownload knows what to do.
      }

      if (this.elements.shareDialog && typeof this.elements.shareDialog.showModal === 'function') {
        this.elements.shareDialog.showModal();
      } else {
        // Fallback for non-dialog browsers?
        if (canShare) {
             try {
                await navigator.clipboard.writeText(url);
                alert('Share link copied to clipboard.');
             } catch (copyError) {
                alert(url);
             }
        } else {
            alert('Item too large to share via URL.');
        }
      }
    } catch (err) {
      console.error('Share item error:', err);
      alert('Failed to share this item.');
    }
  }

  deleteItem(id) {
    const item = this.lost.getItem(id);
    if (!item) return;
    const title = this.getSidebarItemTitle(item, id, id === this.lost.currentId);
    const message = `Are you sure you want to delete "${title}"?\n\nThis action cannot be undone.`;
    if (!confirm(message)) return;

    if (!this.lost.delete(id)) {
      alert('You cannot delete the last item. Create a new item first.');
    }
  }
  
  // ----- Clipboard / Utilities -----

  isStandalone() {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
      return isStandalone;
  }

  updateImportButtonVisibility() {
      if (!this.elements.importBtn) return;

      const setting = this.config.sidebar.showImport;
      const isStandalone = this.isStandalone();

      // true = always show, false = never show, null/undefined = auto (only standalone)
      const shouldShow = (setting === true) || (setting !== false && isStandalone);

      if (shouldShow) {
          this.elements.importBtn.style.display = 'flex';
          if (isStandalone) {
             // Update label for standalone context where clipboard is primary
             this.elements.importBtn.childNodes[this.elements.importBtn.childNodes.length - 1].textContent = ' New from Clipboard';
          }
      } else {
          this.elements.importBtn.style.display = 'none';
      }
  }

  bindCopyButton(btn, input) {
      if (!btn || !input || btn.dataset.lostUiCopyBound === '1') return;
      btn.dataset.lostUiCopyBound = '1';
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(input.value);
          this.flashCopySuccess(btn);
        } catch (e) {
          input.select();
          document.execCommand('copy');
          this.flashCopySuccess(btn);
        }
      });
  }

  flashCopySuccess(btn) {
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove('copied');
      }, 2000);
  }

  async importItemFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        alert('Clipboard is empty. Copy an item URL first.');
        return;
      }

      // Basic URL check
      if (!text.includes('#')) {
          alert('No valid item URL found in clipboard.');
          return;
      }
      
      const url = new URL(text.trim());
      const hash = url.hash.slice(1);
      if (!hash) {
          alert('Invalid item URL: no data found.');
          return;
      }

      const result = await this.lost.importAndConfirm(hash);

      if (result) {
          this.closeSidebar();
      }

    } catch (err) {
      console.error('Clipboard import error:', err);
      alert('Failed to read from clipboard: ' + err.message);
    }
  }

  async handleDownload() {
      // Priority: 1. Dialog context (if open), 2. Current item (if footer/share box)
      // Actually we need to distinguish where the click came from or just prefer context if it's set and we assume dialog is modal.
      // Since dialog is modal, if context is set, it's likely the intended target.
      // But we should clear context when dialog closes.
      
      let item, hash;
      
      if (this.elements.shareDialog && this.elements.shareDialog.open && this.dialogShareContext) {
          item = this.dialogShareContext.item;
          hash = this.dialogShareContext.hash;
      } else {
          item = this.lost.getCurrent();
          if (this.lastShareDetail) {
              hash = this.lastShareDetail.hash;
          }
      }

      if (!item) return;

      const title = (item.title) ? item.title : 'lost-export';
      const safeTitle = title.replace(/[^a-z0-9\-_]/gi, '_');
      const ext = this.lost.fileExtension || 'lost';
      const filename = `${safeTitle}.${ext}`;

      if (this.lost.downloadFormat === 'json') {
          try {
              // Filter using lost filter before exporting
              const filtered = this.lost.filter(item);
              const jsonStr = JSON.stringify(filtered, null, 2);
              const blob = new Blob([jsonStr], { type: 'application/json' });
              this.triggerDownload(blob, filename);
          } catch (e) {
              console.error('JSON export failed:', e);
              alert('Failed to export JSON.');
          }
      } else {
          // Binary (default)
          if (!hash) {
              // Re-encode if missing
               const encoded = await this.lost.encode(item);
               if(encoded) this.downloadState(encoded, filename);
               else alert('Failed to encode item.');
               return;
          }
          this.downloadState(hash, filename);
      }
  }

  triggerDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  }

  downloadState(hash, filename) {
      if (!hash) return;
      
      let base64 = hash;
      // Strip prefix if present
      if (hash.startsWith('!') || hash.startsWith('$')) {
          base64 = hash.slice(1);
      }
      
      try {
          const binaryString = atob(base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
          }
          
          const blob = new Blob([bytes], { type: 'application/octet-stream' });
          this.triggerDownload(blob, filename);
      } catch (e) {
          console.error('Download failed:', e);
          alert('Failed to generate download file.');
      }
  }

  setupDropzone() {
      // Check if download is enabled/auto/yes? 
      const setting = this.lost.download;
      if (setting === 'no') return;

      const dropzone = document.createElement('div');
      dropzone.className = 'file-dropzone';
      dropzone.innerHTML = `
        <div class="dropzone-content">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"></path><path d="M14 2v6h6"></path><path d="m3 15 4-4 4 4"></path><path d="M7 11v11"></path></svg>
            <div>Drop file to import</div>
        </div>`;
      dropzone.style.display = 'none';
      document.body.appendChild(dropzone);
      this.elements.dropzone = dropzone;

      let dragCounter = 0;

      window.addEventListener('dragenter', (e) => {
          if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
             e.preventDefault();
             dragCounter++;
             dropzone.style.display = 'flex';
          }
      });

      window.addEventListener('dragover', (e) => {
          e.preventDefault(); 
      });

      window.addEventListener('dragleave', (e) => {
          dragCounter--;
          if (dragCounter <= 0) { 
              dragCounter = 0;
              dropzone.style.display = 'none';
          }
      });

      window.addEventListener('drop', async (e) => {
          e.preventDefault();
          dragCounter = 0;
          dropzone.style.display = 'none';

          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              const file = e.dataTransfer.files[0];
              
              // Validate Extension
              const ext = this.lost.fileExtension || 'lost';
              if (!file.name.toLowerCase().endsWith('.' + ext.toLowerCase())) {
                  alert(`Invalid file type. Please drop a .${ext} file.`);
                  return;
              }

              await this.importFile(file);
          }
      });
  }

  async importFile(file) {
      try {
          // First, try reading as text to see if it is JSON
          const text = await file.text();
          try {
              // Try parsing as JSON
              const data = JSON.parse(text);
              if (data && typeof data === 'object') {
                  // It's a JSON file
                  // Verify structure lightly? importAndConfirm handles validation via validator
                  // We need to simulate import result or use create/update directly.
                  // importAndConfirm expects hash.
                  // We can create a temporary "hash" or just reimplement the confirm logic here.
                  
                  // Reusing import logic by "mocking" importFromHash result:
                  // Actually, better to just reuse the confirm logic.
                  
                  const existing = this.lost.getItem(data.id);
                  const result = { 
                      status: existing ? 'exists_diff' : 'new', 
                      data: data,
                      existing: existing 
                  };
                  
                  if (existing && this.lost.constructor.deepEqual(this.lost.filter(existing), this.lost.filter(data))) {
                       result.status = 'exists_identical';
                  }

                  // Handle confirm
                  if (result.status === 'exists_identical') {
                      this.lost.setCurrent(data.id);
                      return;
                  }

                  const message = result.existing
                    ? `"${result.data.title}" already exists. Do you want to update it?`
                    : `Do you want to import: "${result.data.title}"`;
                  
                  if (confirm(message)) {
                      if (result.existing) this.lost.update(result.data.id, result.data);
                      else this.lost.create(result.data);
                      this.lost.setCurrent(result.data.id);
                  }
                  return;
              }
          } catch (jsonErr) {
              // Not JSON, continue to binary import
          }

          // Binary Import
          const arrayBuffer = await file.arrayBuffer();
          let binary = '';
          const bytes = new Uint8Array(arrayBuffer);
          const len = bytes.byteLength;
          for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          
          let prefix = '!'; 
          if (this.lost.compressionMethod === 'gzip') prefix = '$';
          else if (this.lost.compressionMethod === 'none') prefix = '';
          
          const hash = prefix + base64;
          await this.lost.importAndConfirm(hash);
          
      } catch (e) {
          console.error('Import file failed:', e);
          alert('Failed to read file.');
      }
  }
}
