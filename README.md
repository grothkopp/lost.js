# 🧭 LOST - Local, Offline, Shareable Tools

**A lightweight, zero-dependency framework for building shareable "vibe coding" apps and prototypes.**

---

## Why LOST?

We live in an era where building a simple app often requires a complex build chain, a backend database, authentication services, and hosting infrastructure. But what if you just want to code a small utility, a game, or a prototype and share it with a friend?

**LOST** brings back the simplicity of the web:
*   **Zero Dependencies**: No `npm install`, no build steps (unless you want them). Just drop in the JS files.
*   **No Backend Required**: State is persisted locally in the browser (`localStorage`).
*   **Instant Sharing**: Share your app state via URL. The entire state is compressed and encoded into the hash (e.g., `myapp.html#$H4s...`). No database needed.
*   **Vibe Coding Friendly**: Perfect for LLM-assisted coding. The architecture is simple enough for AI agents to understand and generate complete apps in one go.

## Features

*   📦 **State Management**: Simple `create`, `read`, `update`, `delete` API.
*   💾 **Persistence**: Auto-saves to `localStorage`.
*   🔗 **Shareable URLs**: built-in compression (gzip/deflate) for sharing state.
*   🎨 **UI Shell**: Includes a responsive sidebar, header, and settings dialog support.
*   🌓 **Theming**: Built-in support for Light, Dark, and System themes.
*   🙈 **Local-Only State**: Prefix keys with `_` (e.g., `_temp`) to keep them local and private.

## Getting Started

1.  Clone this repo.
2.  Copy `lost.js`, `lost-ui.js`, and `lost.css` to your project.
3.  Create your `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="lost.css">
</head>
<body>
    <script type="module">
        import { Lost } from './lost.js';
        import { LostUI } from './lost-ui.js';

        // 1. Initialize State
        const lost = new Lost({
            defaultData: { count: 0 }
        });

        // 2. Initialize UI
        new LostUI(lost, {
            header: { title: 'My Vibe App' },
            sidebar: {
                heading: 'Counters',
                onNew: () => lost.create({ count: 0 }),
                title: (item) => `Count: ${item.count}`
            }
        });

        // 3. App Logic
        lost.addEventListener('update', (e) => {
            const item = e.detail;
            if(item) console.log('Current count:', item.count);
        });

        lost.load();
    </script>
</body>
</html>
```

## Documentation

*   [Framework Documentation (LOST.md)](LOST.md)
*   [Agent Instructions (AGENTS.md)](AGENTS.md) - Prompts to help AI build apps for you.

## License

MIT License

Copyright (c) 2025 Stefan Grothkopp

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.