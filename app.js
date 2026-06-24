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

function deleteCurrentNote() {
  deleteNote(activeId);
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

      function commit() {
        if (cancelled) {
          // Restore span without saving
          nameEl.textContent = note.name;
          item.classList.remove('renaming');
          item.replaceChild(nameEl, input);
          return;
        }
        note.name = input.value.trim() || 'Untitled';
        saveIndex();
        // Restore the span
        nameEl.textContent = note.name;
        item.classList.remove('renaming');
        item.replaceChild(nameEl, input);
        // Sync sidebar name across all items without full re-render
        renderSidebar();
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

// ═══════════════════════════════════════════════════
//  PDF / Download
// ═══════════════════════════════════════════════════
function printFallback() {
  const prev = document.title;
  document.title = activeNoteName();
  window.print();
  document.title = prev;
}

function pdfProgress(show, text) {
  const el = document.getElementById('pdf-progress');
  el.classList.toggle('show', show);
  if (text) document.getElementById('pdf-progress-text').textContent = text;
}

// ── Shared canvas helper ─────────────────────────────────────────────────
// Draws img onto a white-filled canvas and returns a JPEG data URL.
// scale > 1 increases output resolution (used for Mermaid's 2x render).
function imageToJpegDataURL(img, w, h, scale = 1, quality = 0.85) {
  const cv = document.createElement('canvas');
  cv.width  = w * scale;
  cv.height = h * scale;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', quality);
}

// ── Mermaid → PNG data-URL ────────────────────────────────────────────────
async function mermaidToDataURL(code, id) {
  const { svg } = await mermaid.render(id, code);
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
  const svgEl = svgDoc.querySelector('svg');
  let w = parseFloat(svgEl.getAttribute('width'))  || 0;
  let h = parseFloat(svgEl.getAttribute('height')) || 0;
  if (!w || !h) {
    const vb = (svgEl.getAttribute('viewBox') || '').split(/[\s,]+/);
    w = parseFloat(vb[2]) || 500; h = parseFloat(vb[3]) || 300;
  }
  const maxW = 470;
  if (w > maxW) { h = h * maxW / w; w = maxW; }
  svgEl.setAttribute('width', w); svgEl.setAttribute('height', h);
  const svgStr = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svgEl));
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ dataURL: imageToJpegDataURL(img, w, h, 2, 0.7), w, h });
    img.onerror = () => resolve(null);
    img.src = svgStr;
  });
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// ── Inter font loader ─────────────────────────────────────────────────────
// Fetches Inter and JetBrains Mono TTF files from the local /fonts/ directory
// and registers them with jsPDF. Results are cached on window._interFontsCache
// so the fetch only happens once per session (subsequent exports reuse the cache).
async function loadInterFonts(pdf) {
  const CACHE_KEY = '_interFontsCache';
  if (window[CACHE_KEY]) {
    // Already loaded in a previous export — re-register on this new pdf instance.
    for (const { filename, b64, name, style } of window[CACHE_KEY]) {
      pdf.addFileToVFS(filename, b64);
      pdf.addFont(filename, name, style);
    }
    return;
  }

  // Fetch a local TTF file and return it as Base64.
  async function fetchTtfB64(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + path);
    const buf = await res.arrayBuffer();
    // Sanity-check magic bytes — WOFF2 = 0x774F4632, WOFF = 0x774F4646.
    // TTF/OTF starts with 0x00010000, 0x4F54544F ("OTTO"), or 0x74727565 ("true").
    const magic = new DataView(buf).getUint32(0);
    if (magic === 0x774F4632 || magic === 0x774F4646) {
      throw new Error('Got WOFF/WOFF2 instead of TTF for ' + path);
    }
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  // [local path, jsPDF font name, jsPDF style, filename registered in VFS]
  const variants = [
    ['fonts/Inter-Regular.ttf',         'inter',      'normal',     'Inter-Regular.ttf'],
    ['fonts/Inter-Bold.ttf',            'inter',      'bold',       'Inter-Bold.ttf'],
    ['fonts/Inter-Italic.ttf',          'inter',      'italic',     'Inter-Italic.ttf'],
    ['fonts/Inter-Bold.ttf',            'inter',      'bolditalic', 'Inter-Bold.ttf'],
    ['fonts/JetBrainsMono-Regular.ttf', 'inter-mono', 'normal',     'JetBrainsMono-Regular.ttf'],
    ['fonts/JetBrainsMono-Regular.ttf', 'inter-mono', 'bold',       'JetBrainsMono-Regular.ttf'],
    ['fonts/JetBrainsMono-Regular.ttf', 'inter-mono', 'italic',     'JetBrainsMono-Regular.ttf'],
    ['fonts/JetBrainsMono-Regular.ttf', 'inter-mono', 'bolditalic', 'JetBrainsMono-Regular.ttf'],
  ];

  // Deduplicate fetches — multiple variants may share the same file (e.g. inter-mono).
  const fileCache = {};
  const registered = [];
  const uniquePaths = [...new Set(variants.map(([path]) => path))];
  await Promise.all(uniquePaths.map(async path => {
    try { fileCache[path] = await fetchTtfB64(path); }
    catch (e) { console.warn('Font fetch failed:', path, e.message); }
  }));
  for (const [path, name, style, filename] of variants) {
    const b64 = fileCache[path];
    if (!b64) continue;
    try {
      pdf.addFileToVFS(filename, b64);
      pdf.addFont(filename, name, style);
      registered.push({ filename, b64, name, style });
    } catch (e) {
      console.warn('Font register failed:', filename, e.message);
    }
  }

  window[CACHE_KEY] = registered;
}

// ── Text-based PDF export — produces selectable text ─────────────────────
async function exportPdf() {
  if (typeof window.jspdf === 'undefined') { printFallback(); return; }

  const btn = document.getElementById('btn-pdf');
  btn.classList.add('printing');
  pdfProgress(true, 'Building PDF…');

  try {
    const title = activeNoteName();
    const { jsPDF } = window.jspdf;

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const PW = pdf.internal.pageSize.getWidth();
    const PH = pdf.internal.pageSize.getHeight();
    const ML = 56, MR = 56, MT = 52, MB = 52;
    const CW = PW - ML - MR;
    let y = MT;

    // Load Inter + JetBrains Mono (fetched once, cached for the session).
    pdfProgress(true, window._interFontsCache ? 'Building PDF…' : 'Downloading fonts…');
    await loadInterFonts(pdf);
    // If font loading failed entirely, fall back gracefully to helvetica/courier.
    const USE_INTER = pdf.getFontList().hasOwnProperty('inter');

    mermaid.initialize({ theme: 'neutral', startOnLoad: false,
      securityLevel: 'loose', flowchart: { curve: 'basis' } });

    function newPageIfNeeded(needed) {
      if (y + needed > PH - MB) { pdf.addPage(); y = MT; }
    }

    function setFont(bold, italic, size, hexColor) {
      const style = bold && italic ? 'bolditalic'
        : bold ? 'bold'
        : italic ? 'italic'
        : 'normal';

      pdf.setFont(USE_INTER ? 'inter' : 'helvetica', style);
      pdf.setFontSize(size);

      if (hexColor) pdf.setTextColor(...hexToRgb(hexColor));
    }

    function setFontMono(size) {
      pdf.setFont(USE_INTER ? 'inter-mono' : 'courier', 'normal');
      pdf.setFontSize(size);
      pdf.setTextColor(26,26,26);
    }

    function fillRect(x, ry, w, h, hex) {
      pdf.setFillColor(...hexToRgb(hex));
      pdf.rect(x, ry, w, h, 'F');
    }

    function strokeLine(x1, ry, x2, hex) {
      pdf.setDrawColor(...hexToRgb(hex));
      pdf.setLineWidth(0.5);
      pdf.line(x1, ry, x2, ry);
    }

    // plain() extracts text content and normalises whitespace.
    // Pass all characters through as-is — Inter covers Latin + Latin Extended.
    function plain(el) {
      return (el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function writeWrapped(text, x, maxW, bold, italic, size, hex, afterGap) {
      setFont(bold, italic, size, hex);
      const lines = pdf.splitTextToSize(text, maxW);
      const lh = size * 1.45;
      for (const line of lines) { newPageIfNeeded(lh); pdf.text(line, x, y); y += lh; }
      y += (afterGap || 0);
    }

    // ── Inline-aware paragraph renderer ────────────────────────────────────
    // Walks the child nodes of a block element, collecting styled "runs"
    // (spans of text each with their own bold/italic/strike/mono flags),
    // then word-wraps and renders them line by line — drawing a strikethrough
    // rule over any runs that need it (jsPDF has no text-decoration support).
    function collectRuns(node, runs, ctx) {
      // ctx = { bold, italic, strike, mono, color }
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = node.textContent.replace(/\s+/g, ' ');
        if (raw) runs.push({ text: raw, ...ctx });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      // Skip block-level elements that renderBlock handles separately
      if (tag === 'ul' || tag === 'ol' || tag === 'blockquote' || tag === 'pre') return;
      let c = { ...ctx };
      if (tag === 'strong' || tag === 'b')      c.bold   = true;
      if (tag === 'em'     || tag === 'i')      c.italic = true;
      if (tag === 's' || tag === 'del' || tag === 'strike') c.strike = true;
      if (tag === 'code')                        c.mono   = true;
      if (tag === 'a') {
        c.color = '#1a56db';
        c.href = node.getAttribute('href') || null;
        for (const child of node.childNodes) collectRuns(child, runs, c);
        // Append the URL in grey so it's visible as plain text in the PDF,
        // not just as a hidden annotation. Only add when href differs from
        // the link text (avoids "https://x.com (https://x.com)" redundancy).
        if (c.href) {
          const linkText = node.textContent.trim();
          if (linkText !== c.href) {
            runs.push({ text: ' (' + c.href + ')', bold: false, italic: false, strike: false, mono: false, color: '#6b7280', href: c.href });
          }
        }
        return; // children already collected above
      }
      for (const child of node.childNodes) collectRuns(child, runs, c);
    }

    // Returns the advance width of `text` given the current jsPDF font (in pt).
    function textWidth(text) {
      return pdf.getStringUnitWidth(text) * pdf.getFontSize() / pdf.internal.scaleFactor;
    }

    // Sets jsPDF font for a run's style flags.
    function applyRunFont(run, size, defaultHex) {
      if (run.mono) {
        pdf.setFont(USE_INTER ? 'inter-mono' : 'courier', run.bold ? 'bold' : 'normal');
        pdf.setFontSize(size * 0.88);
        pdf.setTextColor(...hexToRgb('#374151'));
      } else {
        setFont(run.bold, run.italic, size, run.color || defaultHex);
      }
    }

    // Wrap inline runs into lines.
    // Strategy: concatenate all run text into a single string, use
    // pdf.splitTextToSize (which we know works) to get the line breaks,
    // then re-map styled runs back onto those lines character by character.
    // This avoids the textWidth() unit issues in the layout pass.
    function wrapRuns(runs, maxW, size, defaultHex) {
      if (!runs.length) return [];

      // Build a plain-text version for layout purposes.
      // Use the default (non-mono) font for splitTextToSize — mono runs are
      // slightly narrower so this is a conservative (safe) estimate.
      setFont(false, false, size, defaultHex);
      const fullText = runs.map(r => r.text).join('');
      const wrappedLines = pdf.splitTextToSize(fullText, maxW);

      // Re-map runs back onto each wrapped line by consuming characters.
      // We walk through runs and their characters, advancing a cursor, and
      // slice each wrapped line's text out of the run stream.
      const result = [];
      let runIdx = 0;
      let charIdx = 0; // position within runs[runIdx].text

      for (const lineText of wrappedLines) {
        const lineSegs = [];
        let remaining = lineText.length;

        while (remaining > 0 && runIdx < runs.length) {
          const run = runs[runIdx];
          const available = run.text.length - charIdx;
          const take = Math.min(available, remaining);
          const seg = run.text.slice(charIdx, charIdx + take);
          if (seg) lineSegs.push({ ...run, text: seg });
          charIdx += take;
          remaining -= take;
          if (charIdx >= run.text.length) { runIdx++; charIdx = 0; }
        }

        // After consuming the line's visible chars, skip the space that
        // splitTextToSize consumed as a line break (if any).
        if (runIdx < runs.length) {
          const run = runs[runIdx];
          if (charIdx < run.text.length && run.text[charIdx] === ' ') {
            charIdx++;
            if (charIdx >= run.text.length) { runIdx++; charIdx = 0; }
          }
        }

        result.push(lineSegs);
      }

      return result;
    }

    // Render an element's inline content with full bold/italic/strike support.
    // `x` = left edge, `maxW` = available width, `size` = base font size,
    // `defaultHex` = default text colour, `afterGap` = gap below last line.
    function writeInline(el, x, maxW, size, defaultHex, afterGap) {
      const runs = [];
      const baseCtx = { bold: false, italic: false, strike: false, mono: false, color: null };
      for (const child of el.childNodes) collectRuns(child, runs, baseCtx);
      if (!runs.length) { y += (afterGap || 0); return; }

      const lh = size * 1.45;
      const lines = wrapRuns(runs, maxW, size, defaultHex);

      for (const lineSegs of lines) {
        newPageIfNeeded(lh);

        // Render each segment, tracking x position so we can draw strike lines
        let cx = x;
        const strikeSegs = []; // collect segments that need a strike rule

        for (const seg of lineSegs) {
          applyRunFont(seg, size, defaultHex);
          const sw = textWidth(seg.text);
          pdf.text(seg.text, cx, y);
          // Add a clickable link annotation when this run is a hyperlink.
          // jsPDF link() args: x, y (top-left corner), w, h, {url}.
          // We use size * 1.1 as a conservative line-height for the hit box.
          if (seg.href) {
            const linkH = size * 1.1;
            pdf.link(cx, y - linkH, sw, linkH, { url: seg.href });
          }
          if (seg.strike) strikeSegs.push({ x1: cx, x2: cx + sw });
          cx += sw;
        }

        // Draw strikethrough lines (painter's model: on top of text)
        if (strikeSegs.length) {
          const strikeY = y - size * 0.33; // roughly mid-cap-height
          pdf.setLineWidth(0.6);
          pdf.setDrawColor(...hexToRgb('#1a1a1a'));
          for (const { x1, x2 } of strikeSegs) pdf.line(x1, strikeY, x2, strikeY);
        }

        y += lh;
      }
      y += (afterGap || 0);
    }

    async function renderDataURLImage(dataURL, imgW, imgH) {
      const maxW = CW, maxH = PH - MT - MB - 20;
      if (imgW > maxW) { imgH = imgH * maxW / imgW; imgW = maxW; }
      if (imgH > maxH) { imgW = imgW * maxH / imgH; imgH = maxH; }
      newPageIfNeeded(imgH + 12);
      pdf.addImage(dataURL, 'JPEG', ML + (CW - imgW) / 2, y, imgW, imgH);
      y += imgH + 12;
    }

    async function renderBlock(el) {
      const tag = el.tagName ? el.tagName.toLowerCase() : '';

      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1]);
        const sz = [20, 17, 14.5, 12.5, 11.5, 11][level - 1];
        y += level <= 2 ? 4 : 3;
        newPageIfNeeded(sz * 1.8);
        writeWrapped(plain(el), ML, CW, true, false, sz, '#111111', 0);
        y += 1;
        return;
      }

      if (tag === 'p') {
        const imgs = el.querySelectorAll('img');
        if (imgs.length && !el.textContent.trim()) {
          for (const img of imgs) await renderImgEl(img); return;
        }
        writeInline(el, ML, CW, 11, '#1a1a1a', 6);
        return;
      }

      if (tag === 'hr') {
        // Add a fixed gap above and below the rule regardless of what
        // the previous block left in y — predictable spacing is better
        // than trying to compensate for variable trailing gaps.
        y += 6;
        newPageIfNeeded(16);
        strokeLine(ML, y, ML + CW, '#d1d5db');
        y += 16;
        return;
      }

      if (tag === 'blockquote') {
        const BQ_SIZE = 10.5;
        const lh = BQ_SIZE * 1.45;
        // vPad: total vertical padding split evenly top/bottom (inside the rect).
        // Keep it tight — half-pad top, then baseline, then half-pad bottom after last line.
        const vPad = 10;
        const bqX = ML + 12;
        const bqW = CW - 16;

        // Collect inline runs (italic by default, like a real blockquote).
        // marked wraps blockquote content in <p> tags — collect from those
        // <p> elements' children directly to avoid double-visiting text nodes.
        const runs = [];
        const baseCtx = { bold: false, italic: true, strike: false, mono: false, color: null };
        const bqParagraphs = el.querySelectorAll('p');
        const bqSources = bqParagraphs.length ? bqParagraphs : [el];
        for (const pEl of bqSources) {
          for (const child of pEl.childNodes) collectRuns(child, runs, baseCtx);
          if (runs.length && runs[runs.length - 1].text.slice(-1) !== ' ') {
            runs.push({ text: ' ', ...baseCtx });
          }
        }
        if (!runs.length) return;

        const bqLines = wrapRuns(runs, bqW, BQ_SIZE, '#374151');
        if (!bqLines.length) return;

        // ascent offset: distance from rect-top-padding to text baseline.
        // Using fontSize * 0.75 matches jsPDF's default ascender for helvetica.
        const ascOffset = BQ_SIZE * 0.75;
        // descent: space to reserve below the last baseline before rect bottom.
        const descent  = BQ_SIZE * 0.25;

        newPageIfNeeded(ascOffset + descent + vPad + (bqLines.length - 1) * lh);

        // Two-pass: accumulate {segs, ty, strikeSegs} rows, then draw rect → text.
        let segTop = y;
        let segRows = [];

        function flushQuoteSegment(segBottom) {
          const sh = segBottom - segTop;
          if (sh <= 0) return;
          fillRect(ML,     segTop, 3,      sh, '#9ca3af');
          fillRect(ML + 3, segTop, CW - 3, sh, '#f9fafb');
          for (const { segs, ty: rowY, strikeSegs: ss } of segRows) {
            let cx = bqX;
            for (const seg of segs) {
              applyRunFont(seg, BQ_SIZE, '#374151');
              const sw = textWidth(seg.text);
              pdf.text(seg.text, cx, rowY);
              if (seg.href) {
                const linkH = BQ_SIZE * 1.1;
                pdf.link(cx, rowY - linkH, sw, linkH, { url: seg.href });
              }
              cx += sw;
            }
            if (ss.length) {
              const sy = rowY - BQ_SIZE * 0.33;
              pdf.setLineWidth(0.6);
              pdf.setDrawColor(...hexToRgb('#374151'));
              for (const { x1, x2 } of ss) pdf.line(x1, sy, x2, sy);
            }
          }
          segRows = [];
        }

        // First text baseline: rect-top + half-vPad + ascender offset
        y = segTop + vPad / 2 + ascOffset;
        let lastBaseline = y;

        for (let i = 0; i < bqLines.length; i++) {
          // For page-break check use ascOffset+descent for the current line,
          // plus remaining lines + final descent+padding.
          const remaining = bqLines.length - 1 - i;
          const needed = descent + vPad / 2 + remaining * lh;
          if (y + needed > PH - MB) {
            flushQuoteSegment(PH - MB);
            pdf.addPage();
            segTop = MT;
            y = MT + vPad / 2 + ascOffset;
          }
          const segs = bqLines[i];
          const ss = [];
          let cx = bqX;
          for (const seg of segs) {
            applyRunFont(seg, BQ_SIZE, '#374151');
            if (seg.strike) ss.push({ x1: cx, x2: cx + textWidth(seg.text) });
            cx += textWidth(seg.text);
          }
          segRows.push({ segs, ty: y, strikeSegs: ss });
          lastBaseline = y;
          if (i < bqLines.length - 1) y += lh;
        }

        // rect bottom = last baseline + descent + half-vPad
        const finalBottom = lastBaseline + descent + vPad / 2;
        flushQuoteSegment(finalBottom);
        y = finalBottom + 4; // small gap after blockquote
        return;
      }

      if (tag === 'pre') {
        const PRE_SIZE = 9;
        const text = el.textContent || '';
        setFontMono(PRE_SIZE);
        const lines = pdf.splitTextToSize(text, CW - 18);
        const lh = PRE_SIZE * 1.5;
        const vPad = 14;
        // ascent/descent for courier 9pt
        const ascOffset = PRE_SIZE * 0.75;
        const descent   = PRE_SIZE * 0.25;

        newPageIfNeeded(Math.min(lines.length * lh + vPad, 80));

        let segTop = y;
        let segLines = [];

        function flushCodeSegment(segBottom) {
          const sh = segBottom - segTop;
          if (sh <= 0) return;
          fillRect(ML, segTop, CW, sh, '#f3f4f6');
          pdf.setDrawColor(200, 200, 200); pdf.setLineWidth(0.4);
          pdf.rect(ML, segTop, CW, sh, 'S');
          setFontMono(PRE_SIZE);
          for (const { text: t, ty } of segLines) pdf.text(t, ML + 9, ty);
          segLines = [];
        }

        // First baseline: rect-top + half-vPad + ascender
        y = segTop + vPad / 2 + ascOffset;
        let lastBaseline = y;

        for (let i = 0; i < lines.length; i++) {
          const remaining = lines.length - 1 - i;
          const needed = descent + vPad / 2 + remaining * lh;
          if (y + needed > PH - MB) {
            flushCodeSegment(PH - MB);
            pdf.addPage();
            segTop = MT;
            y = MT + vPad / 2 + ascOffset;
          }
          segLines.push({ text: lines[i], ty: y });
          lastBaseline = y;
          if (i < lines.length - 1) y += lh;
        }

        const finalBottom = lastBaseline + descent + vPad / 2;
        flushCodeSegment(finalBottom);
        y = finalBottom + 4;
        return;
      }

      if (tag === 'ul' || tag === 'ol') {
        let idx = 1;
        for (const li of el.children) {
          if (li.tagName.toLowerCase() !== 'li') continue;
          const LI_SIZE = 11;
          const lh = LI_SIZE * 1.45;

          // Task-list items: marked renders [ ] / [x] as a disabled <input type="checkbox">
          const cb = li.querySelector('input[type="checkbox"]');
          let bullet;
          if (cb) {
            bullet = cb.checked ? '[x]' : '[ ]';
          } else {
            bullet = tag === 'ul' ? '\u2022' : (idx) + '.';
          }
          if (!cb) idx++;

          // Draw bullet first
          setFont(false, false, LI_SIZE, '#1a1a1a');
          newPageIfNeeded(lh);
          pdf.text(bullet, ML + 4, y);
          // Render inline content with inline-aware renderer (indented)
          // We capture y before and restore nothing — writeInline advances y itself.
          const yBefore = y;
          writeInline(li, ML + 15, CW - 16, LI_SIZE, '#1a1a1a', 1);
          // If writeInline produced nothing (empty li), advance one line
          if (y === yBefore) y += lh;
        }
        y += 4; return;
      }

      if (tag === 'table') {
        const rows = Array.from(el.querySelectorAll('tr'));
        if (!rows.length) return;
        const cols = rows[0].querySelectorAll('th,td').length || 1;
        const colW = CW / cols, rh = 22;
        for (let ri = 0; ri < rows.length; ri++) {
          const cells = rows[ri].querySelectorAll('th,td');
          const isHead = ri === 0 && rows[ri].parentElement.tagName.toLowerCase() === 'thead';
          newPageIfNeeded(rh);
          if (isHead) fillRect(ML, y, CW, rh, '#f3f4f6');
          else if (ri % 2 === 0) fillRect(ML, y, CW, rh, '#f9fafb');
          pdf.setDrawColor(200,200,200); pdf.setLineWidth(0.3); pdf.rect(ML, y, CW, rh, 'S');
          setFont(isHead, false, 9.5, isHead ? '#374151' : '#1a1a1a');
          for (let ci = 0; ci < cells.length; ci++) {
            const txt = pdf.splitTextToSize(plain(cells[ci]), colW - 10);
            pdf.text(txt[0] || '', ML + ci * colW + 5, y + rh * 0.65);
          }
          y += rh;
        }
        y += 8; return;
      }

      if (tag === 'div' && el.classList.contains('mermaid-wrap')) {
        const mmdEl = el.querySelector('.mermaid');
        if (!mmdEl) return;
        pdfProgress(true, 'Rendering diagram…');
        const uid = 'pdfmmd-' + Math.random().toString(36).slice(2,9);
        // Prefer data-src (raw diagram source stored by the renderer) over
        // textContent, which would fail if Mermaid has already replaced the
        // element's content with a rendered SVG.
        const src = (mmdEl.dataset.src || mmdEl.textContent).trim();
        try {
          const result = await mermaidToDataURL(src, uid);
          if (result) await renderDataURLImage(result.dataURL, result.w, result.h);
        } catch(e) { console.warn('Mermaid render failed', e); }
        pdfProgress(true, 'Building PDF…');
        return;
      }

      if (tag === 'img') { await renderImgEl(el); return; }

      for (const child of el.children) await renderBlock(child);
    }

    async function renderImgEl(imgEl) {
      const src = imgEl.src || imgEl.getAttribute('src');
      if (!src) return;
      try {
        // Fetch as blob to avoid canvas CORS taint on external images.
        // Use a blob URL directly for the canvas draw — no need to re-encode
        // the blob as a data URL and reload it as a second Image.
        let imgSrc;
        let blobUrl = null;
        try {
          const resp = await fetch(src);
          const blob = await resp.blob();
          blobUrl = URL.createObjectURL(blob);
          imgSrc = blobUrl;
        } catch(fetchErr) {
          // Fallback: try direct load with crossOrigin
          imgSrc = src;
        }
        const loaded = await new Promise((res, rej) => {
          const i = new Image();
          if (!blobUrl) i.crossOrigin = 'anonymous';
          i.onload = () => res(i); i.onerror = rej; i.src = imgSrc;
        });
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        const dataURL = imageToJpegDataURL(loaded, loaded.naturalWidth, loaded.naturalHeight);
        await renderDataURLImage(dataURL, loaded.naturalWidth, loaded.naturalHeight);
      } catch(e) { console.warn('PDF: could not render image', src, e); }
    }

    pdfProgress(true, 'Rendering content…');
    const container = document.createElement('div');
    container.innerHTML = marked.parse(editor.value);
    for (const child of container.children) await renderBlock(child);

    pdfProgress(true, 'Saving…');
    pdf.save(title + '.pdf');

  } catch (err) {
    console.error('PDF export failed:', err);
    if (confirm('PDF export failed. Use the browser print dialog instead?')) printFallback();
  } finally {
    // Always restore mermaid to the app's dark theme (exportPdf temporarily
    // switches it to 'neutral' for the PDF render — if we only did this on
    // success, a failed export would leave all live preview diagrams light-themed
    // until the page was reloaded).
    mermaid.initialize(MERMAID_DARK_CONFIG);

    document.getElementById('pdf-render-root').innerHTML = '';
    pdfProgress(false);
    btn.classList.remove('printing');
  }
}

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

  return function copyRaw() {
    navigator.clipboard.writeText(editor.value).then(() => {
      // Snapshot the button's original state only on the first call
      // in a burst — rapid re-copies keep the original as the restore target.
      if (restoreTimer === null) {
        prevText  = btn.textContent;
        prevStyle = btn.getAttribute('style') || '';
      }
      clearTimeout(restoreTimer);
      btn.textContent       = '✓ copied!';
      btn.style.color       = 'var(--green)';
      btn.style.borderColor = 'var(--green)';
      btn.style.background  = 'rgba(63,185,80,0.12)';
      btn.style.opacity     = '1';
      restoreTimer = setTimeout(() => {
        btn.textContent = prevText;
        btn.setAttribute('style', prevStyle);
        restoreTimer = null;
      }, 1500);
    }).catch(() => {
      if (restoreTimer === null) {
        prevText  = btn.textContent;
        prevStyle = btn.getAttribute('style') || '';
      }
      clearTimeout(restoreTimer);
      btn.textContent       = '✕ failed';
      btn.style.color       = 'var(--red)';
      btn.style.borderColor = 'var(--red)';
      btn.style.background  = 'rgba(248,81,73,0.12)';
      btn.style.opacity     = '1';
      restoreTimer = setTimeout(() => {
        btn.textContent = prevText;
        btn.setAttribute('style', prevStyle);
        restoreTimer = null;
      }, 1500);
    });
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
  const editorPctClamped  = Math.max(20,  Math.min(80,  editorPct  || 55));
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
  applyLayoutWidths(200, 55);
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
  const slidersWrap   = document.getElementById('layout-sliders');
  const sliderSidebar = document.getElementById('layout-slider-sidebar');
  const sliderEditor  = document.getElementById('layout-slider-editor');
  const sliderPreview = document.getElementById('layout-slider-preview');
  const valSidebar    = document.getElementById('layout-val-sidebar');
  const valEditor     = document.getElementById('layout-val-editor');
  const valPreview    = document.getElementById('layout-val-preview');

  // Checkbox toggles the feature on/off
  checkbox.addEventListener('change', () => {
    setLayoutEnabled(checkbox.checked);
    slidersWrap.style.opacity     = checkbox.checked ? '' : '0.35';
    slidersWrap.style.pointerEvents = checkbox.checked ? '' : 'none';
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

> This note is **auto-saved** to \`localStorage\`. Use it as a reference for everything this editor supports.

---

## 1. Text formatting

Regular paragraph text. Lorem ipsum dolor sit amet, consectetur adipiscing elit.

**Bold text** and *italic text* and ***bold italic*** and ~~strikethrough~~.

You can also write \`inline code\` inside a sentence, or combine **\`bold code\`**.

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
| Bold / Italic      | ✅        | Standard Markdown            |
| Syntax highlighting| ✅        | Via highlight.js             |
| Mermaid diagrams   | ✅        | Flowcharts, sequence, etc.   |
| Table of contents  | ✅        | Auto-updates as you type     |
| PDF export         | ✅        | Via html2canvas + jsPDF      |
| Dark theme         | ✅        | Only theme (for now)         |

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
  // Separamos la versión string de la numérica
  const percentageStr = ((totalBytes / maxBytes) * 100).toFixed(1);
  const percentageNum = parseFloat(percentageStr);
  const sizeInKB = (totalBytes / 1024).toFixed(1);

  const storageElem = document.getElementById('storage-count');
  if (storageElem) {
    storageElem.textContent = `${percentageStr}% · ${sizeInKB} KB`;
    
    // Ahora evaluamos el número real
    if (percentageNum > 90) {
      storageElem.style.color = 'var(--red)';
    } else if (percentageNum > 70) {
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
      const w = cfg.layoutWidths || { sidebar: 200, editorPct: 55 };
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
  toggleToc, toggleWrap, toggleSyncScroll, toggleLayoutPanel, toggleTag, addFreeTag, removeFreeTag,
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
