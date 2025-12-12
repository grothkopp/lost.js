# AI Notebook

An offline-first, local AI playground and notebook environment built on the LOST framework.

## Overview

AI Notebook allows you to create interactive notebooks with mixed cell types:
- **Markdown**: For notes and documentation.
- **Prompt**: For interacting with LLMs (OpenAI, Anthropic, OpenRouter, or custom).
- **Code**: For executing JavaScript in a secure sandbox.
- **Variables**: For defining static data to be reused.

It features template expansion (`{{ cell_name }}`), JSON processing, and local persistence.

## Architecture

The codebase is modularized by responsibility:

### Core Application
- **`app_ainotebook.js`**: The main entry point. Initializes the `AiNotebookApp` class, sets up the LOST framework, handles global state, and coordinates managers.
- **`ainotebook.html`**: The main HTML structure.

### Managers
- **`cells.js`**:
    - `CellManager`: Handles CRUD operations for cells (add, delete, move) and manages state updates including staleness propagation.
    - `CellRenderer`: Handles the DOM rendering of cells, updating outputs, and managing UI state like focus and expansion.
- **`cell_code.js`**: `CodeCellManager` handles the execution of JavaScript code cells using sandboxed `<iframe>` elements for security.
- **`cell_prompt.js`**: `PromptCellManager` manages the execution of LLM prompt cells, including template expansion, API calls, and request cancellation.
- **`llm.js`**: `LlmManager` handles LLM provider configuration, model fetching/caching, and performing the actual API calls (OpenAI, Claude, etc.).
- **`template.js`**: `TemplateManager` parses and resolves template variables (`{{ ... }}`), supporting reference by name, ID, or index, and JSON path access.

### UI Components
- **`ui.js`**: Reusable UI components like the Model Picker, Parameter Editor, and Log Overlay.
- **`settings.js`**: Manages the Settings Dialog for configuring LLM providers and Environment Variables.

### Utilities
- **`utils.js`**: Helper functions for ID generation, text formatting, and DOM manipulation.

## Data Flow

1.  **State Change**: A user action (editing text, adding cell) triggers a `lost.update()`.
2.  **Event Loop**: `AiNotebookApp` listens for the `update` event.
3.  **Rendering**: `renderNotebook()` is called. It delegates to `CellRenderer` to update the DOM.
    - If a cell is being edited, full re-render is skipped to preserve focus, but status updates are applied via `updateStaleStatus`.
4.  **Execution**:
    - **Prompts**: `PromptCellManager` expands templates using current state, calls `LlmManager`, and updates the cell with the response.
    - **Code**: `CodeCellManager` creates a sandbox, executes code, and updates the cell with the result.
5.  **Staleness**: When a cell's content changes, `CellManager.applyStaleness` marks dependent cells as stale based on the reference graph.

## Storage

All data is stored locally in the browser using `localStorage` via the LOST framework.
- **Notebook Data**: `app-ainotebook-v1`
- **LLM Settings**: `ainotebook-llm-settings-v1` (includes API keys and ENV vars)

## Security

- **API Keys**: Stored locally in `localStorage`. Never sent to a server other than the LLM provider.
- **Code Execution**: Runs in a sandboxed `<iframe>` with `allow-scripts` but no `allow-same-origin`, preventing access to the parent DOM, cookies, or storage.
