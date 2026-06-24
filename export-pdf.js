// ═══════════════════════════════════════════════════
//  export-pdf.js — PDF / print export
//
//  Dependencies injected via initPdfExport({ ... }):
//    activeNoteName  — fn() → string  (active note title)
//    editor          — CodeMirror shim with .value getter
//    marked          — marked library (already configured by app.js)
//    mermaid         — mermaid library
//    MERMAID_DARK_CONFIG — the app's canonical dark-theme mermaid config
// ═══════════════════════════════════════════════════

// Call this once from boot() to wire up the PDF export.
// Returns { exportPdf } so the caller can expose it on window.
function initPdfExport({ activeNoteName, editor, marked, mermaid, MERMAID_DARK_CONFIG }) {

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

        // marging for headers
        if (/^h[1-6]$/.test(tag)) {
          const level = parseInt(tag[1]);
          const sz = [20, 17, 14.5, 12.5, 11.5, 11][level - 1];
          y += 3;
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
          y += 0;
          newPageIfNeeded(16);
          strokeLine(ML, y, ML + CW, '#000000');
          y += 24;
          return;
        }

        if (tag === 'blockquote') {
          y += 0; // margin above blockquote
          const BQ_SIZE = 10.5;
          const lh = BQ_SIZE * 1.45;
          // vPad: total vertical padding split evenly top/bottom (inside the rect).
          const vPad = 14;
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
          y = finalBottom + 8; // margin below blockquote
          return;
        }

        if (tag === 'pre') {
          y += 0; // margin above code block
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
          y = finalBottom + 8; // margin below code block
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
          y += 8; // margin above table
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
          y += 8; return; // margin below table
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

  return { exportPdf };
}
