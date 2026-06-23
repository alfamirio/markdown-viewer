# Markdown viewer & editor

A minimalist, real-time Markdown editor and viewer packed into a single HTML file. Designed with a sleek dark interface, optimized to be fast, lightweight, and completely autonomous (no backend required).

## Core features

* **Side-by-side editing:** Interactive, draggable splitter panel to adjust the size of the editor and the preview layout.
* **Note management:** Create, rename, and delete multiple notes stored locally.
* **Local persistence:** Smart auto-saving to the browser's `localStorage` with a real-time status indicator.
* **Intelligent line numbering:** Adaptive line counter that correctly calculates visual line wraps (*word-wrap*).
* **Advanced export options:** Direct download in `.md` format or clean, paginated export to `.pdf` (with orphan line detection).
* **Keyboard shortcuts:** Full support for quick formatting, note navigation, and workspace management.
* **Optimized print mode:** Dedicated CSS `@media print` styles for a clean, professional paper or PDF output.

## Technologies used

The project is built using standard web technologies and external dependencies loaded via CDN:

* **Markup & styling:** Semantic HTML5 and custom CSS3 (using *Inter* and *JetBrains Mono* fonts).
* **Marked.js (v12.0.0):** For fast Markdown-to-HTML processing and rendering.
* **Highlight.js (v11.9.0):** Integrated syntax highlighting for code blocks.
* **html2canvas & jsPDF:** Client-side engines responsible for rasterization and precise PDF document generation.

## Project structure

The project follows a *Single File Application* (SFA) architecture:

```text
└── index.html      # Contains the HTML structure, embedded styles, and JS logic.

```

## Essential keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| **Bold** | `Ctrl + B` |
| *Italic* | `Ctrl + I` |
| Inline code | `Ctrl + `` |
| New note | `Ctrl + Alt + N` |
| Toggle sidebar | `Ctrl + \` |
| Next note | `Ctrl + ]` |
| Previous note | `Ctrl + [` |
| Export PDF | `Ctrl + P` |
| Show help dialog | `?` |

## Usage notes and warnings

> **Storage limitation:** Notes are saved exclusively in your browser's `localStorage`. If you clear site data or browser cache, your notes will be deleted. It is highly recommended to regularly export backups using the **↓ .md** button.

