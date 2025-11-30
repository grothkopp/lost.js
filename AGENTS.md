# Instructions for AI Agents: Creating a LOST App

When asked to create a new application using the LOST Framework (Local, Offline, Shareable Tools), follow these guidelines to ensure consistency, performance, and full feature utilization.

## 1. Project Structure & Naming

All LOST apps are single-page applications (SPAs) served from a subfolder or root.

**Naming Convention:**
- App Name: `[app-name]` (e.g., `counter`, `todo`, `dice`)
- HTML File: `[app-name].html`
- JS File: `app_[app-name].js`
- CSS File: `app_[app-name].css`
- Manifest: `[app-name].webmanifest`
- Assets: `[app-name]-icon-192.png`, etc.

**Directory Layout:**
```text
/
  lost.js       (Core Framework)
  lost-ui.js    (UI Shell)
  lost.css      (UI Styles)
  [app-name]/
    [app-name].html
    app_[app-name].js
    app_[app-name].css
    [app-name].webmanifest
    icon.png
```

---

## 2. The Base HTML (`[app-name].html`)

The HTML should be minimal. It must import `lost.css`, your app's CSS, and the frameworks as modules.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <meta name="theme-color" content="#ffffff">
    <title>App Name</title>
    
    <!-- Manifest for PWA -->
    <link rel="manifest" href="[app-name].webmanifest">
    
    <!-- Framework Styles -->
    <link rel="stylesheet" href="/lost.css">
    <!-- App Styles -->
    <link rel="stylesheet" href="app_[app-name].css">
</head>
<body>
    <!-- App Specific Content Area -->
    <main id="app-stage">
        <!-- Dynamic content goes here -->
        <div id="output">0</div>
        <button id="incrementBtn">Count</button>
    </main>

    <!-- Configuration Dialog (Standard Pattern) -->
    <dialog id="configDialog">
        <div class="dialog-header">Settings</div>
        <div class="dialog-body">
            <label>
                Title:
                <input type="text" id="configTitle">
            </label>
        </div>
        <div class="dialog-footer">
            <button id="configCloseBtn">Close</button>
        </div>
    </dialog>

    <!-- Framework Modules -->
    <script type="module" src="/lost.js"></script>
    <script type="module" src="/lost-ui.js"></script>
    <script type="module" src="app_[app-name].js"></script>
</body>
</html>
```

---

## 3. The Application Logic (`app_[app-name].js`)

The entry point should be a class that initializes `Lost` and `LostUI`.

### Step 1: Define Defaults
```javascript
import { Lost } from '/lost.js';
import { LostUI } from '/lost-ui.js';

const DEFAULT_DATA = {
    title: 'New Item',
    count: 0
};
```

### Step 2: Initialize Class
```javascript
class CounterApp {
    constructor() {
        // 1. Setup Data Layer
        this.lost = new Lost({
            storageKey: 'app-counter-v1',
            defaultData: DEFAULT_DATA,
            // Validate incoming data to prevent corruption
            validator: (data) => typeof data.count === 'number'
        });

        // 2. Listen for State Changes
        this.lost.addEventListener('update', (e) => this.render(e.detail));

        // 3. Setup UI Shell
        this.ui = new LostUI(this.lost, {
            container: document.body,
            header: {
                title: 'Counter App',
                // Add a settings button to the header
                extraContent: () => {
                    const btn = document.createElement('button');
                    btn.innerHTML = '⚙️';
                    btn.onclick = () => this.openConfig();
                    return btn;
                }
            },
            sidebar: {
                heading: 'Counters',
                onNew: () => this.createItem(),
                // Custom list item display
                title: (item) => item.title || 'Untitled',
                subline: (item) => `Current count: ${item.count}`
            }
        });

        // 4. Bind App Elements
        this.elements = {
            output: document.getElementById('output'),
            btn: document.getElementById('incrementBtn'),
            dialog: document.getElementById('configDialog'),
            configTitle: document.getElementById('configTitle'),
            closeDialog: document.getElementById('configCloseBtn')
        };

        this.bindEvents();
        this.init();
    }

    async init() {
        this.lost.load(); // Load data
        this.ui.load();   // Init UI
    }
```

### Step 3: Events & State Updates
**CRITICAL**: Never modify `this.lost.getCurrent()` directly. Always use `this.lost.update()`.

```javascript
    bindEvents() {
        // App Action
        this.elements.btn.addEventListener('click', () => {
            const item = this.lost.getCurrent();
            if (item) {
                this.lost.update(item.id, { count: item.count + 1 });
            }
        });

        // Config Dialog Handling
        this.elements.closeDialog.addEventListener('click', () => {
            this.elements.dialog.close();
        });

        // Live Update from Config
        this.elements.configTitle.addEventListener('input', (e) => {
            const item = this.lost.getCurrent();
            if (item) {
                this.lost.update(item.id, { title: e.target.value });
            }
        });
    }

    createItem() {
        this.lost.create({ ...DEFAULT_DATA, title: 'New Counter' });
    }
```

### Step 4: Rendering
The `render` method is called automatically via the `update` event.

```javascript
    render(item) {
        if (!item) return;
        this.elements.output.textContent = item.count;
        
        // Sync dialog if open (optional, but good UX)
        if (this.elements.dialog.open) {
            if (document.activeElement !== this.elements.configTitle) {
                this.elements.configTitle.value = item.title;
            }
        }
    }
}

new CounterApp();
```

---

## 4. Web App Manifest (`[app-name].webmanifest`)

Ensure the app is installable.

```json
{
  "name": "Counter App",
  "short_name": "Counter",
  "start_url": "./[app-name].html",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    {
      "src": "icon.png",
      "sizes": "192x192",
      "type": "image/png"
    }
  ]
}
```

## 5. Best Practices for Agents

1.  **Zero Dependencies**: Do not import external libraries unless absolutely necessary. Use vanilla JS.
2.  **State Management**: Trust `lost.js` for state. Do not create parallel state variables for things that should persist.
3.  **Local/Runtime State**: Prefix property names with `_` (e.g., `_rotation`, `_isOpen`) to prevent them from being shared/exported in the URL. The default filter excludes these automatically.
4.  **CSS Variables**: Use `lost.css` variables (e.g., `--bg-color`, `--text-color`) to support Light/Dark modes automatically.
5.  **Error Handling**: Add basic checks (`if (!item) return`) in render and event handlers.
6.  **Compression**: `lost.js` handles compression automatically. You just need to call `lost.getShareUrl()`.

## 6. Custom Configuration Dialog Example

The standard pattern for a settings dialog involves:
1.  A `<dialog>` element in HTML.
2.  An `extraContent` button in `LostUI` header to `showModal()`.
3.  Input listeners that call `lost.update()` immediately (live preview) or on specific actions.

**HTML:**
```html
<dialog id="cfg">
  <h3>Settings</h3>
  <label>Color: <input type="color" id="cfgColor"></label>
  <button id="cfgClose">Done</button>
</dialog>
```

**JS:**
```javascript
// in constructor
this.ui = new LostUI(this.lost, {
    header: {
        extraContent: () => {
            const b = document.createElement('button');
            b.textContent = '⚙️';
            b.className = 'action-btn'; // built-in class
            b.onclick = () => {
                // Sync inputs before opening
                const item = this.lost.getCurrent();
                document.getElementById('cfgColor').value = item.color;
                document.getElementById('cfg').showModal();
            };
            return b;
        }
    }
});

// in bindEvents
document.getElementById('cfgColor').addEventListener('input', (e) => {
    const item = this.lost.getCurrent();
    this.lost.update(item.id, { color: e.target.value });
});
```
