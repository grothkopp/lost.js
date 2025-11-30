# Lost Framework

**LOST** - Local, Offline, Shareable Tools.
Lost is a lightweight, zero-dependency JavaScript library for building single-page applications (SPAs) that require state persistence, multiple item management, and URL-based state sharing.

It comes in two parts:
1. **`lost.js`**: Core logic for state management, `localStorage` persistence, and URL hash compression/encoding.
2. **`lost-ui.js`**: A responsive UI shell (Sidebar, Header, Footer) that binds to a `Lost` instance.

---

## 1. lost.js (Core)

The core library handles the data layer. It manages a collection of items (like documents, wheels, notes) and tracks which one is currently active.

### Usage

```javascript
import { Lost } from './lost.js';

const lost = new Lost({
  storageKey: 'my-app-storage-v1',  // Key for localStorage
  defaultData: { text: 'Hello' },   // Default content for new items
  validator: (data) => !!data.text, // Validate data before loading
});

// Load state from storage
lost.load();
```

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storageKey` | `string` | `'lost-store-v1'` | Key used in localStorage for the items map. |
| `currentKey` | `string` | `'lost-current-v1'` | Key used in localStorage for the active item ID. |
| `defaultData` | `object` | `{}` | The initial data structure for new items. |
| `validator` | `function` | `() => true` | Returns `false` to reject invalid data during import/load. |
| `filter` | `function` | `defaultFilter` | Cleans data before saving/encoding. **Default**: Excludes keys starting with `_` (runtime/local-only state). |
| `compressionMethod` | `string` | `'deflate'` | Method for URL state compression (`'deflate'`, `'gzip'`, or `'none'`). |

### Key Methods

*   **`load()`**: Initializes the library, loads data from storage, and sets up URL handling.
*   **`create(data)`**: Creates a new item, saves it, and sets it as active. Returns the new ID.
*   **`update(id, data)`**: Merges `data` into the item with `id`.
*   **`delete(id)`**: Deletes an item. Fails if it's the last item.
*   **`getCurrent()`**: Returns the currently active item object.
*   **`getAll()`**: Returns all items as an object map `{ [id]: item }`.
*   **`getShareUrl(id)`**: Returns a Promise resolving to a URL containing the compressed state of the item in the hash.

### Events

`Lost` extends `EventTarget`.

```javascript
lost.addEventListener('update', (e) => {
  const currentItem = e.detail; // The active item
  renderApp(currentItem);
});
```

---

## 2. lost-ui.js (UI Shell)

`LostUI` provides a standardized application layout with a header, a sidebar for managing items, and a footer for sharing. It automatically syncs with the `Lost` instance.

### Usage

```javascript
import { LostUI } from './lost-ui.js';

const ui = new LostUI(lost, {
  container: document.body,
  header: {
    title: 'My App',
  },
  sidebar: {
    heading: 'My Files',
    onNew: () => lost.create({ text: 'New File' }),
  }
});

ui.load(); // Initialize UI listeners
```

### Configuration

The configuration object allows deep customization of the UI components.

#### `header`
*   `visible` (bool): Show/hide header.
*   `title` (string): App title displayed in the header.
*   `extraContent` (func): Returns a DOM element to append to the header (e.g., a "Settings" button).
*   `showLightDarkButton` (bool): Built-in theme toggle.

#### `sidebar`
*   `visible` (bool): Show/hide sidebar.
*   `heading` (string): Title at the top of the sidebar list.
*   `onNew` (func): Callback when the "New" button is clicked.
*   `showImport` (bool|null): Show "Import from Clipboard" button. `null` (default) means auto-show if standalone/PWA.
*   `title` (func): `(item, id, isCurrent) => string`. Customize the title of items in the list.
*   `subline` (func): `(item, id, isCurrent) => string`. Customize the subtitle (e.g., item count or status).

#### `footer`
*   `visible` (bool): Show/hide the share footer.
*   `label` (string): Label text for the share box.

### Theming

`LostUI` supports light, dark, and system themes.
*   It sets `data-theme="light|dark"` on `document.documentElement`.
*   It sets `meta[name="theme-color"]` for mobile browser toolbars.

---

## URL State & Sharing

One of the most powerful features of **Lost** is URL-based state sharing.

1.  **Sharing**: `lost.getShareUrl(id)` compresses the item's JSON state into a base64 string and appends it to the URL hash (e.g., `mysite.com/#$H4sI...`).
2.  **Importing**: When a user visits a URL with a hash:
    *   `lost.js` detects the hash on load.
    *   It decompresses the data.
    *   It prompts the user: "Do you want to import: [Title]?".
    *   If imported, it creates a new item or updates an existing one if the ID matches.

## Local State vs. Shared State

Lost provides a built-in mechanism to keep certain data local-only (not included in the shared URL hash).

*   **Default Behavior**: Any property key starting with an underscore `_` (e.g., `_rotation`, `_activeTab`) is automatically filtered out by `Lost.defaultFilter` during the encoding process.
*   **Use Case**: Use this for transient UI state (like which tab is open, animation progress, or random seeds) that shouldn't overwrite the user's state when they import a link.

## Example Integration

```javascript
const lost = new Lost({
  defaultData: { counter: 0 }
});

const ui = new LostUI(lost, {
  header: { title: 'Counter App' },
  sidebar: {
    heading: 'Counters',
    onNew: () => lost.create({ counter: 0 }),
    title: (item) => `Counter: ${item.counter}`
  }
});

// Render your app logic
lost.addEventListener('update', (e) => {
  const item = e.detail;
  document.getElementById('app').innerText = item.counter;
});

// Initialize
lost.load();
ui.load();
```
