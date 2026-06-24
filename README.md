# Markdown Viewer & Editor

A minimalist, real-time Markdown editor and viewer. Designed with a sleek dark interface, optimized to be fast, lightweight, and completely autonomous — no backend required.

## Core features

* **Side-by-side editing:** Interactive, draggable splitter panel to adjust the size of the editor and preview panes. Switch between editor-only, split, and preview-only layouts.
* **Note management:** Create, rename, and delete multiple notes stored locally. Inline renaming directly from the sidebar — click the active note or press the pencil icon.
* **Table of contents:** Auto-generated TOC panel in the sidebar, derived from document headings (H1–H6), with live active-heading tracking as you scroll. Resizable via a draggable splitter between the notes list and TOC.
* **Local persistence:** Smart auto-saving to the browser's `localStorage` with a real-time status indicator (saved / unsaved / storage full).
* **CodeMirror 6 editor:** Full-featured code editor with line numbers, active-line highlighting, bracket matching, undo/redo history, and a cursor-aware selection theme. Syntax highlighting covers Markdown formatting markers as well as fenced code blocks in dozens of languages.
* **Mermaid diagram support:** Fenced ` ```mermaid ``` ` blocks are rendered as diagrams directly in the preview panel, using a dark theme matched to the app's palette.
* **Rich syntax highlighting:** Toggle-able per-token coloring for headings (each level a distinct hue), bold, italic, strikethrough, inline code, blockquotes, links, URLs, lists, horizontal rules, and fenced code blocks with full language-aware highlighting.
* **Toolbar formatting:** Two-row toolbar with one-click buttons for bold, italic, strikethrough, inline code, H1–H3, unordered list, ordered list, blockquote, code block, horizontal rule, and link insertion.
* **Visual table picker:** Interactive 8×8 grid popup for inserting Markdown tables — hover to pick dimensions, click to insert.
* **Advanced export options:** Upload or download `.md` files, export a clean standalone `.html` file, copy raw Markdown to clipboard, and generate paginated `.pdf` output with selectable text and embedded fonts.
* **Word wrap toggle:** Independently controls wrapping in both the editor and preview, including horizontal scrolling for code blocks when wrap is off.
* **Live word & line count:** Real-time statistics displayed in the toolbar status bar.
* **Keyboard shortcuts:** Full support for formatting, layout switching, note navigation, file operations, and workspace management.
* **Tooltip system:** Context-sensitive tooltips on every toolbar button and sidebar control, displayed on hover.
* **Optimized print mode:** Dedicated `@media print` styles for clean, professional paper output (white background, print-safe colors, URL expansion for links, orphan/widow control).
* **Reset & safety:** A dismissible warning footer reminds users of localStorage limitations. A one-click reset button (with confirmation) wipes all notes and app state.

## Technologies used

Built using standard web technologies and external dependencies loaded via CDN:

* **Markup & styling:** Semantic HTML5 and custom CSS3 (using *Inter* and *JetBrains Mono* fonts served locally).
* **Bootstrap 5.3.3:** Layout utilities and modal components.
* **CodeMirror 6:** Full-featured editor engine (via ESM from esm.sh). Provides line numbers, syntax highlighting, bracket matching, history, and Markdown language support with embedded code language detection.
* **Marked.js (v12.0.0):** Fast Markdown-to-HTML processing and rendering.
* **Mermaid (v10.9.0):** Client-side diagram rendering for ` ```mermaid ``` ` fenced blocks.
* **jsPDF (v2.5.1):** Client-side PDF generation with embedded local fonts for full Unicode support (ñ, á, etc.).

## Project structure

```text
├── index.html          # HTML structure and app shell
├── styles.css          # All styling and design tokens
├── app.js              # Application logic
├── cm-editor.js        # CodeMirror 6 setup and textarea shim
└── fonts/
    ├── Inter-Regular.ttf
    ├── Inter-Bold.ttf
    ├── Inter-Italic.ttf
    └── JetBrainsMono-Regular.ttf
```

## Keyboard shortcuts

Use `?` to view keyboard shortcuts.

## Usage notes and warnings

> **Storage limitation:** Notes are saved exclusively in your browser's `localStorage`. If you clear site data or browser cache, your notes will be deleted. Export backups regularly using the **↓ .md** button or `Ctrl + Shift + S`.

> **No warranty:** This tool is provided as-is, with no warranty or responsibility of any kind. For educational use.
