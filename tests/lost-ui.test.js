/**
 * Tests for lost-ui.js UI framework.
 */
import { describe, it, beforeEach, afterEach, assert } from './test-runner.js';
import { Lost } from '/lost.js';
import { LostUI } from '/lost-ui.js';

// Mock localStorage
const mockStorage = {
  _data: {},
  getItem(key) { return this._data[key] ?? null; },
  setItem(key, val) { this._data[key] = val; },
  removeItem(key) { delete this._data[key]; },
  clear() { this._data = {}; }
};

const originalLocalStorage = window.localStorage;

describe('LostUI - Default Configuration', () => {
  it('has sensible default config', () => {
    const defaults = LostUI.defaultConfig;
    
    assert.equal(defaults.header.visible, true, 'Header visible by default');
    assert.equal(defaults.header.title, 'Lost App', 'Default header title');
    assert.equal(defaults.sidebar.visible, true, 'Sidebar visible by default');
    assert.equal(defaults.sidebar.heading, 'Items', 'Default sidebar heading');
    assert.equal(defaults.footer.visible, true, 'Footer visible by default');
  });

  it('sidebar.title function handles missing title', () => {
    const defaults = LostUI.defaultConfig;
    const titleFn = defaults.sidebar.title;
    
    assert.equal(titleFn(null), 'Untitled Item', 'Null item');
    assert.equal(titleFn({}), 'Untitled Item', 'Empty object');
    assert.equal(titleFn({ title: '' }), 'Untitled Item', 'Empty string');
    assert.equal(titleFn({ title: '  ' }), 'Untitled Item', 'Whitespace only');
    assert.equal(titleFn({ title: 'My Item' }), 'My Item', 'Valid title');
  });

  it('sidebar.subline returns empty string by default', () => {
    const defaults = LostUI.defaultConfig;
    assert.equal(defaults.sidebar.subline(), '', 'Default subline is empty');
  });
});

describe('LostUI - Construction', () => {
  let container, lost;

  beforeEach(() => {
    mockStorage.clear();
    Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true });
    
    container = document.createElement('div');
    container.id = 'test-container';
    container.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;';
    document.body.appendChild(container);
    
    lost = new Lost({
      storageKey: 'test-ui-' + Date.now(),
      defaultData: { title: 'Test Item' }
    });
    lost.items = {};
    lost.create({ title: 'Initial' });
  });

  afterEach(() => {
    container.remove();
    Object.defineProperty(window, 'localStorage', { value: originalLocalStorage, writable: true });
  });

  it('creates header when visible', () => {
    const ui = new LostUI(lost, {
      container,
      header: { visible: true, title: 'Test App' }
    });
    
    const header = container.querySelector('header');
    assert.notNull(header, 'Header element created');
    
    const h1 = header.querySelector('h1');
    assert.notNull(h1, 'Title element created');
    assert.equal(h1.textContent, 'Test App', 'Title text set');
  });

  it('skips header when not visible', () => {
    const ui = new LostUI(lost, {
      container,
      header: { visible: false }
    });
    
    const header = container.querySelector('header');
    assert.isNull(header, 'No header when disabled');
  });

  it('creates sidebar when visible', () => {
    const ui = new LostUI(lost, {
      container,
      sidebar: { visible: true, heading: 'My Items' }
    });
    
    const sidebar = container.querySelector('.sidebar');
    assert.notNull(sidebar, 'Sidebar element created');
    
    const heading = sidebar.querySelector('.sidebar-header span');
    assert.notNull(heading, 'Sidebar heading created');
    assert.equal(heading.textContent, 'My Items', 'Heading text set');
  });

  it('creates sidebar overlay', () => {
    const ui = new LostUI(lost, {
      container,
      sidebar: { visible: true }
    });
    
    const overlay = container.querySelector('.sidebar-overlay');
    assert.notNull(overlay, 'Overlay element created');
  });

  it('creates footer with share box', () => {
    const ui = new LostUI(lost, {
      container,
      footer: { visible: true, label: 'Share:' }
    });
    
    const footer = container.querySelector('.share-footer');
    assert.notNull(footer, 'Footer element created');
    
    const label = footer.querySelector('.share-box-label');
    assert.equal(label.textContent, 'Share:', 'Label text set');
    
    const input = footer.querySelector('.share-box-input');
    assert.notNull(input, 'Share input created');
    assert.ok(input.readOnly, 'Share input is readonly');
  });

  it('creates share dialog', () => {
    const ui = new LostUI(lost, { container });
    
    const dialog = container.querySelector('#shareDialog');
    assert.notNull(dialog, 'Share dialog created');
  });

  it('adds extraContent to header', () => {
    const ui = new LostUI(lost, {
      container,
      header: {
        visible: true,
        extraContent: () => {
          const btn = document.createElement('button');
          btn.id = 'custom-btn';
          btn.textContent = 'Custom';
          return btn;
        }
      }
    });
    
    const btn = container.querySelector('#custom-btn');
    assert.notNull(btn, 'Extra content added');
    assert.equal(btn.textContent, 'Custom', 'Extra content correct');
  });

  it('adds New button when onNew provided', () => {
    let newClicked = false;
    
    const ui = new LostUI(lost, {
      container,
      sidebar: {
        visible: true,
        showImport: false, // Disable import button to avoid confusion
        onNew: () => { newClicked = true; }
      }
    });
    
    // Find all buttons with class and get the one with 'New' text
    const buttons = container.querySelectorAll('.new-item-btn');
    assert.ok(buttons.length > 0, 'New button created');
    const newBtn = Array.from(buttons).find(b => b.innerHTML.includes('New'));
    assert.notNull(newBtn, 'Found button with New text');
  });
});

describe('LostUI - Sidebar Operations', () => {
  let container, lost, ui;

  beforeEach(() => {
    mockStorage.clear();
    Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true });
    
    container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;';
    document.body.appendChild(container);
    
    lost = new Lost({
      storageKey: 'test-sidebar-' + Date.now(),
      defaultData: { title: 'Test' }
    });
    lost.items = {};
    lost.create({ title: 'Item 1' });
    lost.create({ title: 'Item 2' });
    
    ui = new LostUI(lost, {
      container,
      sidebar: { visible: true }
    });
  });

  afterEach(() => {
    container.remove();
    Object.defineProperty(window, 'localStorage', { value: originalLocalStorage, writable: true });
  });

  it('toggleSidebar opens sidebar', () => {
    ui.toggleSidebar();
    
    assert.ok(ui.elements.sidebar.classList.contains('open'), 'Sidebar has open class');
    assert.ok(ui.elements.sidebarOverlay.classList.contains('show'), 'Overlay has show class');
  });

  it('closeSidebar closes sidebar', () => {
    ui.toggleSidebar(); // Open first
    ui.closeSidebar();
    
    assert.ok(!ui.elements.sidebar.classList.contains('open'), 'Sidebar open class removed');
    assert.ok(!ui.elements.sidebarOverlay.classList.contains('show'), 'Overlay show class removed');
  });

  it('updateSidebarList renders items', () => {
    ui.updateSidebarList();
    
    const items = container.querySelectorAll('.item-item');
    assert.equal(items.length, 2, 'Two items rendered');
  });

  it('getSidebarItemTitle uses custom function', () => {
    ui.config.sidebar.title = (item) => `Custom: ${item.title}`;
    
    const title = ui.getSidebarItemTitle({ title: 'Test' }, 'id1', false);
    assert.equal(title, 'Custom: Test', 'Custom title function used');
  });

  it('getSidebarItemTitle falls back to item.title', () => {
    ui.config.sidebar.title = () => null;
    
    const title = ui.getSidebarItemTitle({ title: 'Fallback' }, 'id1', false);
    assert.equal(title, 'Fallback', 'Fallback to item.title');
  });

  it('getSidebarItemSubline uses custom function', () => {
    ui.config.sidebar.subline = (item) => `Count: ${item.count}`;
    
    const subline = ui.getSidebarItemSubline({ count: 5 }, 'id1', false);
    assert.equal(subline, 'Count: 5', 'Custom subline function used');
  });
});

describe('LostUI - Theme Management', () => {
  let container, lost, ui;

  beforeEach(() => {
    mockStorage.clear();
    Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true });
    
    container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;';
    document.body.appendChild(container);
    
    lost = new Lost({ storageKey: 'test-theme-' + Date.now() });
    lost.items = {};
    lost.create({ title: 'Theme Test' });
  });

  afterEach(() => {
    container.remove();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-resolved');
    Object.defineProperty(window, 'localStorage', { value: originalLocalStorage, writable: true });
  });

  it('initializes theme from config', () => {
    ui = new LostUI(lost, {
      container,
      theme: 'dark'
    });
    
    // Theme should be applied
    const theme = document.documentElement.dataset.theme;
    assert.ok(theme === 'dark' || theme === 'system', 'Theme initialized');
  });

  it('effectiveTheme returns light or dark for explicit themes', () => {
    ui = new LostUI(lost, { container });
    
    assert.equal(ui.effectiveTheme('light'), 'light', 'Light returns light');
    assert.equal(ui.effectiveTheme('dark'), 'dark', 'Dark returns dark');
  });

  it('effectiveTheme resolves system based on preference', () => {
    ui = new LostUI(lost, { container });
    
    const result = ui.effectiveTheme('system');
    assert.ok(result === 'light' || result === 'dark', 'System resolves to light or dark');
  });

  it('toggleTheme cycles through themes', () => {
    ui = new LostUI(lost, { container, showLightDarkButton: true });
    
    const initial = document.documentElement.dataset.theme;
    ui.toggleTheme();
    const after = document.documentElement.dataset.theme;
    
    assert.notEqual(initial, after, 'Theme changed after toggle');
  });

  it('creates theme toggle button when enabled', () => {
    ui = new LostUI(lost, {
      container,
      showLightDarkButton: true
    });
    
    assert.notNull(ui.elements.themeBtn, 'Theme button exists');
  });

  it('hides theme toggle button when disabled', () => {
    ui = new LostUI(lost, {
      container,
      showLightDarkButton: false
    });
    
    assert.isNull(ui.elements.themeBtn, 'No theme button');
  });
});

describe('LostUI - Share Box', () => {
  let container, lost, ui;

  beforeEach(() => {
    mockStorage.clear();
    Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true });
    
    container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;';
    document.body.appendChild(container);
    
    lost = new Lost({ storageKey: 'test-share-' + Date.now() });
    lost.items = {};
    lost.create({ title: 'Share Test' });
    
    ui = new LostUI(lost, {
      container,
      footer: { visible: true }
    });
  });

  afterEach(() => {
    container.remove();
    Object.defineProperty(window, 'localStorage', { value: originalLocalStorage, writable: true });
  });

  it('updateShareBox sets URL in input', () => {
    ui.updateShareBox({ url: 'https://example.com#abc', canShare: true });
    
    assert.equal(ui.elements.shareInput.value, 'https://example.com#abc', 'URL set in input');
  });

  it('updateShareBox handles string input', () => {
    ui.updateShareBox('https://legacy.com#123');
    
    assert.equal(ui.elements.shareInput.value, 'https://legacy.com#123', 'Legacy string format works');
  });

  it('updateShareBox shows placeholder when cannot share', () => {
    ui.updateShareBox({ url: null, canShare: false });
    
    assert.equal(ui.elements.shareInput.value, '', 'Input empty');
    assert.ok(ui.elements.shareInput.placeholder.includes('too large'), 'Placeholder shown');
  });

  it('updateShareBox shows download button when offered', () => {
    ui.updateShareBox({ url: null, canShare: false, offerDownload: true });
    
    assert.equal(ui.elements.downloadBtn.style.display, 'flex', 'Download button visible');
  });

  it('updateShareBox hides download button when not offered', () => {
    ui.updateShareBox({ url: 'https://a.com', canShare: true, offerDownload: false });
    
    assert.equal(ui.elements.downloadBtn.style.display, 'none', 'Download button hidden');
  });

  it('setTitle updates header title', () => {
    ui.setTitle('New Title');
    
    assert.equal(ui.elements.title.textContent, 'New Title', 'Title updated');
  });

  it('setShareUrl updates input directly', () => {
    ui.setShareUrl('https://direct.com');
    
    assert.equal(ui.elements.shareInput.value, 'https://direct.com', 'URL set directly');
  });
});

describe('LostUI - Event Handling', () => {
  let container, lost, ui;

  beforeEach(() => {
    mockStorage.clear();
    Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true });
    
    container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;';
    document.body.appendChild(container);
    
    lost = new Lost({
      storageKey: 'test-events-' + Date.now(),
      defaultData: { title: 'Test' }
    });
    lost.items = {};
    lost.create({ title: 'Event Test' });
    
    ui = new LostUI(lost, {
      container,
      sidebar: { visible: true }
    });
  });

  afterEach(() => {
    container.remove();
    Object.defineProperty(window, 'localStorage', { value: originalLocalStorage, writable: true });
  });

  it('responds to lost update event', () => {
    lost.update(lost.currentId, { title: 'Updated Title' });
    
    // UI should update title
    assert.equal(ui.elements.title.textContent, 'Updated Title', 'Title updated from event');
  });

  it('overlay click closes sidebar', () => {
    ui.toggleSidebar();
    assert.ok(ui.elements.sidebar.classList.contains('open'), 'Sidebar open');
    
    ui.elements.sidebarOverlay.click();
    assert.ok(!ui.elements.sidebar.classList.contains('open'), 'Sidebar closed by overlay click');
  });
});

describe('LostUI - Utility Methods', () => {
  let container, lost, ui;

  beforeEach(() => {
    mockStorage.clear();
    Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true });
    
    container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;';
    document.body.appendChild(container);
    
    lost = new Lost({ storageKey: 'test-util-' + Date.now() });
    lost.items = {};
    lost.create({ title: 'Util Test' });
    
    ui = new LostUI(lost, { container });
  });

  afterEach(() => {
    container.remove();
    Object.defineProperty(window, 'localStorage', { value: originalLocalStorage, writable: true });
  });

  it('flashCopySuccess changes button text temporarily', async () => {
    const btn = document.createElement('button');
    btn.textContent = 'Copy';
    
    ui.flashCopySuccess(btn);
    
    assert.equal(btn.textContent, 'Copied!', 'Text changed to Copied');
    assert.ok(btn.classList.contains('copied'), 'Has copied class');
    
    // Wait for reset
    await new Promise(r => setTimeout(r, 2100));
    assert.equal(btn.textContent, 'Copy', 'Text reset');
    assert.ok(!btn.classList.contains('copied'), 'Copied class removed');
  });
});
