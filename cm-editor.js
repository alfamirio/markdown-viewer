// ── CodeMirror 6 setup ──────────────────────────────
  // Builds the editor instance and exposes a small shim on
  // window.editor that mimics the <textarea> API surface the rest of
  // the app (written before this rewrite) was built against —
  // .value, .selectionStart/.selectionEnd, .setSelectionRange(),
  // .scrollTop/.scrollHeight/.clientHeight/.clientWidth, .focus(),
  // .className, and addEventListener('input'|'scroll'|'keydown'|'keyup'|'click').
  // This lets fmt(), hotkeys, autosave, TOC jump, PDF export, etc.
  // keep working with little to no change.
  import { EditorView, keymap, placeholder, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
  import { EditorState, Compartment, Annotation } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap, deleteLine } from "@codemirror/commands";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { syntaxHighlighting, HighlightStyle, bracketMatching } from "@codemirror/language";
  import { tags } from "@lezer/highlight";

  // Highlight style mapped onto this app's existing CSS color tokens
  // (read live so it still respects the page's design tokens).
  const css = getComputedStyle(document.documentElement);
  const tok = name => css.getPropertyValue(name).trim();
  const mdHighlightStyle = HighlightStyle.define([
    // ── Headings — each level gets its own hue ────────────────────
    { tag: tags.heading1,              color: '#ff7b72', fontWeight: '700', fontSize: '1.2em' },
    { tag: tags.heading2,              color: '#ffa657', fontWeight: '700', fontSize: '1.1em' },
    { tag: tags.heading3,              color: '#f2cc60', fontWeight: '700' },
    { tag: tags.heading4,              color: '#7ee787', fontWeight: '600' },
    { tag: tags.heading5,              color: '#79c0ff', fontWeight: '600' },
    { tag: tags.heading6,              color: '#d2a8ff', fontWeight: '600' },
    { tag: tags.heading,               color: '#ff7b72', fontWeight: '700' }, // fallback

    // ── Links & URLs ──────────────────────────────────────────────
    { tag: tags.link,                  color: '#3fb950', fontWeight: '600' },   // [name] → green
    { tag: tags.url,                   color: '#58a6ff', fontStyle: 'italic' }, // (url)  → blue
    { tag: tags.special(tags.brace),   color: '#d2a8ff' },

    // ── Blockquote ────────────────────────────────────────────────
    { tag: tags.quote,                 color: '#c9d1d9', fontStyle: 'italic' },

    // ── Markup punctuation (##, **, __, ~~, >, -, ``) ─────────────
    // These are the literal sigil characters — must be clearly visible
    { tag: tags.processingInstruction, color: '#aeb5bd', fontWeight: '700' },
    { tag: tags.meta,                  color: '#aeb5bd' },

    // ── Lists ─────────────────────────────────────────────────────
    { tag: tags.list,                  color: '#97eb9f' },

    // ── Horizontal rule ───────────────────────────────────────────
    { tag: tags.contentSeparator,      color: '#58faff', fontWeight: '700' },

    // ── Inline code ───────────────────────────────────────────────
    { tag: tags.monospace,             color: '#ffa657' },

    // ── Inline emphasis ───────────────────────────────────────────
    { tag: tags.strong,                color: '#ffa657', fontWeight: '700' },
    { tag: tags.emphasis,              color: '#d2a8ff', fontStyle: 'italic' },
    { tag: tags.strikethrough,         color: '#8b949e', textDecoration: 'line-through' },

    // ── Code fence — fenced block content (generic fallback) ──────
    { tag: tags.comment,               color: '#8b949e', fontStyle: 'italic' },

    // ── Code fence — language keywords ───────────────────────────
    { tag: tags.keyword,               color: '#ff7b72' },
    { tag: tags.controlKeyword,        color: '#ff7b72' },
    { tag: tags.definitionKeyword,     color: '#ff7b72' },
    { tag: tags.moduleKeyword,         color: '#ff7b72' },
    { tag: tags.operatorKeyword,       color: '#ff7b72' },

    // ── Code fence — values ───────────────────────────────────────
    { tag: tags.atom,                  color: '#79c0ff' },
    { tag: tags.bool,                  color: '#79c0ff' },
    { tag: tags.null,                  color: '#79c0ff' },
    { tag: tags.number,                color: '#79c0ff' },
    { tag: tags.integer,               color: '#79c0ff' },
    { tag: tags.float,                 color: '#79c0ff' },

    // ── Code fence — strings ──────────────────────────────────────
    { tag: tags.string,                color: '#a5d6ff' },
    { tag: tags.special(tags.string),  color: '#a5d6ff' },
    { tag: tags.regexp,                color: '#ffa657' },
    { tag: tags.escape,                color: '#ffa657' },

    // ── Code fence — names ────────────────────────────────────────
    { tag: tags.variableName,          color: '#e6edf3' },
    { tag: tags.local(tags.variableName), color: '#ffa657' },
    { tag: tags.definition(tags.variableName), color: '#f0883e' },
    { tag: tags.function(tags.variableName),   color: '#d2a8ff' },
    { tag: tags.propertyName,          color: '#7ee787' },
    { tag: tags.definition(tags.propertyName), color: '#7ee787' },
    { tag: tags.function(tags.propertyName),   color: '#d2a8ff' },
    { tag: tags.typeName,              color: '#ffa657' },
    { tag: tags.className,             color: '#f2cc60' },
    { tag: tags.namespace,             color: '#f2cc60' },
    { tag: tags.labelName,             color: '#ffa657' },

    // ── Code fence — operators & punctuation ──────────────────────
    { tag: tags.operator,              color: '#ff7b72' },
    { tag: tags.punctuation,           color: '#e6edf3' },
    { tag: tags.bracket,               color: '#e6edf3' },
    { tag: tags.separator,             color: '#e6edf3' },
    { tag: tags.derefOperator,         color: '#e6edf3' },

    // ── HTML tags inside markdown ─────────────────────────────────
    { tag: tags.tagName,               color: '#7ee787' },
    { tag: tags.attributeName,         color: '#79c0ff' },
    { tag: tags.attributeValue,        color: '#a5d6ff' },
    { tag: tags.angleBracket,          color: '#8b949e' },

    // ── Special / decorators ──────────────────────────────────────
    { tag: tags.special(tags.variableName), color: '#d2a8ff' },
    { tag: tags.annotation,            color: '#d2a8ff' },
    { tag: tags.modifier,              color: '#ff7b72' },
    { tag: tags.self,                  color: '#ff7b72' },
  ]);

  // Compartments let us flip wrap / highlighting on and off at runtime
  // without tearing down and rebuilding the whole editor state.
  const wrapCompartment      = new Compartment();
  const highlightCompartment = new Compartment();

  const highlightExt = syntaxHighlighting(mdHighlightStyle);

  // Tags transactions made by our own shim methods (.value = ..., _splice)
  // so the update listener below can mirror a real <textarea>'s behavior:
  // firing the 'input' callback only for changes that came from the user
  // typing/pasting, not from code setting .value directly (callers of
  // .value = already call render()/scheduleSave() themselves where needed,
  // e.g. switchNote()).
  const programmatic = Annotation.define();

  // defaultKeymap binds a few combos this app already uses for its own
  // hotkeys (Mod-i → italic, Mod-]/Mod-[ → next/prev note, Shift-Mod-k →
  // code block). Drop just those bindings so CM6's own keymap handling
  // doesn't fire alongside — and sometimes race against — handleKeys()
  // for the same keystroke; everything else in defaultKeymap (line
  // move/copy, escape, Mod-Enter, etc.) is kept since it doesn't collide.
  // Mod-d is intentionally NOT reserved here — it's wired to deleteLine below.
  const RESERVED_BY_APP = new Set(['Mod-i', 'Mod-]', 'Mod-[', 'Shift-Mod-k', 'Shift-Mod-K']);
  const safeDefaultKeymap = defaultKeymap.filter(b => !RESERVED_BY_APP.has(b.key) && !RESERVED_BY_APP.has(b.mac));

  const selectionTheme = EditorView.theme({
    // CM6 draws selection via .cm-selectionBackground on a layer div —
    // these rules ensure the colour is rich enough to read through any
    // token colour (italic purple, bold orange, green links, etc.)
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      background: '#2d4f8a !important',
    },
    '&.cm-focused .cm-selectionBackground': {
      background: '#3a5fa0 !important',
    },
    // Active line: bright enough to stand out against --surface (#161b22)
    // without washing out syntax colours on that line.
    '.cm-activeLine': {
      backgroundColor: '#1e2a3a !important',
      borderTop:       '1px solid #243040',
      borderBottom:    '1px solid #243040',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#1e2a3a !important',
      color:           '#58a6ff !important',
      fontWeight:      '600',
    },
    // Cursor: wide and light-blue so it stands out in dense dark text.
    '&.cm-focused .cm-cursor, &.cm-focused .cm-dropCursor': {
      borderLeftColor: '#93c5fd !important',
      borderLeftWidth: '3px    !important',
    },
  });

  const view = new EditorView({
    parent: document.getElementById('cm-host'),
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        bracketMatching(),
        history(),
        keymap.of([{ key: 'Mod-d', run: deleteLine }, ...safeDefaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        highlightCompartment.of(highlightExt),
        wrapCompartment.of(EditorView.lineWrapping),
        selectionTheme,
        placeholder('Start writing Markdown here…'),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !update.transactions.some(tr => tr.annotation(programmatic))) {
            window.editor._fireInput();
          }
        }),
      ],
    }),
  });

  // Forward native scroll events from CM's internal scroller. Keydown/keyup/
  // click are listened on contentDOM, since that's the element CodeMirror's
  // own DOM events (typing, clicking, key handling) actually fire on.
  view.scrollDOM.addEventListener('scroll', () => window.editor._fireScroll());
  view.contentDOM.addEventListener('click', () => window.editor._fireClick());
  view.contentDOM.addEventListener('keyup', e => window.editor._fireKeyup(e));
  view.contentDOM.addEventListener('keydown', e => window.editor._fireKeydown(e));

  // ── Textarea-compatibility shim ─────────────────────
  const listeners = { input: [], scroll: [], click: [], keyup: [], keydown: [] };

  window.editor = {
    _view: view,
    _wrapCompartment: wrapCompartment,
    _highlightCompartment: highlightCompartment,
    _highlightExt: highlightExt,

    get value() { return view.state.doc.toString(); },
    set value(v) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: v },
        annotations: programmatic.of(true),
      });
    },

    get selectionStart() { return view.state.selection.main.from; },
    get selectionEnd()   { return view.state.selection.main.to; },
    setSelectionRange(start, end) {
      const len = view.state.doc.length;
      start = Math.max(0, Math.min(start, len));
      end   = Math.max(0, Math.min(end, len));
      view.dispatch({ selection: { anchor: start, head: end }, scrollIntoView: true });
    },

    get scrollTop() { return view.scrollDOM.scrollTop; },
    set scrollTop(v) { view.scrollDOM.scrollTop = v; },
    get scrollHeight() { return view.scrollDOM.scrollHeight; },
    get clientHeight() { return view.scrollDOM.clientHeight; },
    get clientWidth()  { return view.scrollDOM.clientWidth; },

    focus() { view.focus(); },

    set className(cls) {
      const host = document.getElementById('cm-host');
      host.classList.remove('wrap', 'no-wrap');
      if (cls) host.classList.add(cls);
    },
    get className() { return document.getElementById('cm-host').className; },

    addEventListener(type, fn) {
      if (listeners[type]) listeners[type].push(fn);
    },

    // Insert text at [start, end), replacing any existing range —
    // used by fmt()/fmtLine()/insertText() via spliceText().
    _splice(start, end, text) {
      view.dispatch({
        changes: { from: start, to: end, insert: text },
        selection: { anchor: start + text.length },
      });
      view.focus();
    },

    _fireInput()     { listeners.input.forEach(fn => fn()); },
    _fireScroll()    { listeners.scroll.forEach(fn => fn()); },
    _fireClick()     { listeners.click.forEach(fn => fn()); },
    _fireKeyup(e)    { listeners.keyup.forEach(fn => fn(e)); },
    _fireKeydown(e)  { listeners.keydown.forEach(fn => fn(e)); },
    _fireSelection() { /* hook point if selection-only updates are ever needed */ },

    // Scroll so the line containing `pos` sits roughly a third of the
    // way down the viewport — used by tocJump(). Uses CM6's own layout
    // info (lineBlockAt) so it's exact even with wrapped lines, unlike
    // a manual lineHeight × lineNumber estimate.
    scrollPosIntoView(pos) {
      const block = view.lineBlockAt(pos);
      view.scrollDOM.scrollTop = block.top - view.scrollDOM.clientHeight / 3;
    },
  };

  // ── Wrap / highlight toggles (called from toggleWrap/toggleHighlight) ──
  window.editor.setWrap = on => {
    view.dispatch({ effects: wrapCompartment.reconfigure(on ? EditorView.lineWrapping : []) });
  };
  window.editor.setHighlight = on => {
    view.dispatch({ effects: highlightCompartment.reconfigure(on ? highlightExt : []) });
  };

  window.__cmReady = true;
  window.dispatchEvent(new Event('cm-ready'));
