function boot() {
// ═══════════════════════════════════════════════════
//  Constants & element refs
// ═══════════════════════════════════════════════════
const NOTES_INDEX_KEY = 'md_notes_index';   // JSON array of {id, name}
const CONFIG_KEY      = 'md_config';         // UI state: wrap, highlight, sidebar, toc, viewMode
const noteContent     = id => 'md_note_' + id;

const editor       = window.editor; // CodeMirror 6 compatibility shim — see module script above
const preview      = document.getElementById('preview');
const saveEl       = document.getElementById('save-indicator');
const wordEl       = document.getElementById('word-count');
const lineEl       = document.getElementById('line-count');
const btnWrap      = document.getElementById('btn-wrap');
const btnHighlight = document.getElementById('btn-highlight');
const notesList    = document.getElementById('notes-list');
const btnSidebar   = document.getElementById('btn-sidebar');
document.getElementById('btn-new-note').addEventListener('click', () => createNote(undefined, ''));
document.getElementById('btn-new-note-template').addEventListener('click', () => createNote());

function activeNoteName() {
  const note = getActiveNote();
  return (note && note.name.trim()) ? note.name.trim() : 'note';
}

let isInitializing = true;
let layoutEnabled  = true;

// ═══════════════════════════════════════════════════
//  Notes state
// ═══════════════════════════════════════════════════
let notes      = [];   // [{id, name}, …]
let activeId   = null;
let saveTimer;

function genId() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

// ── Persistence ────────────────────────────────────
function saveIndex() {
  localStorage.setItem(NOTES_INDEX_KEY, JSON.stringify(notes));
}

function saveContent(id, text) {
  try {
    localStorage.setItem(noteContent(id), text);
    updateLocalStorageUsage();
  } catch(e) {
    // Stop the autosave timer — no point retrying when storage is full.
    clearTimeout(saveTimer);
    saveTimer = null;
    // Show a persistent error state (both text and colour) so the user
    // knows the note was NOT saved, not just "unsaved".
    saveEl.className   = 'unsaved';
    saveEl.textContent = '✕ storage full';
  }
}

function loadContent(id) {
  return localStorage.getItem(noteContent(id)) ?? '';
}

// ── Create / delete ────────────────────────────────
function createNote(name, content) {
  const id = genId();
  name = name || 'Untitled ' + (notes.length + 1);
  notes.push({ id, name, createdAt: new Date().toISOString() });
  saveIndex();
  saveContent(id, content ?? DEFAULT_CONTENT(name));
  switchNote(id);
  // Trigger rename button so the new note name is immediately editable
  setTimeout(() => {
    const renameBtn = notesList.querySelector(`.note-item[data-id="${id}"] .note-rename`);
    if (renameBtn) renameBtn.click();
  }, 50);
  return id;
}

function deleteNote(id) {
  // Cancel any pending autosave — if this is the active note, the timer could
  // fire after activeId has changed and write content to the wrong note.
  clearTimeout(saveTimer);
  saveTimer = null;

  const note = notes.find(n => n.id === id);
  const name = note ? note.name : 'this note';

  if (notes.length === 1) {
    // Last note: confirm clear rather than delete
    if (!confirm(`Clear the contents of "${name}"?\n\nThe note itself will be kept (it's your last one).`)) return;
    editor.value = '';
    render();
    scheduleSave();
    return;
  }

  if (!confirm(`Delete "${name}"?`)) return;

  const idx = notes.findIndex(n => n.id === id);
  notes.splice(idx, 1);
  localStorage.removeItem(noteContent(id));
  saveIndex();
  // Switch to adjacent note
  const nextIdx = Math.min(idx, notes.length - 1);
  switchNote(notes[nextIdx].id);
  updateLocalStorageUsage();
}

// ── Switch active note ─────────────────────────────
function switchNote(id) {
  // Save current before switching
  if (activeId) saveContent(activeId, editor.value);

  activeId = id;
  const note = getActiveNote();
  editor.value = loadContent(id);
  render();
  markSaved();
  renderSidebar();
  updateTagButtons();
  editor.scrollTop = 0;
  preview.scrollTop = 0;
  if (!isInitializing) saveConfig();
}

// ── Sidebar DOM ────────────────────────────────────
function makeSidebarButton(className, title, text, tip, onClick) {
  const btn = document.createElement('button');

  btn.className = className;
  btn.title = title;
  btn.textContent = text;
  btn.dataset.tip = tip;
  btn.addEventListener('click', onClick);

  return btn;
}

function renderSidebar() {
  // Don't clobber a rename input the user is actively typing in —
  // removing the element fires blur/commitRename on the old node,
  // which could save stale text or jump focus unexpectedly.
  const focused = document.activeElement;
  if (focused && focused.classList.contains('note-name') && !focused.readOnly) return;

  notesList.innerHTML = '';
  if (notes.length === 0) {
    notesList.innerHTML = '<div id="notes-empty">No notes yet.<br>Press + to create one.</div>';
    return;
  }
  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'note-item' + (note.id === activeId ? ' active' : '');
    item.dataset.id = note.id;

    // ── Name display (span) — swapped for an input only during rename ──
    const nameEl = document.createElement('span');
    nameEl.className = 'note-name';
    nameEl.textContent = note.name;
    nameEl.dataset.tip = 'Click to open · ✎ to rename';

    item.addEventListener('click', e => {
      // Ignore clicks on the rename button, delete button, tag pills, or the active rename input
      if (e.target.closest('.note-rename, .note-delete, .note-tag-pill, .renaming-input')) return;
      switchNote(note.id);
    });

    function startRename() {
      // Replace the span with a real input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'note-name renaming-input';
      input.value = note.name;
      input.spellcheck = false;
      item.classList.add('renaming');
      item.replaceChild(input, nameEl);
      input.focus();
      input.select();

      let cancelled = false;

      function restoreSpan() {
        nameEl.textContent = note.name;
        item.classList.remove('renaming');
        item.replaceChild(nameEl, input);
      }

      function commit() {
        if (!cancelled) {
          note.name = input.value.trim() || 'Untitled';
          saveIndex();
        }
        restoreSpan();
        if (!cancelled) renderSidebar();
      }

      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { cancelled = true; input.blur(); }
      });
      input.addEventListener('input', e => e.stopPropagation());
    }

    // Rename button (pencil)
    const renameBtn = makeSidebarButton(
      'note-rename', 'Rename', '✎', 'Rename note',
      e => {
        e.stopPropagation();
        if (note.id !== activeId) switchNote(note.id);
        setTimeout(startRename, 0);
      }
    );

    const deleteBtn = makeSidebarButton(
      'note-delete', 'Delete','×', 'Delete note',
      e => {
        e.stopPropagation();
        deleteNote(note.id);
      }
    );

    item.appendChild(nameEl);
    item.appendChild(renameBtn);
    item.appendChild(deleteBtn);

    // Tag pills — appended after the name row so they flow below it
    if (Array.isArray(note.tags) && note.tags.length) {
      const pillsRow = document.createElement('div');
      pillsRow.className = 'note-tags';
      note.tags.forEach(tag => {
        const m = freeTagStyle(tag);
        const pill = document.createElement('span');
        pill.className = 'note-tag-pill';
        applyTagStyle(pill, m);
        pill.title = tag;
        pill.textContent = tag;
        pillsRow.appendChild(pill);
      });
      item.appendChild(pillsRow);
    }
    notesList.appendChild(item);
  });
}

// ── Sidebar toggle ─────────────────────────────────
function toggleSidebar() {
  const sidebarEl = document.getElementById('sidebar');
  sidebarEl.classList.toggle('collapsed');
  btnSidebar.classList.toggle('active');
  if (sidebarEl.classList.contains('collapsed')) {
    // Inline width (set by the layout panel) has higher specificity than
    // the #sidebar.collapsed { width: 0 } rule and would otherwise pin the
    // sidebar at its custom width — invisible (opacity: 0) but still taking
    // up space, so the editor never reclaims it. Clear it so collapse works.
    sidebarEl.style.width = '';
  } else if (layoutEnabled && sidebarEl.dataset.layoutWidth) {
    // Re-apply custom width when un-collapsing (collapsed CSS sets width:0)
    sidebarEl.style.width = sidebarEl.dataset.layoutWidth + 'px';
  }
  saveConfig();
}

function clearPreloadClasses() {
    document.documentElement.classList.remove(
      'preload-sidebar-collapsed', 
      'preload-view-editor', 
      'preload-view-preview'
    );
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════
//  Mermaid init
// ═══════════════════════════════════════════════════
const MERMAID_DARK_CONFIG = {
  startOnLoad: false,
  theme: 'dark',
  darkMode: true,
  themeVariables: {
    background:       '#161b22',
    primaryColor:     '#1f4068',
    primaryTextColor: '#e6edf3',
    primaryBorderColor:'#58a6ff',
    lineColor:        '#58a6ff',
    secondaryColor:   '#1c2128',
    tertiaryColor:    '#21262d',
    edgeLabelBackground:'#161b22',
    clusterBkg:       '#1c2128',
    titleColor:       '#e6edf3',
    nodeTextColor:    '#e6edf3',
  },
  flowchart: { curve: 'basis' },
  securityLevel: 'loose',
};
mermaid.initialize(MERMAID_DARK_CONFIG);
const { exportPdf } = initPdfExport({ activeNoteName, editor, marked, mermaid, MERMAID_DARK_CONFIG });

// ═══════════════════════════════════════════════════
//  marked config
// ═══════════════════════════════════════════════════

// Mermaid extension — intercepts ```mermaid fenced blocks before the
// default code renderer runs, turning them into placeholder divs that
// mermaid.run() will later render into SVGs.
marked.use({
  extensions: [{
    name: 'mermaid',
    level: 'block',
    start(src) { return src.indexOf('```mermaid'); },
    tokenizer(src) {
      const match = src.match(/^(`{3,})mermaid\n([\s\S]*?)\1(?:\n|$)/);
      if (match) return { type: 'mermaid', raw: match[0], text: match[2].trim() };
    },
    renderer(token) {
      const id = 'mmd-' + Math.random().toString(36).slice(2, 8);
      // Escape HTML entities so the browser doesn't interpret diagram source as markup.
      // We also stash the *raw* source in data-src so the PDF export path can read
      // it reliably — textContent would work today but would break if Mermaid ever
      // replaces the div contents with an SVG before exportPdf walks the container.
      const safe = escapeHtml(token.text);
      const rawAttr = token.text.replace(/"/g, '&quot;');
      return `<div class="mermaid-wrap"><div class="mermaid" id="${id}" data-src="${rawAttr}">${safe}</div></div>\n`;
    }
  }]
});

marked.use({
  breaks: true,
  gfm: true,
  renderer: {
    code(code, lang) {
      if ((lang || '').trim().toLowerCase() === 'mermaid') return false;
      const cls = lang ? ` class="language-${lang}"` : '';
      const escaped = escapeHtml(code);
      return `<pre><code${cls}>${escaped}</code></pre>\n`;
    }
  }
});

// ═══════════════════════════════════════════════════
//  Render
// ═══════════════════════════════════════════════════
function render() {
  preview.innerHTML = marked.parse(editor.value);
  preview.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.disabled = false);
  preview.querySelectorAll('img').forEach(img => {
    img.onerror = () => {
      if (!img.parentNode) return; // img detached — render() was called again before load failed
      img.style.display = 'none';
      const note = document.createElement('span');
      note.style.cssText = 'display:inline-block;padding:4px 8px;border-radius:4px;background:#1c2128;color:#484f58;font-family:monospace;font-size:12px;border:1px solid #30363d';
      note.textContent = '⚠ image blocked or unavailable: ' + (img.alt || img.src);
      img.parentNode.insertBefore(note, img.nextSibling);
    };
  });
  // Render Mermaid diagrams
  mermaid.run({ nodes: preview.querySelectorAll('.mermaid') }).catch(() => {});
  updateStatus();
  updateToc();
}

// ═══════════════════════════════════════════════════
//  Synchronized scrolling
// ═══════════════════════════════════════════════════
let syncScrollEnabled = true;

function toggleSyncScroll() {
  syncScrollEnabled = !syncScrollEnabled;
  const btn = document.getElementById('btn-sync-scroll');
  btn.classList.toggle('active', syncScrollEnabled);
  saveConfig();
}

// Sync scroll between editor and preview in both directions.
// The suppress flags prevent the listener on the other side from
// re-firing and creating an infinite scroll loop.
function syncScroll(source, target, suppressSource, suppressTarget) {
  const pct = source.scrollTop / (source.scrollHeight - source.clientHeight || 1);
  suppressTarget.value = true;
  const max = Math.max(0, target.scrollHeight - target.clientHeight);
  target.scrollTop = Math.max(0, Math.min(pct * max, max));
  requestAnimationFrame(() => { suppressTarget.value = false; });
}

// Use objects so syncScroll can mutate the flags by reference.
const supEditor  = { value: false };
const supPreview = { value: false };

editor.addEventListener('scroll', () => {
  if (!syncScrollEnabled || supEditor.value) return;
  syncScroll(editor, preview, supEditor, supPreview);
});

preview.addEventListener('scroll', () => {
  if (!syncScrollEnabled || supPreview.value) return;
  syncScroll(preview, editor, supPreview, supEditor);
});

// ═══════════════════════════════════════════════════
//  Status
// ═══════════════════════════════════════════════════
function updateStatus() {
  const val     = editor.value;
  const trimmed = val.trim();
  const words   = trimmed ? trimmed.split(/\s+/).length : 0;
  const lines   = val ? val.split('\n').length : 0;
  wordEl.textContent = words;
  lineEl.textContent = lines;
}

function setSaveState(saved) {
  saveEl.className  = saved ? 'saved'   : 'unsaved';
  saveEl.textContent = saved ? '● saved' : '● unsaved';
}
const markSaved   = () => setSaveState(true);
const markUnsaved = () => setSaveState(false);

// ═══════════════════════════════════════════════════
//  Auto-save
// ═══════════════════════════════════════════════════
function scheduleSave() {
  markUnsaved();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveContent(activeId, editor.value); markSaved(); }, 1000);
}

let renderTimer;
editor.addEventListener('input', () => {
  scheduleSave();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 150);
});

// ═══════════════════════════════════════════════════
//  Keyboard shortcuts
// ═══════════════════════════════════════════════════
editor.addEventListener('keydown', handleKeys);

function handleKeys(e) {
  const mod   = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt   = e.altKey;

  // ── Formatting ──────────────────────────────────
  if (mod && !shift && !alt && e.key === 'b') { e.preventDefault(); fmt('**','**'); return; }
  if (mod && !shift && !alt && e.key === 'i') { e.preventDefault(); fmt('_','_'); return; }

  if (mod && !shift && !alt && e.key === '`') { e.preventDefault(); fmt('`','`'); return; }
  if (mod && !shift && !alt && e.key === '1') { e.preventDefault(); fmtLine('# '); return; }
  if (mod && !shift && !alt && e.key === '2') { e.preventDefault(); fmtLine('## '); return; }
  if (mod && !shift && !alt && e.key === '3') { e.preventDefault(); fmtLine('### '); return; }
  if (mod && !shift && !alt && e.key === 'q') { e.preventDefault(); fmtLine('> '); return; }
  if (mod && !shift && !alt && e.key === 'k') { e.preventDefault(); insertLink(); return; }
  if (mod && !shift && !alt && e.key === 'h') { e.preventDefault(); insertText('\n---\n'); return; }
  if (mod &&  shift && !alt && e.key === 'K') { e.preventDefault(); fmtBlock(); return; }
  if (mod &&  shift && !alt && e.key === 'U') { e.preventDefault(); fmtLine('- '); return; }
  if (mod &&  shift && !alt && e.key === 'O') { e.preventDefault(); fmtLine('1. '); return; }

  // ── Tab / Shift+Tab ─────────────────────────────
  if (!mod && !alt && e.key === 'Tab') {
    e.preventDefault();
    if (shift) { adjustIndent(false); } else { adjustIndent(true); }
    return;
  }

  // ── File / editor ───────────────────────────────
  if (mod && !shift && !alt && e.key === 's') { e.preventDefault(); saveContent(activeId, editor.value); markSaved(); return; }
  if (mod &&  shift && !alt && e.key === 'S') { e.preventDefault(); downloadMd(); return; }
  if (mod && !shift && !alt && e.key === 'p') { e.preventDefault(); exportPdf(); return; }
  if (mod &&  shift && !alt && e.key === 'H') { e.preventDefault(); exportHtml(); return; }
  if (mod && !shift && !alt && e.key === 'e') { e.preventDefault(); editor.focus(); return; }
  if (!mod && !shift &&  alt && e.key === 'z') { e.preventDefault(); toggleWrap(); return; }

}

// Global shortcuts (outside editor too)
document.addEventListener('keydown', e => {
  // ? opens hotkey modal (only when not typing in an input/textarea,
  // or in the CodeMirror editor itself — its content is a contenteditable
  // div, not an INPUT/TEXTAREA, so it needs its own check here)
  const tag = document.activeElement.tagName;
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable;
  if (!isInput && e.key === '?') { e.preventDefault(); openHkModal(); return; }
  if (e.key === 'Escape') { closeHkModal(); return; }

  const mod   = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt   = e.altKey;

  // Notes navigation (global — works even when sidebar name is focused)
  if (mod && !shift &&  alt && e.key === 'n') { e.preventDefault(); createNote(); return; }
  if (mod && !shift && !alt && e.key === '\\') { e.preventDefault(); toggleSidebar(); return; }
  if (mod && !shift && !alt && e.key === ']') { e.preventDefault(); cycleNote(1); return; }
  if (mod && !shift && !alt && e.key === '[') { e.preventDefault(); cycleNote(-1); return; }

  // Layout: Alt+1 = editor only, Alt+2 = both, Alt+3 = preview only
  if (!mod && !shift && alt && e.key === '1') { e.preventDefault(); setViewMode('editor'); return; }
  if (!mod && !shift && alt && e.key === '2') { e.preventDefault(); setViewMode('both'); return; }
  if (!mod && !shift && alt && e.key === '3') { e.preventDefault(); setViewMode('preview'); return; }
});

// ── Cycle through notes ────────────────────────────
function cycleNote(dir) {
  if (notes.length < 2) return;
  const idx = notes.findIndex(n => n.id === activeId);
  const next = (idx + dir + notes.length) % notes.length;
  switchNote(notes[next].id);
}

function getLineRange(pos) {
  const start = editor.value.lastIndexOf('\n', pos - 1) + 1;
  const endIdx = editor.value.indexOf('\n', pos);

  return {start, end: endIdx === -1 ? editor.value.length : endIdx};
}

// ── Indent / outdent selected lines (Tab / Shift+Tab) ─────────────────
// Detects the document's indent style (tabs, 4-space, or 2-space) by
// scanning all lines, so mixed-selection ranges get a consistent result.
function detectIndentUnit(doc) {
  for (let i = 1; i <= doc.lines; i++) {
    const t = doc.line(i).text;
    if (t.startsWith('\t'))   return '\t';
    if (t.startsWith('    ')) return '    ';
    if (t.startsWith('  '))   return '  ';
  }
  return '  '; // default: 2 spaces
}

function adjustIndent(isIndent) {
  const { from, to } = editor._view.state.selection.main;
  const doc = editor._view.state.doc;
  const startLine = doc.lineAt(from);
  const endLine = doc.lineAt(to);

  const indentUnit = detectIndentUnit(doc);

  let changes = [];

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i);
    
    if (isIndent) {
      changes.push({ from: line.from, insert: indentUnit });
    } else {
      if (line.text.startsWith(indentUnit)) {
        changes.push({ from: line.from, to: line.from + indentUnit.length });
      } else if (line.text.startsWith(' ')) {
        // Fallback: remove a single stray space
        changes.push({ from: line.from, to: line.from + 1 });
      }
    }
  }

  if (changes.length > 0) {
    editor._view.dispatch({ changes: changes });
  }
}

// ═══════════════════════════════════════════════════
//  Selection preservation (toolbar buttons steal focus)
// ═══════════════════════════════════════════════════
// Prevent toolbar buttons from pulling focus away from the editor.
// This keeps selectionStart/selectionEnd intact when any format
// button (Bold, Link, H1, etc.) is clicked while the editor is active.
document.getElementById('toolbar').addEventListener('mousedown', e => {
  if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
    e.preventDefault(); // keep focus (and selection) on editor
  }
});

// ═══════════════════════════════════════════════════
//  Format helpers
// ═══════════════════════════════════════════════════
function fmt(before, after) {
  const s = editor.selectionStart, e2 = editor.selectionEnd;
  const sel = editor.value.slice(s, e2);
  spliceText(s, e2, before + (sel || 'text') + after);
  editor.setSelectionRange(s + before.length, s + before.length + (sel || 'text').length);
}

function fmtLine(prefix) {
  const { start: ls, end: e2 } = getLineRange(editor.selectionStart);

  const line = editor.value.slice(ls, e2);

  const hashes = prefix.trimEnd();
  const isExact = line.startsWith(prefix) &&
    !(hashes.split('').every(c => c === '#') && line[hashes.length] === '#');

  spliceText(ls, e2, isExact ? line.slice(prefix.length) : prefix + line);
}

function fmtBlock() {
  const s = editor.selectionStart, e2 = editor.selectionEnd;
  spliceText(s, e2, '```\n' + (editor.value.slice(s, e2) || 'code here') + '\n```');
}

function insertLink() {
  const s = editor.selectionStart, e2 = editor.selectionEnd;
  const linkText = editor.value.slice(s, e2) || 'link text';
  spliceText(s, e2, '[' + linkText + '](url)');
  // Select the 'url' placeholder so user can type the URL immediately
  const urlStart = s + 1 + linkText.length + 2; // after '[linkText]('
  editor.setSelectionRange(urlStart, urlStart + 3); // select 'url'
}

function insertText(text) {
  const s = editor.selectionStart;
  spliceText(s, s, text);
}

function spliceText(start, end, text) {
  editor._splice(start, end, text);
  render();
  scheduleSave();
}

// ═══════════════════════════════════════════════════
//  Word wrap
// ═══════════════════════════════════════════════════
let wrapOn = true;
function toggleWrap() {
  wrapOn = !wrapOn;
  editor.className = wrapOn ? 'wrap' : 'no-wrap';
  preview.className = wrapOn ? 'wrap' : 'no-wrap';
  btnWrap.classList.toggle('active', wrapOn);
  editor.setWrap(wrapOn);
  saveConfig();
}

// ═══════════════════════════════════════════════════
//  Markdown syntax highlighting (CodeMirror 6)
// ═══════════════════════════════════════════════════
let highlightOn = true;
function toggleHighlight() {
  highlightOn = !highlightOn;
  btnHighlight.classList.toggle('active', highlightOn);
  editor.setHighlight(highlightOn);
  saveConfig();
}

// ═══════════════════════════════════════════════════
//  Tag system
// ═══════════════════════════════════════════════════
const TAG_META = {
  fav: { label: '⚑ fav', color: '#f85149', bg: 'rgba(248,81,73,0.13)', border: 'rgba(248,81,73,0.35)' },
  todo:      { label: '☑ todo',      color: '#f2cc60', bg: 'rgba(242,204,96,0.13)', border: 'rgba(242,204,96,0.35)' },
  draft:     { label: '✎ draft',     color: '#79c0ff', bg: 'rgba(121,192,255,0.13)', border: 'rgba(121,192,255,0.35)' },
  bug:       { label: '🐛 bug',       color: '#3fb950', bg: 'rgba(63,185,80,0.13)',   border: 'rgba(63,185,80,0.35)'   },
};

// Deterministic hue from tag name so the same free tag always looks the same.
// Palette of 8 muted-but-readable hues that sit well on the dark theme.
const FREE_TAG_PALETTE = [
  { color: '#7ee787', bg: 'rgba(126,231,135,0.13)', border: 'rgba(126,231,135,0.35)' }, // green
  { color: '#d2a8ff', bg: 'rgba(210,168,255,0.13)', border: 'rgba(210,168,255,0.35)' }, // purple
  { color: '#ffa657', bg: 'rgba(255,166,87,0.13)',  border: 'rgba(255,166,87,0.35)'  }, // orange
  { color: '#79c0ff', bg: 'rgba(121,192,255,0.13)', border: 'rgba(121,192,255,0.35)' }, // blue
  { color: '#f2cc60', bg: 'rgba(242,204,96,0.13)',  border: 'rgba(242,204,96,0.35)'  }, // yellow
  { color: '#3fb950', bg: 'rgba(63,185,80,0.13)',   border: 'rgba(63,185,80,0.35)'   }, // dark-green
  { color: '#ff7b72', bg: 'rgba(255,123,114,0.13)', border: 'rgba(255,123,114,0.35)' }, // red
  { color: '#a5d6ff', bg: 'rgba(165,214,255,0.13)', border: 'rgba(165,214,255,0.35)' }, // light-blue
];

function freeTagStyle(tag) {
  if (TAG_META[tag]) return TAG_META[tag];
  // Simple djb2-like hash → palette index
  let h = 5381;
  for (let i = 0; i < tag.length; i++) h = ((h << 5) + h) ^ tag.charCodeAt(i);
  return FREE_TAG_PALETTE[Math.abs(h) % FREE_TAG_PALETTE.length];
}

function getActiveNote() {
  return notes.find(n => n.id === activeId);
}

function getActiveTags() {
  const note = getActiveNote();
  return (note && Array.isArray(note.tags)) ? note.tags : [];
}


// Shared helper: mutate the active note's tags array, then persist + re-render.
function mutateTags(fn) {
  const note = getActiveNote();
  if (!note) return;
  if (!Array.isArray(note.tags)) note.tags = [];
  if (fn(note.tags) === false) return; // fn returns false to abort
  saveIndex();
  updateTagButtons();
  renderSidebar();
}

function toggleTag(tag) {
  mutateTags(tags => {
    const idx = tags.indexOf(tag);
    if (idx === -1) tags.push(tag); else tags.splice(idx, 1);
  });
}

function addFreeTag(raw) {
  const tag = raw.trim().toLowerCase().replace(/[,;\s]+/g, '-').replace(/[^a-z0-9\-_]/g, '').slice(0, 32);
  mutateTags(tags => {
    if (!tag || tags.includes(tag)) return false;
    tags.push(tag);
  });
}

function removeFreeTag(tag) {
  mutateTags(tags => {
    const idx = tags.indexOf(tag);
    if (idx !== -1) tags.splice(idx, 1);
  });
}

function applyTagStyle(el, m) {
  el.style.color       = m ? m.color  : '';
  el.style.background  = m ? m.bg     : '';
  el.style.borderColor = m ? m.border : '';
  el.style.opacity     = m ? '1'      : '';
}

function updateTagButtons() {
  const active = getActiveTags();

  // ── Preset buttons ───────────────────────────────
  Object.keys(TAG_META).forEach(tag => {
    const btn = document.getElementById('tag-btn-' + tag);
    if (!btn) return;
    const on = active.includes(tag);
    btn.classList.toggle('tag-active', on);
    applyTagStyle(btn, on ? TAG_META[tag] : null);
  });

  // ── Free-tag chips in the toolbar input area ─────
  const chipsEl = document.getElementById('tag-chips');
  if (!chipsEl) return;
  chipsEl.innerHTML = '';
  active.filter(t => !TAG_META[t]).forEach(tag => {
    const m = freeTagStyle(tag);
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    applyTagStyle(chip, m);
    chip.textContent = tag;
    const x = document.createElement('button');
    x.className = 'tag-chip-remove';
    x.textContent = '×';
    x.title = 'Remove tag';
    x.addEventListener('mousedown', e => { e.preventDefault(); removeFreeTag(tag); });
    chip.appendChild(x);
    chipsEl.appendChild(chip);
  });
}

// ── Tag input wiring ─────────────────────────────
(function wireTagInput() {
  // Defer until DOM is ready (this runs inside boot() which fires after cm-ready)
  const input = document.getElementById('tag-input');
  const wrap  = document.getElementById('tag-input-wrap');
  if (!input || !wrap) return;

  // Prevent editor shortcuts from firing while typing tags
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.replace(/,/g, '');
      addFreeTag(val);
      input.value = '';
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      input.value = '';
      input.blur();
      return;
    }
    if (e.key === 'Backspace' && input.value === '') {
      // Remove the last free tag on backspace when input is empty
      const free = getActiveTags().filter(t => !TAG_META[t]);
      if (free.length) removeFreeTag(free[free.length - 1]);
    }
  });
  input.addEventListener('input', e => e.stopPropagation());
  // Clicking anywhere in the wrap focuses the input
  wrap.addEventListener('mousedown', e => {
    if (e.target !== input) { e.preventDefault(); input.focus(); }
  });
})();

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

function downloadMd() {
  downloadBlob(
    new Blob([editor.value], { type: 'text/markdown' }),
    activeNoteName() + '.md'
  );
}

// ═══════════════════════════════════════════════════
//  Export / Import JSON
// ═══════════════════════════════════════════════════
function exportJson() {
  if (activeId) saveContent(activeId, editor.value);
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    notes: notes.map(({ id, name, createdAt, tags }) => ({
      id,
      name,
      createdAt: createdAt ?? null,
      tags: tags ?? [],
      content: loadContent(id),
    })),
  };
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    'md-notes-export.json'
  );
}

function loadFile() {
  const fi = document.getElementById('file-input');
  fi.value = '';
  fi.click();
}

function onFileLoad(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    if (file.name.toLowerCase().endsWith('.json')) {
      let payload;
      try {
        payload = JSON.parse(ev.target.result);
      } catch(err) {
        alert('Invalid JSON file — could not parse.');
        return;
      }
      if (!Array.isArray(payload.notes) || payload.notes.length === 0) {
        alert('No notes found in this JSON file.');
        return;
      }
      const count = payload.notes.length;
      if (!confirm(`Import ${count} note${count !== 1 ? 's' : ''}? They will be added to your existing notes.`)) return;
      if (activeId) saveContent(activeId, editor.value);
      let firstImportedId = null;
      payload.notes.forEach(n => {
        if (typeof n.name !== 'string' || typeof n.content !== 'string') return;
        const id = genId();
        notes.push({ id, name: n.name || 'Untitled', createdAt: n.createdAt ?? new Date().toISOString(), tags: Array.isArray(n.tags) ? n.tags : [] });
        saveContent(id, n.content);
        if (!firstImportedId) firstImportedId = id;
      });
      saveIndex();
      if (firstImportedId) switchNote(firstImportedId);
      renderSidebar();
    } else {
      const name = file.name.replace(/\.(md|markdown|txt)$/i, '') || 'Imported';
      createNote(name, ev.target.result);
    }
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════════════
//  Export to standalone HTML
// ═══════════════════════════════════════════════════
function exportHtml() {
  const title   = activeNoteName();
  const bodyHtml = preview.innerHTML;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:       #0d1117;
      --surface:  #161b22;
      --border:   #30363d;
      --accent:   #58a6ff;
      --text:     #e6edf3;
      --muted:    #8b949e;
      --dim:      #484f58;
      --green:    #3fb950;
      --orange:   #d29922;
      --red:      #f85149;
      --mono:     'JetBrains Mono', 'Fira Code', monospace;
      --sans:     'Inter', system-ui, sans-serif;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      font-size: 15px;
      line-height: 1.75;
      padding: 48px 24px 80px;
    }
    .page {
      max-width: 780px;
      margin: 0 auto;
    }
    h1,h2,h3,h4,h5,h6 {
      font-family: var(--sans);
      font-weight: 600;
      line-height: 1.3;
      margin: 1.6em 0 0.5em;
      color: var(--text);
    }
    h1 { font-size: 2em;   border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
    h2 { font-size: 1.45em; border-bottom: 1px solid var(--border); padding-bottom: 0.25em; }
    h3 { font-size: 1.2em; }
    h4 { font-size: 1.05em; }
    h5,h6 { font-size: 0.95em; color: var(--muted); }
    p { margin: 0.75em 0; }
    a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
    a:hover { color: #79b8ff; }
    strong { font-weight: 600; color: var(--text); }
    em { font-style: italic; color: #c9d1d9; }
    del { color: var(--dim); text-decoration: line-through; }
    ul, ol { margin: 0.6em 0 0.6em 1.6em; }
    li { margin: 0.25em 0; }
    li input[type="checkbox"] { margin-right: 6px; accent-color: var(--accent); }
    blockquote {
      border-left: 3px solid var(--accent);
      margin: 1em 0;
      padding: 0.5em 1em;
      background: var(--surface);
      border-radius: 0 4px 4px 0;
      color: var(--muted);
    }
    blockquote p { margin: 0; }
    hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
    code {
      font-family: var(--mono);
      font-size: 0.88em;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.15em 0.4em;
      color: #f0883e;
    }
    pre {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1.1em 1.3em;
      overflow-x: auto;
      margin: 1em 0;
      line-height: 1.6;
    }
    pre code {
      background: none;
      border: none;
      padding: 0;
      color: var(--text);
      font-size: 0.85em;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
      font-size: 0.93em;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 0.5em 0.9em;
      text-align: left;
    }
    th { background: var(--surface); font-weight: 600; color: var(--text); }
    tr:nth-child(even) td { background: #0f1419; }
    img { max-width: 100%; border-radius: 6px; margin: 0.5em 0; }
    .mermaid-wrap { margin: 1em 0; overflow-x: auto; }
    /* Export banner */
    .export-banner {
      font-family: var(--mono);
      font-size: 11px;
      color: var(--dim);
      text-align: right;
      margin-top: 3em;
      padding-top: 1em;
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>
<div class="page">
${bodyHtml}
</div>
<!-- Mermaid (re-renders any diagrams) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.0/mermaid.min.js"><\/script>
<script>
  mermaid.initialize(${JSON.stringify({ ...MERMAID_DARK_CONFIG, startOnLoad: true })});
<\/script>
<!-- highlight.js for code blocks -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\/script>
<script>hljs.highlightAll();<\/script>
</body>
</html>`;

downloadBlob(
  new Blob([html], { type: 'text/html' }),
  activeNoteName() + '.html'
);
}

// ═══════════════════════════════════════════════════
//  Load .md file
// ═══════════════════════════════════════════════════
// loadFile / onFileLoad handle .md, .txt and .json — see above.

// ═══════════════════════════════════════════════════
//  Table of Contents
// ═══════════════════════════════════════════════════
let tocVisible = true;

function toggleToc() {
  tocVisible = !tocVisible;
  const panel = document.getElementById('toc-panel');
  const btn   = document.getElementById('btn-toc-toggle');
  const btnTb = document.getElementById('btn-toc-toolbar');
  const splitter = document.getElementById('sidebar-splitter');
  panel.classList.toggle('toc-hidden', !tocVisible);
  splitter.style.display = tocVisible ? '' : 'none';
  btn.textContent = tocVisible ? '×' : '§';
  btn.classList.toggle('active', !tocVisible);
  btnTb.classList.toggle('active', tocVisible);
  saveConfig();
}

// Shared heading parser used by both updateToc and tocJump.
// Returns [{level, text, line, charPos}] with fenced-code blocks excluded.
// charPos is the character offset of the heading line's first character.
function parseHeadings(text) {
  const lines = text.split('\n');
  const headings = [];
  let inCode = false, charPos = 0;
  lines.forEach((line, i) => {
    if (/^\s{0,3}`{3,}/.test(line)) { inCode = !inCode; charPos += line.length + 1; return; }
    if (!inCode) {
      const m = line.match(/^(#{1,6})\s+(.+)/);
      if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i, charPos });
    }
    charPos += line.length + 1;
  });
  return headings;
}

function updateToc() {
  const tocList = document.getElementById('toc-list');
  if (!tocList) return;

  const headings = parseHeadings(editor.value);

  if (headings.length === 0) {
    tocList.innerHTML = '<span class="toc-empty">No headings yet</span>';
    return;
  }

  // Escape heading text before interpolating into HTML to prevent XSS —
  // a heading like ## <img src=x onerror=alert(1)> would otherwise execute.
  tocList.innerHTML = headings.map(h => {
    const indent = `toc-h${h.level}`;
    const safe   = escapeHtml(h.text);
    return `<a class="toc-item ${indent}" data-line="${h.line}" onclick="tocJump(${h.line})" title="${safe}">${safe}</a>`;
  }).join('');
}

function tocJump(lineIndex) {
  const headings = parseHeadings(editor.value);
  const target   = headings.find(h => h.line === lineIndex);
  const charPos  = target ? target.charPos : 0;
  // Index among all headings before this line — used to match preview <h> elements.
  const hIdx     = headings.filter(h => h.line < lineIndex).length;

  editor.focus();
  editor.setSelectionRange(charPos, charPos);

  // Scroll editor to that line (exact, wrap-aware — see scrollPosIntoView)
  editor.scrollPosIntoView(charPos);

  // Also scroll preview to matching heading
  const previewHeadings = preview.querySelectorAll('h1,h2,h3,h4,h5,h6');
  if (previewHeadings[hIdx]) previewHeadings[hIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Highlight active TOC item
  document.querySelectorAll('.toc-item').forEach(el => el.classList.remove('toc-active'));
  const active = document.querySelector(`.toc-item[data-line="${lineIndex}"]`);
  if (active) active.classList.add('toc-active');
}

const copyRaw = (() => {
  const btn = document.getElementById('btn-copy');
  let restoreTimer = null;
  let prevText = '', prevStyle = '';

  function flash(text, color, bg) {
    // Snapshot the button's original state only on the first call
    // in a burst — rapid re-copies keep the original as the restore target.
    if (restoreTimer === null) {
      prevText  = btn.textContent;
      prevStyle = btn.getAttribute('style') || '';
    }
    clearTimeout(restoreTimer);
    btn.textContent       = text;
    btn.style.color       = color;
    btn.style.borderColor = color;
    btn.style.background  = bg;
    btn.style.opacity     = '1';
    restoreTimer = setTimeout(() => {
      btn.textContent = prevText;
      btn.setAttribute('style', prevStyle);
      restoreTimer = null;
    }, 1500);
  }

  return function copyRaw() {
    navigator.clipboard.writeText(editor.value)
      .then(() => flash('✓ copied!', 'var(--green)', 'rgba(63,185,80,0.12)'))
      .catch(() => flash('✕ failed',  'var(--red)',   'rgba(248,81,73,0.12)'));
  };
})()

// ═══════════════════════════════════════════════════
//  Custom layout widths
// ═══════════════════════════════════════════════════
// Returns the current slider values as a plain object for persistence.
function getLayoutWidths() {
  return {
    sidebar:   parseInt(document.getElementById('layout-slider-sidebar').value, 10),
    editorPct: parseInt(document.getElementById('layout-slider-editor').value, 10),
  };
}

// Applies sidebar px width and editor/preview percentage split to the DOM
// and keeps the slider UI in sync. Called both from user interaction and
// from config restore on startup.
function applyLayoutWidths(sidebarPx, editorPct) {
  if (!layoutEnabled) return;

  const sidebarPxClamped  = Math.max(140, Math.min(420, sidebarPx  || 200));
  const editorPctClamped  = Math.max(20,  Math.min(80,  editorPct  || 60));
  const previewPct        = 100 - editorPctClamped;

  // Sidebar
  const sidebarEl = document.getElementById('sidebar');
  if (!sidebarEl.classList.contains('collapsed')) {
    sidebarEl.style.width = sidebarPxClamped + 'px';
  }
  // Store on the element so toggleSidebar can re-apply when re-opening
  sidebarEl.dataset.layoutWidth = sidebarPxClamped;

  // Editor / preview panes
  const leftPane  = document.getElementById('left-pane');
  const rightPane = document.getElementById('right-pane');
  if (currentViewMode === 'both') {
    leftPane.style.flex  = 'none';
    leftPane.style.width = editorPctClamped + '%';
    rightPane.style.flex  = 'none';
    rightPane.style.width = previewPct + '%';
  }

  // Sync slider UI
  document.getElementById('layout-slider-sidebar').value    = sidebarPxClamped;
  document.getElementById('layout-slider-editor').value     = editorPctClamped;
  document.getElementById('layout-slider-preview').value    = previewPct;
  document.getElementById('layout-val-sidebar').textContent = sidebarPxClamped;
  document.getElementById('layout-val-editor').textContent  = editorPctClamped;
  document.getElementById('layout-val-preview').textContent = previewPct;
}

function resetLayoutWidths() {
  applyLayoutWidths(200, 60);
  saveConfig();
}

// Enable / disable the whole feature. When disabled, remove all inline widths
// so the layout reverts to its natural CSS flex state.
function setLayoutEnabled(on) {
  layoutEnabled = on;
  document.getElementById('btn-layout').classList.toggle('active', on);
  document.getElementById('divider').classList.toggle('locked', on);

  // Sync checkbox state and slider dimming
  const checkbox    = document.getElementById('layout-enabled-checkbox');
  const slidersWrap = document.getElementById('layout-sliders');
  if (checkbox) checkbox.checked = on;
  if (slidersWrap) {
    slidersWrap.style.opacity      = on ? '' : '0.35';
    slidersWrap.style.pointerEvents = on ? '' : 'none';
  }

  if (!on) {
    // Strip all custom widths so flex takes over again
    const sidebarEl = document.getElementById('sidebar');
    sidebarEl.style.width = '';
    const leftPane  = document.getElementById('left-pane');
    const rightPane = document.getElementById('right-pane');
    leftPane.style.flex  = '';
    leftPane.style.width = '';
    rightPane.style.flex  = '';
    rightPane.style.width = '';
  } else {
    // Re-apply saved widths
    const w = getLayoutWidths();
    applyLayoutWidths(w.sidebar, w.editorPct);
  }
  saveConfig();
}

// ── Layout panel open/close ─────────────────────────
(function wireLayoutPanel() {
  const panel      = document.getElementById('layout-panel');
  const btnLayout  = document.getElementById('btn-layout');
  const checkbox   = document.getElementById('layout-enabled-checkbox');
  const sliderSidebar = document.getElementById('layout-slider-sidebar');
  const sliderEditor  = document.getElementById('layout-slider-editor');
  const sliderPreview = document.getElementById('layout-slider-preview');
  const valSidebar    = document.getElementById('layout-val-sidebar');
  const valEditor     = document.getElementById('layout-val-editor');
  const valPreview    = document.getElementById('layout-val-preview');

  // Checkbox toggles the feature on/off
  checkbox.addEventListener('change', () => {
    setLayoutEnabled(checkbox.checked);
  });

  // Preview slider is read-only (driven by editor slider)
  sliderPreview.addEventListener('mousedown', e => e.preventDefault());

  sliderSidebar.addEventListener('input', () => {
    const v = parseInt(sliderSidebar.value, 10);
    valSidebar.textContent = v;
    applyLayoutWidths(v, parseInt(sliderEditor.value, 10));
    saveConfig();
  });

  sliderEditor.addEventListener('input', () => {
    const edPct = parseInt(sliderEditor.value, 10);
    const prPct = 100 - edPct;
    valEditor.textContent  = edPct;
    valPreview.textContent = prPct;
    sliderPreview.value    = prPct;
    applyLayoutWidths(parseInt(sliderSidebar.value, 10), edPct);
    saveConfig();
  });

  function openPanel() {
    const rect = btnLayout.getBoundingClientRect();
    panel.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';
    panel.style.top  = (rect.bottom + 4) + 'px';
    panel.classList.add('open');
    setTimeout(() => document.addEventListener('mousedown', outsideClick, true), 0);
  }

  function closePanel() {
    panel.classList.remove('open');
    document.removeEventListener('mousedown', outsideClick, true);
  }

  function outsideClick(e) {
    if (!panel.contains(e.target) && e.target !== btnLayout) closePanel();
  }

  // Click = toggle the panel open/close.
  // The panel contains its own enable/disable toggle.
  window.toggleLayoutPanel = function() {
    if (panel.classList.contains('open')) {
      closePanel();
    } else {
      openPanel();
    }
  };
})();

// ═══════════════════════════════════════════════════
//  View mode (editor / both / preview)
// ═══════════════════════════════════════════════════
let currentViewMode = 'both';

function setViewMode(mode) {

  currentViewMode = mode;

  const lp = document.getElementById('left-pane');
  const rp = document.getElementById('right-pane');
  const dv = document.getElementById('divider');

  // Reset inline widths set by drag-to-resize
  lp.style.width = '';
  lp.style.flex  = '';
  rp.style.width = '';
  rp.style.flex  = '';

  const show = {
    editor:  { lp: true,  rp: false, dv: false },
    preview: { lp: false, rp: true,  dv: false },
    both:    { lp: true,  rp: true,  dv: true  },
  }[mode] || { lp: true, rp: true, dv: true };

  // Toggle Bootstrap's d-flex class rather than fighting its display:flex !important
  // with an inline style — the inline style loses against !important.
  lp.classList.toggle('d-flex', show.lp);
  rp.classList.toggle('d-flex', show.rp);
  lp.style.display = show.lp ? '' : 'none';
  rp.style.display = show.rp ? '' : 'none';
  dv.style.display = show.dv ? '' : 'none';

  // Update button active states
  ['editor','both','preview'].forEach(m => {
    document.getElementById('btn-view-' + m).classList.toggle('active', m === mode);
  });

  saveConfig();
}
// ── Drag-resize helper ─────────────────────────────────────────────────
// Wires up a splitter element to resize two adjacent panels on drag.
// axis: 'x' for left/right panes, 'y' for top/bottom panels.
// onMove(delta, startSizes) → called each mousemove with the drag delta
//   and the panel sizes captured at mousedown.
function makeDragResizer(splitter, axis, cursor, onMove, isLocked) {
  let dragging = false, startPos = 0, startSizes = [];

  splitter.addEventListener('mousedown', e => {
    if (isLocked && isLocked()) return;
    dragging   = true;
    startPos   = axis === 'x' ? e.clientX : e.clientY;
    startSizes = onMove.captureStart();
    splitter.classList.add('dragging');
    document.body.style.cursor     = cursor;
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta = (axis === 'x' ? e.clientX : e.clientY) - startPos;
    onMove(delta, startSizes, e);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
  });
}

// ── Pane divider drag (left/right) ─────────────────
{
  const divider   = document.getElementById('divider');
  const leftPane  = document.getElementById('left-pane');
  const rightPane = document.getElementById('right-pane');
  const panesEl   = document.getElementById('panes');

  function onPaneMove(delta, _, e) {
    const rect = panesEl.getBoundingClientRect();
    const pct  = Math.max(20, Math.min(80,
      (e.clientX - rect.left) / (rect.width - divider.offsetWidth) * 100));
    leftPane.style.flex   = 'none';
    leftPane.style.width  = pct + '%';
    rightPane.style.flex  = 'none';
    rightPane.style.width = (100 - pct) + '%';
  }
  onPaneMove.captureStart = () => [];
  // Manual dragging conflicts with the layout panel's precise slider widths —
  // while "Custom layout" is on, the divider is locked and dragging is a no-op.
  makeDragResizer(divider, 'x', 'col-resize', onPaneMove, () => layoutEnabled);
}

// ── Sidebar TOC splitter drag (top/bottom) ──────────
{
  const splitter  = document.getElementById('sidebar-splitter');
  const notesList = document.getElementById('notes-list');
  const tocPanel  = document.getElementById('toc-panel');

  function onSidebarMove(delta, [startNotesH, startTocH]) {
    notesList.style.flex   = 'none';
    notesList.style.height = Math.max(60, startNotesH + delta) + 'px';
    tocPanel.style.flex    = 'none';
    tocPanel.style.height  = Math.max(60, startTocH   - delta) + 'px';
  }
  onSidebarMove.captureStart = () => [notesList.offsetHeight, tocPanel.offsetHeight];
  makeDragResizer(splitter, 'y', 'row-resize', onSidebarMove);
};

// ═══════════════════════════════════════════════════
//  Default content
// ═══════════════════════════════════════════════════
function DEFAULT_CONTENT(name) {
  return `# ${name}

Lorem ipsum dolor sit amet, consectetur adipiscing elit.

> This note is **auto-saved** to \`localStorage\`. Use it as a reference for everything this editor supports.

---

## 1. Text formatting

Regular paragraph text.

**Bold text** and *italic text* and ***bold italic*** and ~~strikethrough~~.

You can also write \`inline code\` inside a sentence, or combine **\`bold code\`**.

Also include common latin unicode á, ñ.

---

## 2. Headings

# H1 — Page title
## H2 — Section
### H3 — Subsection
#### H4 — Detail
##### H5 — Minor note
###### H6 — Fine print

---

## 3. Lists

**Unordered:**

- Item one
- Item two
  - Nested item
  - Another nested
- Item three

**Ordered:**

1. First step
2. Second step
3. Third step
   1. Sub-step A
   2. Sub-step B

**Task list:**

- [x] Design the layout
- [x] Add syntax highlighting
- [ ] Write documentation
- [ ] Ship it

---

## 4. Blockquotes

> "The best way to predict the future is to invent it."
> — Alan Kay

> Blockquotes can span **multiple lines** and contain \`inline code\` or other *formatting*.

---

## 5. Code blocks

\`\`\`bash
# Install dependencies and run
npm install && npm run dev
\`\`\`

---

## 6. Tables

| Feature            | Supported | Notes                        |
|--------------------|:---------:|------------------------------|
| Bold / Italic      |    T     | Standard Markdown            |
| Syntax highlighting|    T     | Via highlight.js             |
| Mermaid diagrams   |    T     | Flowcharts, sequence, etc.   |
| Table of contents  |    T     | Auto-updates as you type     |
| PDF export         |    T     | Via html2canvas + jsPDF      |
| Dark theme         |    T     | Only theme (for now)         |

---

## 7. Links & images

[Visit the Markdown Guide](https://www.markdownguide.org)

![A cat](https://cataas.com/cat?width=600&height=200)

---

## 8. Mermaid diagrams

\`\`\`mermaid
flowchart LR
    A([Start]) --> B{Is it working?}
    B -- Yes --> C[Ship it]
    B -- No  --> D[Debug]
    D --> E[Fix the bug]
    E --> B
\`\`\`

---

*Happy writing!* 
`;
}

// ═══════════════════════════════════════════════════
//  Reset all data
// ═══════════════════════════════════════════════════
function resetAllData() {
  if (!confirm('Delete ALL notes and reset the app to a fresh state?\n\nThis cannot be undone.')) return;
  localStorage.removeItem(NOTES_INDEX_KEY);
  localStorage.removeItem(CONFIG_KEY);
  Object.keys(localStorage)
    .filter(k => k.startsWith('md_note_') || k.startsWith('md_editor_'))
    .forEach(k => localStorage.removeItem(k));
  localStorage.removeItem('md_warning_dismissed');
  updateLocalStorageUsage();
  location.reload();
}

function updateLocalStorageUsage() {
  const ownKeys = [NOTES_INDEX_KEY, CONFIG_KEY,
    ...notes.map(n => noteContent(n.id))];
  const totalBytes = ownKeys.reduce((acc, k) => {
    const v = localStorage.getItem(k) ?? '';
    return acc + (k.length + v.length) * 2;
  }, 0);

  const maxBytes = 5242880; 
  const percentage = (totalBytes / maxBytes) * 100;
  const sizeInKB = (totalBytes / 1024).toFixed(1);

  const storageElem = document.getElementById('storage-count');
  if (storageElem) {
    storageElem.textContent = `${percentage.toFixed(1)}% · ${sizeInKB} KB`;
    if (percentage > 90) {
      storageElem.style.color = 'var(--red)';
    } else if (percentage > 70) {
      storageElem.style.color = 'var(--orange)';
    } else {
      storageElem.style.color = '#e6edf3';
    }
  }
}

// ═══════════════════════════════════════════════════
//  Config persistence
// ═══════════════════════════════════════════════════
function saveConfig() {
  if (isInitializing) return;
  const cfg = {
    wrap:             wrapOn,
    highlight:        highlightOn,
    sidebar:          !document.getElementById('sidebar').classList.contains('collapsed'),
    toc:              tocVisible,
    viewMode:         currentViewMode,
    activeId:         activeId,
    syncScroll:       syncScrollEnabled,
    layoutEnabled:    layoutEnabled,
    layoutWidths:     layoutEnabled ? getLayoutWidths() : undefined,
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function dismissWarning() {
  const el = document.getElementById('warning-footer');
  el.classList.add('d-none');
  el.classList.remove('d-flex');
  localStorage.setItem('md_warning_dismissed', '1');
  saveConfig();
}

// ═══════════════════════════════════════════════════
//  Init
// ═══════════════════════════════════════════════════
function loadConfig() {
  return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
}

// Must run before init() — preload classes use !important CSS that overrides
// the inline display styles setViewMode() applies to the panes. Removing them
// first means the restored view mode actually takes effect.
clearPreloadClasses();

(function init() {
  // Load notes index
  try {
    const raw = localStorage.getItem(NOTES_INDEX_KEY);
    notes = raw ? JSON.parse(raw) : [];
  } catch(e) { notes = []; }

  // Migrate legacy single-note storage (old md_editor_* keys)
  const legacyKeys = Object.keys(localStorage).filter(k => k.startsWith('md_editor_'));
  if (legacyKeys.length > 0 && notes.length === 0) {
    legacyKeys.forEach(k => {
      const name = k.replace('md_editor_', '') || 'Untitled';
      const id   = genId();
      notes.push({ id, name, createdAt: new Date().toISOString() });
      localStorage.setItem(noteContent(id), localStorage.getItem(k) ?? '');
      localStorage.removeItem(k);
    });
    saveIndex();
  }

  // Ensure at least one note exists
  if (notes.length === 0) {
    const id = genId();
    notes.push({ id, name: 'README', createdAt: new Date().toISOString() });
    saveIndex();
    saveContent(id, DEFAULT_CONTENT('README'));
  }

  renderSidebar();
  // Restore the last-active note if it still exists; fall back to the first note.
  const cfg = loadConfig();
  try {
    const savedId = cfg.activeId && notes.find(n => n.id === cfg.activeId) ? cfg.activeId : null;
    switchNote(savedId || notes[0].id);
  } catch(e) {
    switchNote(notes[0].id);
  }

  // Restore saved config
  try {

    // wrap
    wrapOn = cfg.wrap !== false;
    editor.className  = wrapOn ? 'wrap' : 'no-wrap';
    preview.className = wrapOn ? 'wrap' : 'no-wrap';
    btnWrap.classList.toggle('active', wrapOn);
    editor.setWrap(wrapOn);

    // highlight
    highlightOn = cfg.highlight !== false;
    btnHighlight.classList.toggle('active', highlightOn);
    editor.setHighlight(highlightOn);

    // sidebar
    if (cfg.sidebar === false) {
      document.getElementById('sidebar').classList.add('collapsed');
      btnSidebar.classList.remove('active');
    }

    // toc
    if (cfg.toc === false && tocVisible) {
      toggleToc();
    }

    // view mode
    if (cfg.viewMode && cfg.viewMode !== 'both') {
      setViewMode(cfg.viewMode);
    }

    // sync scroll
    if (cfg.syncScroll === false) {
      syncScrollEnabled = false;
      document.getElementById('btn-sync-scroll').classList.remove('active');
    }

    // layout widths
    if (cfg.layoutEnabled === false) {
      setLayoutEnabled(false);
    } else {
      // Layout is enabled (explicitly, or by default when config was never
      // saved / was cleared) — always apply widths so the DOM and the
      // slider UI agree. Without this, a cleared config left layoutEnabled
      // true but never called applyLayoutWidths, so editor/preview fell
      // back to a plain 50/50 flex split that just happened to coincide
      // with the slider defaults — any previously-set ratio appeared to
      // "win" purely by flex leftover, not by the layout system.
      document.getElementById('divider').classList.add('locked');
      const w = cfg.layoutWidths || { sidebar: 200, editorPct: 60 };
      applyLayoutWidths(w.sidebar, w.editorPct);
    }
    // (warning footer: show unless user has explicitly dismissed it)

  } catch(e) {}

  // Apagamos la bandera: a partir de ahora cualquier cambio del usuario sí se guardará
  isInitializing = false;

  updateLocalStorageUsage();

  // Show warning footer unless user has previously dismissed it
  if (!localStorage.getItem('md_warning_dismissed')) {
    const wf = document.getElementById('warning-footer');
    wf.classList.remove('d-none');
    wf.classList.add('d-flex');
  }

  // After a reset, clear the temporary flag (footer visibility already handled above)
  if (localStorage.getItem('md_show_warning')) {
    localStorage.removeItem('md_show_warning');
  }
})();

// ═══════════════════════════════════════════════════
//  Hotkeys modal
// ═══════════════════════════════════════════════════
function openHkModal() {
  const el = document.getElementById('hk-overlay');
  const modal = bootstrap.Modal.getOrCreateInstance(el);
  modal.show();
  setTimeout(() => document.getElementById('hk-close').focus(), 200);
}
function closeHkModal() {
  const el = document.getElementById('hk-overlay');
  const modal = bootstrap.Modal.getInstance(el);
  if (modal) modal.hide();
}

// ═══════════════════════════════════════════════════
//  Expose functions referenced by inline onclick/oninput/onchange
//  HTML attributes — those run in global scope, but everything in
//  this file now lives inside boot() to delay startup until the
//  CodeMirror module (loaded separately as type="module") is ready.
// ═══════════════════════════════════════════════════
Object.assign(window, {
  closeHkModal, copyRaw, createNote, dismissWarning, downloadMd, exportHtml, exportJson, exportPdf,
  fmt, fmtBlock, fmtLine, insertLink, insertText, loadFile, onFileLoad, openHkModal,
  resetAllData, resetLayoutWidths, setViewMode, tocJump, toggleHighlight, toggleSidebar,
  toggleToc, toggleWrap, toggleSyncScroll, toggleTag, addFreeTag, removeFreeTag,
});

// ═══════════════════════════════════════════════════
//  Tooltip
// ═══════════════════════════════════════════════════
(function () {
  const box = document.getElementById('tip-box');
  let current = null;

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (!el || !el.dataset.tip) { hide(); return; }
    if (el === current) return;
    current = el;
    box.textContent = el.dataset.tip;
    box.style.display = 'block';
    position(e);
  });

  document.addEventListener('mousemove', e => {
    if (!current) return;
    position(e);
  });

  document.addEventListener('mouseout', e => {
    const el = e.target.closest('[data-tip]');
    if (el && el === current) hide();
  });

  function position(e) {
    const pad = 20;
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let x = e.clientX - bw / 2;
    let y = e.clientY - bh - pad;
    // Flip below cursor if too close to top
    if (y < 4) y = e.clientY + pad;
    // Keep within horizontal viewport
    x = Math.max(4, Math.min(x, window.innerWidth - bw - 4));
    box.style.left = x + 'px';
    box.style.top  = y + 'px';
  }

  function hide() {
    box.style.display = 'none';
    current = null;
  }
})();

// ═══════════════════════════════════════════════════
//  Table picker
// ═══════════════════════════════════════════════════
(function () {
  const COLS = 8, ROWS = 8;
  const picker  = document.getElementById('table-picker');
  const grid    = document.getElementById('table-grid');
  const label   = document.getElementById('table-picker-label');

  // Build grid cells
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'tg-cell';
      cell.dataset.r = r;
      cell.dataset.c = c;
      grid.appendChild(cell);
    }
  }

  function highlight(rows, cols) {
    grid.querySelectorAll('.tg-cell').forEach(cell => {
      const r = +cell.dataset.r, c = +cell.dataset.c;
      cell.classList.toggle('hover', r < rows && c < cols);
    });
    label.textContent = cols > 0 && rows > 0 ? `${cols} × ${rows}` : '0 × 0';
  }

  grid.addEventListener('mousemove', e => {
    const cell = e.target.closest('.tg-cell');
    if (!cell) return;
    highlight(+cell.dataset.r + 1, +cell.dataset.c + 1);
  });

  grid.addEventListener('mouseleave', () => highlight(0, 0));

  grid.addEventListener('click', e => {
    const cell = e.target.closest('.tg-cell');
    if (!cell) return;
    const rows = +cell.dataset.r + 1;
    const cols = +cell.dataset.c + 1;
    close();
    insertTable(rows, cols);
  });

  function close() {
    picker.classList.remove('open');
    document.removeEventListener('mousedown', outsideClick, true);
  }

  function outsideClick(e) {
    if (!picker.contains(e.target) && e.target.id !== 'btn-table') close();
  }

  window.openTablePicker = function(e) {
    const btn = e.currentTarget || e.target;
    const rect = btn.getBoundingClientRect();
    picker.style.left = rect.left + 'px';
    picker.style.top  = (rect.bottom + 4) + 'px';
    picker.classList.toggle('open');
    if (picker.classList.contains('open')) {
      highlight(0, 0);
      setTimeout(() => document.addEventListener('mousedown', outsideClick, true), 0);
    }
  };

  document.getElementById('btn-table').addEventListener('click', window.openTablePicker);

  function insertTable(rows, cols) {
    const header = '| ' + Array(cols).fill('Header').join(' | ') + ' |';
    const sep    = '| ' + Array(cols).fill(':------').join(' | ') + ' |';
    const row    = '| ' + Array(cols).fill('Cell').join(' | ') + ' |';
    const lines  = [header, sep, ...Array(rows - 1).fill(row)];
    insertText('\n' + lines.join('\n') + '\n');
  }
})();

} // ── end boot() ──

// Start the app once the CodeMirror module has finished setting up
// window.editor (handles both orderings: module finishes first, or
// this classic script's listener attaches first).
if (window.__cmReady) boot();
else window.addEventListener('cm-ready', boot, { once: true });
