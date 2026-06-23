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
  document.getElementById('btn-new-note').addEventListener('click', () => createNote());
const noteTitleEl  = { value: '', select() {} }; // title bar removed
function activeNoteName() {
  const note = notes.find(n => n.id === activeId);
  return (note && note.name.trim()) ? note.name.trim() : 'note';
}
const btnSidebar   = document.getElementById('btn-sidebar');

let isInitializing = true;

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
  notes.push({ id, name });
  saveIndex();
  saveContent(id, content ?? DEFAULT_CONTENT(name));
  switchNote(id);
  // Focus sidebar name input for immediate rename
  setTimeout(() => {
    const nameInput = notesList.querySelector(`.note-item[data-id="${id}"] .note-name`);
    if (nameInput) { nameInput.readOnly = false; nameInput.focus(); nameInput.select(); nameInput.closest('.note-item').classList.add('renaming'); }
  }, 50);
  return id;
}

function deleteNote(id) {
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

function renameCurrentNote(name) {
  const note = notes.find(n => n.id === activeId);
  if (!note) return;
  note.name = name || 'Untitled';
  saveIndex();
  // Update sidebar label without full re-render to avoid focus loss
  const item = notesList.querySelector(`.note-item[data-id="${activeId}"] .note-name`);
  if (item && item !== document.activeElement) item.value = note.name;
}

// ── Switch active note ─────────────────────────────
function switchNote(id) {
  // Save current before switching
  if (activeId) saveContent(activeId, editor.value);

  activeId = id;
  const note = notes.find(n => n.id === id);
  editor.value = loadContent(id);
  // noteTitleEl removed
  render();
  markSaved();
  renderSidebar();
  editor.scrollTop = 0;
  preview.scrollTop = 0;
  saveConfig();
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
  notesList.innerHTML = '';
  if (notes.length === 0) {
    notesList.innerHTML = '<div id="notes-empty">No notes yet.<br>Press + to create one.</div>';
    return;
  }
  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'note-item' + (note.id === activeId ? ' active' : '');
    item.dataset.id = note.id;

    // Editable name
    const nameEl = document.createElement('input');
    nameEl.type = 'text';
    nameEl.className = 'note-name';
    nameEl.value = note.name;
    nameEl.spellcheck = false;
    nameEl.readOnly = true;
    nameEl.dataset.tip = 'Click to open · double-click or ✎ to rename';

    function startRename() {
      nameEl.readOnly = false;
      item.classList.add('renaming');
      nameEl.focus();
      nameEl.select();
    }

    function commitRename() {
      nameEl.readOnly = true;
      item.classList.remove('renaming');
      note.name = nameEl.value.trim() || 'Untitled';
      nameEl.value = note.name;
      saveIndex();
    }

    // Single click → switch note (if not active); if already active, start rename
    nameEl.addEventListener('click', e => {
      if (note.id !== activeId) {
        switchNote(note.id);
      } else if (nameEl.readOnly) {
        startRename();
      }
    });
    // Double-click → rename regardless
    nameEl.addEventListener('dblclick', e => { startRename(); });

    nameEl.addEventListener('blur', commitRename);
    nameEl.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); nameEl.blur(); }
      if (e.key === 'Escape') { nameEl.value = note.name; nameEl.readOnly = true; item.classList.remove('renaming'); nameEl.blur(); }
    });
    // Prevent sidebar-input typing from triggering editor shortcuts
    nameEl.addEventListener('input', e => e.stopPropagation());

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
    notesList.appendChild(item);
  });
}

// ── Sidebar toggle ─────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
  btnSidebar.classList.toggle('active');
  saveConfig();
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
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  darkMode: true,
  themeVariables: {
    background:      '#161b22',
    primaryColor:    '#1f4068',
    primaryTextColor:'#e6edf3',
    primaryBorderColor:'#58a6ff',
    lineColor:       '#58a6ff',
    secondaryColor:  '#1c2128',
    tertiaryColor:   '#21262d',
    edgeLabelBackground:'#161b22',
    clusterBkg:      '#1c2128',
    titleColor:      '#e6edf3',
    nodeTextColor:   '#e6edf3',
  },
  flowchart: { curve: 'basis' },
  securityLevel: 'loose',
});

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
      const escaped = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
let suppressEditorScroll  = false;
let suppressPreviewScroll = false;
let syncScrollEnabled     = true;

function toggleSyncScroll() {
  syncScrollEnabled = !syncScrollEnabled;
  const btn = document.getElementById('btn-sync-scroll');
  btn.classList.toggle('active', syncScrollEnabled);
  saveConfig();
}

editor.addEventListener('scroll', () => {
  if (!syncScrollEnabled || suppressEditorScroll) return;
  const pct = editor.scrollTop / (editor.scrollHeight - editor.clientHeight || 1);
  suppressPreviewScroll = true;
  const maxPreview = Math.max(0, preview.scrollHeight - preview.clientHeight);
  preview.scrollTop = Math.max(0, Math.min(pct * maxPreview, maxPreview));
  requestAnimationFrame(() => { suppressPreviewScroll = false; });
});

preview.addEventListener('scroll', () => {
  if (!syncScrollEnabled || suppressPreviewScroll) return;
  const pct = preview.scrollTop / (preview.scrollHeight - preview.clientHeight || 1);
  suppressEditorScroll = true;
  const maxEditor = Math.max(0, editor.scrollHeight - editor.clientHeight);
  editor.scrollTop = Math.max(0, Math.min(pct * maxEditor, maxEditor));
  requestAnimationFrame(() => { suppressEditorScroll = false; });
});

// ═══════════════════════════════════════════════════
//  Status
// ═══════════════════════════════════════════════════
function updateStatus() {
  const val   = editor.value;
  const words = val.trim() ? val.trim().split(/\s+/).length : 0;
  const lines = val ? val.split('\n').length : 0;
  wordEl.textContent = words + (words === 1 ? ' word' : ' words');
  lineEl.textContent = lines + (lines === 1 ? ' line' : ' lines');
}

function markSaved()   { saveEl.className = 'saved';   saveEl.textContent = '● saved'; }
function markUnsaved() { saveEl.className = 'unsaved'; saveEl.textContent = '● unsaved'; }

// ═══════════════════════════════════════════════════
//  Auto-save
// ═══════════════════════════════════════════════════
function scheduleSave() {
  markUnsaved();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveContent(activeId, editor.value); markSaved(); }, 800);
}

editor.addEventListener('input', () => { render(); scheduleSave(); });

// Title input
// noteTitleEl listener removed (title bar removed)

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
    if (shift) { outdentLine(); } else { insertText('  '); }
    return;
  }

  // ── File / editor ───────────────────────────────
  if (mod && !shift && !alt && e.key === 's') { e.preventDefault(); saveContent(activeId, editor.value); markSaved(); return; }
  if (mod &&  shift && !alt && e.key === 'S') { e.preventDefault(); downloadMd(); return; }
  if (mod && !shift && !alt && e.key === 'p') { e.preventDefault(); exportPdf(); return; }
  if (mod &&  shift && !alt && e.key === 'H') { e.preventDefault(); exportHtml(); return; }
  if (mod && !shift && !alt && e.key === 'e') { e.preventDefault(); editor.focus(); return; }
  if (!mod && !shift &&  alt && e.key === 'z') { e.preventDefault(); toggleWrap(); return; }

  // ── Notes ───────────────────────────────────────
  if (mod && !shift &&  alt && e.key === 'n') { e.preventDefault(); createNote(); return; }
  if (mod && !shift && !alt && e.key === '\\') { e.preventDefault(); toggleSidebar(); return; }
  if (mod && !shift && !alt && e.key === ']') { e.preventDefault(); cycleNote(1); return; }
  if (mod && !shift && !alt && e.key === '[') { e.preventDefault(); cycleNote(-1); return; }
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

// ── Outdent current line ───────────────────────────
function outdentLine() {
  const { start: ls, end: e2 } = getLineRange(editor.selectionStart);

  const line = editor.value.slice(ls, e2);

  if (line.startsWith('  ')) spliceText(ls, e2, line.slice(2));
  else if (line.startsWith('\t')) spliceText(ls, e2, line.slice(1));
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

// ── Mermaid → PNG data-URL ────────────────────────────────────────────────
async function mermaidToDataURL(code, id) {
  const { svg } = await mermaid.render(id, code);
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  let w = parseFloat(svgEl.getAttribute('width'))  || 0;
  let h = parseFloat(svgEl.getAttribute('height')) || 0;
  if (!w || !h) {
    const vb = (svgEl.getAttribute('viewBox') || '').split(/[\s,]+/);
    w = parseFloat(vb[2]) || 500; h = parseFloat(vb[3]) || 300;
  }
  const maxW = 470;
  if (w > maxW) { h = h * maxW / w; w = maxW; }
  svgEl.setAttribute('width', w); svgEl.setAttribute('height', h);
  const svgStr  = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svgEl));
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const sc = 2, cv = document.createElement('canvas');
      cv.width = w * sc; cv.height = h * sc;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cv.width,cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      resolve({ dataURL: cv.toDataURL('image/jpeg', 0.7), w, h });
    };
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

      pdf.setFont('helvetica', style);
      pdf.setFontSize(size);

      if (hexColor) pdf.setTextColor(...hexToRgb(hexColor));
    }

    function setFontMono(size) {
      pdf.setFont('courier', 'normal'); pdf.setFontSize(size); pdf.setTextColor(26,26,26);
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

    function plain(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }

    function writeWrapped(text, x, maxW, bold, italic, size, hex, afterGap) {
      setFont(bold, italic, size, hex);
      const lines = pdf.splitTextToSize(text, maxW);
      const lh = size * 1.45;
      for (const line of lines) { newPageIfNeeded(lh); pdf.text(line, x, y); y += lh; }
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
        const sz = [20, 16, 13.5, 12, 11.5, 11][level - 1];
        y += level <= 2 ? 14 : 8;
        newPageIfNeeded(sz * 1.8);
        writeWrapped(plain(el), ML, CW, true, false, sz, '#111111', 0);
        if (level <= 2) { strokeLine(ML, y + 1, ML + CW, '#d1d5db'); y += 8; }
        else y += 4;
        return;
      }

      if (tag === 'p') {
        const imgs = el.querySelectorAll('img');
        if (imgs.length && !el.textContent.trim()) {
          for (const img of imgs) await renderImgEl(img); return;
        }
        writeWrapped(plain(el), ML, CW, false, false, 11, '#1a1a1a', 6);
        return;
      }

      if (tag === 'hr') {
        y += 8; newPageIfNeeded(4);
        strokeLine(ML, y, ML + CW, '#d1d5db'); y += 12;
        return;
      }

      if (tag === 'blockquote') {
        setFont(false, false, 10.5, '#374151');
        const lines = pdf.splitTextToSize(plain(el), CW - 16);
        const lh = 10.5 * 1.45, bh = lines.length * lh + 12;
        newPageIfNeeded(bh);
        fillRect(ML, y, 3, bh, '#9ca3af');
        fillRect(ML + 3, y, CW - 3, bh, '#f9fafb');
        y += 7;
        for (const line of lines) { pdf.text(line, ML + 12, y); y += lh; }
        y += 10; return;
      }

      if (tag === 'pre') {
        const text = el.textContent || '';
        setFontMono(9);
        const lines = pdf.splitTextToSize(text, CW - 18);
        const lh = 9 * 1.5, bh = lines.length * lh + 16;
        newPageIfNeeded(Math.min(bh, 80)); // require at least 80pt before starting
        const startY = y;
        fillRect(ML, y, CW, bh, '#f3f4f6');
        pdf.setDrawColor(200,200,200); pdf.setLineWidth(0.4); pdf.rect(ML, y, CW, bh, 'S');
        y += 9;
        for (const line of lines) {
          if (y + lh > PH - MB) { pdf.addPage(); fillRect(ML, MT, CW, PH - MT - MB, '#f3f4f6'); y = MT + 9; }
          setFontMono(9); pdf.text(line, ML + 9, y); y += lh;
        }
        y += 9; return;
      }

      if (tag === 'ul' || tag === 'ol') {
        let idx = 1;
        for (const li of el.children) {
          if (li.tagName.toLowerCase() !== 'li') continue;
          setFont(false, false, 11, '#1a1a1a');
          const bullet = tag === 'ul' ? '•' : (idx++) + '.';
          const lines = pdf.splitTextToSize(plain(li), CW - 16);
          const lh = 11 * 1.45;
          newPageIfNeeded(lh);
          pdf.text(bullet, ML + 4, y);
          for (const line of lines) { newPageIfNeeded(lh); pdf.text(line, ML + 15, y); y += lh; }
          y += 1;
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
        // Fetch as blob to avoid canvas CORS taint on external images
        let dataURL;
        try {
          const resp = await fetch(src);
          const blob = await resp.blob();
          dataURL = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = rej;
            r.readAsDataURL(blob);
          });
        } catch(fetchErr) {
          // Fallback: try direct load with crossOrigin
          const loaded = await new Promise((res, rej) => {
            const i = new Image(); i.crossOrigin = 'anonymous';
            i.onload = () => res(i); i.onerror = rej; i.src = src;
          });
          const cv = document.createElement('canvas');
          cv.width = loaded.naturalWidth; cv.height = loaded.naturalHeight;
          cv.getContext('2d').drawImage(loaded, 0, 0);
          dataURL = cv.toDataURL('image/jpeg', 0.85);
        }
        const loaded = await new Promise((res, rej) => {
          const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataURL;
        });
        const cv = document.createElement('canvas');
        cv.width = loaded.naturalWidth; cv.height = loaded.naturalHeight;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(loaded, 0, 0);
        await renderDataURLImage(cv.toDataURL('image/jpeg', 0.85), loaded.naturalWidth, loaded.naturalHeight);
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
    mermaid.initialize({
      startOnLoad: false, theme: 'dark', darkMode: true, securityLevel: 'loose',
      flowchart: { curve: 'basis' },
      themeVariables: {
        background:'#161b22', primaryColor:'#1f4068', primaryTextColor:'#e6edf3',
        primaryBorderColor:'#58a6ff', lineColor:'#58a6ff', secondaryColor:'#1c2128',
        tertiaryColor:'#21262d', edgeLabelBackground:'#161b22',
        clusterBkg:'#1c2128', titleColor:'#e6edf3', nodeTextColor:'#e6edf3',
      },
    });

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
  mermaid.initialize({ startOnLoad:true, theme:'dark', darkMode:true,
    themeVariables:{ background:'#161b22', primaryColor:'#1f4068',
      primaryTextColor:'#e6edf3', primaryBorderColor:'#58a6ff',
      lineColor:'#58a6ff', secondaryColor:'#1c2128', tertiaryColor:'#21262d' },
    flowchart:{ curve:'basis' }, securityLevel:'loose' });
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
function loadMd() {
  document.getElementById('md-file-input').value = '';
  document.getElementById('md-file-input').click();
}

function onMdFileLoad(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    // Create a new note with the filename (strip extension)
    const name = file.name.replace(/\.(md|markdown|txt)$/i, '') || 'Imported';
    const id = genId();
    notes.push({ id, name });
    saveIndex();
    saveContent(id, ev.target.result);
    renderSidebar();
    switchNote(id);
  };
  reader.readAsText(file);
}

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

function updateToc() {
  const tocList = document.getElementById('toc-list');
  if (!tocList) return;

  const lines = editor.value.split('\n');
  const headings = [];
  let inCode = false;

  lines.forEach((line, i) => {
    if (/^`{3,}/.test(line)) { inCode = !inCode; return; }
    if (inCode) return;
    const m = line.match(/^(#{1,6})\s+(.+)/);
    if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i });
  });

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
  const lines = editor.value.split('\n');
  let charPos = 0;
  for (let i = 0; i < lineIndex; i++) charPos += lines[i].length + 1;

  editor.focus();
  editor.setSelectionRange(charPos, charPos);

  // Scroll editor to that line (exact, wrap-aware — see scrollPosIntoView)
  editor.scrollPosIntoView(charPos);

  // Also scroll preview to matching heading
  const headings = preview.querySelectorAll('h1,h2,h3,h4,h5,h6');
  let hIdx = 0;
  let inCode = false;
  for (let i = 0; i < lineIndex; i++) {
    if (/^`{3,}/.test(lines[i])) { inCode = !inCode; continue; }
    if (!inCode && /^#{1,6}\s/.test(lines[i])) hIdx++;
  }
  if (headings[hIdx]) headings[hIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Highlight active TOC item
  document.querySelectorAll('.toc-item').forEach(el => el.classList.remove('toc-active'));
  const active = document.querySelector(`.toc-item[data-line="${lineIndex}"]`);
  if (active) active.classList.add('toc-active');
}

// ── Sidebar TOC splitter drag ──────────────────────
(function() {
  const splitter  = document.getElementById('sidebar-splitter');
  const notesList = document.getElementById('notes-list');
  const tocPanel  = document.getElementById('toc-panel');
  let dragging = false;
  let startY, startNotesH, startTocH;

  splitter.addEventListener('mousedown', e => {
    dragging = true;
    startY = e.clientY;
    startNotesH = notesList.offsetHeight;
    startTocH   = tocPanel.offsetHeight;
    splitter.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    const newNotesH = Math.max(60, startNotesH + dy);
    const newTocH   = Math.max(60, startTocH   - dy);
    notesList.style.flex = 'none';
    notesList.style.height = newNotesH + 'px';
    tocPanel.style.flex = 'none';
    tocPanel.style.height = newTocH + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  });
})();


let _copyRestoreTimer = null;
function copyRaw() {
  const copyBtn = document.getElementById('btn-copy');
  navigator.clipboard.writeText(editor.value).then(() => {
    // Snapshot button state once; if a copy is already in flight the
    // timer has been cancelled but the prev* values still hold the
    // original pre-copy state from the first call.
    if (_copyRestoreTimer === null) {
      copyRaw._prevText  = copyBtn.textContent;
      copyRaw._prevStyle = copyBtn.getAttribute('style') || '';
    }
    clearTimeout(_copyRestoreTimer);
    copyBtn.textContent = '✓ copied!';
    copyBtn.style.color       = 'var(--green)';
    copyBtn.style.borderColor = 'var(--green)';
    copyBtn.style.background  = 'rgba(63,185,80,0.12)';
    copyBtn.style.opacity     = '1';
    _copyRestoreTimer = setTimeout(() => {
      copyBtn.textContent = copyRaw._prevText;
      copyBtn.setAttribute('style', copyRaw._prevStyle);
      _copyRestoreTimer  = null;
    }, 1500);
  });
}

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

  if (mode === 'editor') {
    lp.style.display = 'flex';
    rp.style.display = 'none';
    dv.style.display = 'none';
  } else if (mode === 'preview') {
    lp.style.display = 'none';
    rp.style.display = 'flex';
    dv.style.display = 'none';
  } else { // both
    lp.style.display = 'flex';
    rp.style.display = 'flex';
    dv.style.display = '';
  }

  // Update button active states
  ['editor','both','preview'].forEach(m => {
    document.getElementById('btn-view-' + m).classList.toggle('active', m === mode);
  });

  saveConfig();
}
// ── Pane divider drag ─────────────────────────────
(function() {
  const divider  = document.getElementById('divider');
  const leftPane = document.getElementById('left-pane');
  const rightPane= document.getElementById('right-pane');
  let dragging   = false;

  divider.addEventListener('mousedown', () => {
    dragging = true;
    divider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const rect  = document.getElementById('panes').getBoundingClientRect();
    const pct   = Math.max(20, Math.min(80, (e.clientX - rect.left) / (rect.width - divider.offsetWidth) * 100));
    leftPane.style.flex  = 'none';
    leftPane.style.width = pct + '%';
    rightPane.style.flex  = 'none';
    rightPane.style.width = (100 - pct) + '%';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

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
    B -- Yes --> C[Ship it 🚀]
    B -- No  --> D[Debug]
    D --> E[Fix the bug]
    E --> B
\`\`\`

---

*Happy writing!* ✨
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
  let totalBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key);
    // En UTF-16 cada carácter ocupa 2 bytes
    totalBytes += (key.length + value.length) * 2;
  }

  // Límite estimado de 5MB en bytes (5 * 1024 * 1024)
  const maxBytes = 5242880; 
  const percentage = ((totalBytes / maxBytes) * 100).toFixed(1);
  const sizeInKB = (totalBytes / 1024).toFixed(1);

  const storageElem = document.getElementById('storage-count');
  if (storageElem) {
    storageElem.textContent = `${percentage}% (${sizeInKB} KB)`;
    
    // Cambiar color de advertencia según el uso
    if (percentage > 90) {
      storageElem.style.color = 'var(--red)';
    } else if (percentage > 70) {
      storageElem.style.color = 'var(--orange)';
    } else {
      storageElem.style.color = 'var(--text-muted)';
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
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function dismissWarning() {
  document.getElementById('warning-footer').style.display = 'none';
  localStorage.setItem('md_warning_dismissed', '1');
  saveConfig();
}

// ═══════════════════════════════════════════════════
//  Init
// ═══════════════════════════════════════════════════
function loadConfig() {
  return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
}

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
      notes.push({ id, name });
      localStorage.setItem(noteContent(id), localStorage.getItem(k) ?? '');
      localStorage.removeItem(k);
    });
    saveIndex();
  }

  // Ensure at least one note exists
  if (notes.length === 0) {
    const id = genId();
    notes.push({ id, name: 'README' });
    saveIndex();
    saveContent(id, DEFAULT_CONTENT('README'));
  }

  renderSidebar();
  // Restore the last-active note if it still exists; fall back to the first note.
  try {
    const cfg = loadConfig();
    const savedId = cfg.activeId && notes.find(n => n.id === cfg.activeId) ? cfg.activeId : null;
    switchNote(savedId || notes[0].id);
  } catch(e) {
    switchNote(notes[0].id);
  }

  // Restore saved config
  try {
    const cfg = loadConfig();

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
    // (warning footer: show unless user has explicitly dismissed it)

  } catch(e) {}

  // Apagamos la bandera: a partir de ahora cualquier cambio del usuario sí se guardará
  isInitializing = false;

  updateLocalStorageUsage();

  // Show warning footer unless user has previously dismissed it
  if (!localStorage.getItem('md_warning_dismissed')) {
    document.getElementById('warning-footer').style.display = 'flex';
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
  document.getElementById('hk-overlay').classList.add('open');
  document.getElementById('hk-close').focus();
}
function closeHkModal() {
  document.getElementById('hk-overlay').classList.remove('open');
}

// ═══════════════════════════════════════════════════
//  Expose functions referenced by inline onclick/oninput/onchange
//  HTML attributes — those run in global scope, but everything in
//  this file now lives inside boot() to delay startup until the
//  CodeMirror module (loaded separately as type="module") is ready.
// ═══════════════════════════════════════════════════
Object.assign(window, {
  closeHkModal, copyRaw, createNote, dismissWarning, downloadMd, exportHtml, exportPdf,
  fmt, fmtBlock, fmtLine, insertLink, insertText, loadMd, openHkModal,
  resetAllData, setViewMode, tocJump, toggleHighlight, toggleSidebar,
  toggleToc, toggleWrap, toggleSyncScroll, renameCurrentNote, onMdFileLoad,
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
