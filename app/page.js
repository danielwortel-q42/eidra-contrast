'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// ── Constants ─────────────────────────────────────────────────────────────────
const AA_SMALL      = 4.5;
const AA_LARGE      = 3.0;
const AAA_SMALL     = 7.0;
const AAA_LARGE     = 4.5;
const AA_THRESHOLD  = 4.5;
const AAA_THRESHOLD = 7.0;
const TILE_MIN      = 150;
const TILE_MAX      = 999;
const ROW_HDR_MIN   = 60;
const ROW_HDR_MAX   = 90;
const ROW_HDR_PCT   = 0.08;
const GRID_GAP      = 5;
const SUGGEST_STEPS = 70;
const HEX_RE        = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

// ── Colour utilities ──────────────────────────────────────────────────────────
const hexToRgb = hex => {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (r, g, b) =>
  '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('').toUpperCase();
const relativeLuminance = hex =>
  hexToRgb(hex).reduce((acc, ch, i) => {
    let v = ch / 255;
    v = v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    return acc + v * [0.2126, 0.7152, 0.0722][i];
  }, 0);
const contrastRatio = (a, b) => {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const readableInk = hex => relativeLuminance(hex) > 0.179 ? '#111' : '#fff';
const findSuggestion = (fg, bg, direction, target, minRatio) => {
  const base   = hexToRgb(target === 'fg' ? fg : bg);
  const toward = direction === 'lighter' ? 255 : 0;
  for (let step = 1; step <= SUGGEST_STEPS; step++) {
    const f = step / SUGGEST_STEPS;
    const candidate = rgbToHex(
      base[0] + (toward - base[0]) * f,
      base[1] + (toward - base[1]) * f,
      base[2] + (toward - base[2]) * f,
    );
    const ratio = target === 'fg'
      ? contrastRatio(candidate, bg)
      : contrastRatio(fg, candidate);
    if (ratio >= minRatio) return { hex: candidate, ratio };
  }
  return null;
};

// ── Toggle Pill ───────────────────────────────────────────────────────────────
function TogglePill({ value, options, onChange }) {
  const trackRef = useRef(null);
  const btnRefs  = useRef([]);
  const [pillStyle, setPillStyle] = useState({});

  useEffect(() => {
    const idx = options.findIndex(o => o.value === value);
    const btn = btnRefs.current[idx];
    if (btn && trackRef.current) {
      const trackLeft = trackRef.current.getBoundingClientRect().left;
      const btnRect   = btn.getBoundingClientRect();
      setPillStyle({ left: btnRect.left - trackLeft, width: btnRect.width });
    }
  }, [value, options]);

  return (
    <div className="m-tabs">
      <div className="m-toggle" ref={trackRef}>
        <div className="m-toggle-pill" style={pillStyle} />
        {options.map((opt, i) => (
          <button
            key={opt.value}
            ref={el => { btnRefs.current[i] = el; }}
            className={'m-toggle-opt' + (value === opt.value ? ' on' : '')}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Home() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef(null);
  const toastTimer   = useRef(null);
  const inputRef     = useRef(null);

  const [colours,      setColours]      = useState([]);
  const [disabled,     setDisabled]     = useState(new Set());
  const [canUndo,      setCanUndo]      = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState(null);
  const [dragIndex,    setDragIndex]    = useState(null);
  const [dragOver,     setDragOver]     = useState(null);
  const [inputVal,     setInputVal]     = useState('');
  const [modal,        setModal]        = useState(null);
  const [toast,        setToast]        = useState({ show: false, msg: '' });
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [sourceUrl,    setSourceUrl]    = useState('');

  useEffect(() => {
    const raw  = searchParams.get('colours');
    const site = searchParams.get('site');
    if (site) setSourceUrl(decodeURIComponent(site));
    if (!raw) return;
    const loaded = [...new Set(
      raw.split(',').map(t => {
        const v = (t.trim().startsWith('#') ? t.trim() : '#' + t.trim()).toUpperCase();
        return HEX_RE.test(v) ? v : null;
      }).filter(Boolean)
    )];
    if (loaded.length) setColours(loaded);
  }, []);

  useEffect(() => {
    const query  = colours.map(c => c.replace('#', '')).join(',');
    const params = new URLSearchParams();
    if (query)     params.set('colours', query);
    if (sourceUrl) params.set('site', encodeURIComponent(sourceUrl));
    const qs = params.toString();
    router.replace(qs ? '/?' + qs : '/', { scroll: false });
  }, [colours, sourceUrl]);

  const showToast = msg => {
    clearTimeout(toastTimer.current);
    setToast({ show: true, msg });
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, show: false })), 2000);
  };
  const copyHex = hex => {
    navigator.clipboard.writeText(hex).catch(() => {});
    showToast('Copied ' + hex + '!');
  };

  const isUrl = v => {
    try { new URL(v.includes('://') ? v : 'https://' + v); return v.includes('.'); }
    catch { return false; }
  };

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const onDragStart = (e, i) => {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragEnter = (e, i) => { e.preventDefault(); setDragOver(i); };
  const onDragOver  = e => e.preventDefault();
  const onDrop      = (e, i) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === i) { setDragIndex(null); setDragOver(null); return; }
    setColours(c => {
      const next = [...c];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIndex(null);
    setDragOver(null);
  };
  const onDragEnd = () => { setDragIndex(null); setDragOver(null); };

  const handleKeyDown = async e => {
    if (e.key === 'Backspace' && inputVal === '' && colours.length) {
      setColours(c => c.slice(0, -1));
      setCanUndo(false);
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = inputVal.trim();
    if (!raw) return;
    setError('');

    if (isUrl(raw)) {
      setInputVal('');
      setLoading(true);
      try {
        const res  = await fetch('/api/extract?url=' + encodeURIComponent(raw));
        const data = await res.json();
        if (!res.ok || !data.colors?.length) throw new Error(data.error || 'No colours found');
        const extracted = data.colors.map(c => c.hex.toUpperCase());
        setSourceUrl(raw);
        setColours(extracted);
        setCanUndo(false);
      } catch (err) {
        setError(err.message);
      }
      setLoading(false);
      return;
    }

    const toAdd = raw.split(',')
      .map(t => {
        let v = t.trim();
        if (!v) return null;
        if (!v.startsWith('#')) v = '#' + v;
        if (!HEX_RE.test(v)) return null;
        return v.toUpperCase();
      })
      .filter(Boolean)
      .filter(v => !colours.includes(v));

    if (!toAdd.length) {
      setError('Enter a valid HEX colour (e.g. #FF885A) or a URL.');
      return;
    }
    setInputVal('');
    setColours(c => [...c, ...toAdd]);
    setCanUndo(false);
  };

  const removeColour = i => {
    setColours(c => c.filter((_, idx) => idx !== i));
    setCanUndo(false);
  };

  const undo = () => {
    if (!canUndo || !undoSnapshot) return;
    setColours(undoSnapshot.colours);
    setDisabled(undoSnapshot.disabled);
    setCanUndo(false);
    setUndoSnapshot(null);
  };

  const clear = () => {
    setColours([]);
    setDisabled(new Set());
    setCanUndo(false);
    setUndoSnapshot(null);
    setError('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const tileKey       = (fi, bi) => fi + '-' + bi;
  const isOff         = (fi, bi) => disabled.has(tileKey(fi, bi));
  const toggleDisable = (fi, bi) => {
    setDisabled(d => {
      const next = new Set(d);
      const k = tileKey(fi, bi);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const computeLayout = useCallback(() => {
    if (!containerRef.current) return { rowHdrW: 80, tileW: 150 };
    const st      = getComputedStyle(containerRef.current);
    const usable  = containerRef.current.clientWidth
      - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
    const rowHdrW = Math.max(ROW_HDR_MIN, Math.min(ROW_HDR_MAX, usable * ROW_HDR_PCT));
    const tileW   = Math.max(TILE_MIN, Math.min(TILE_MAX,
      Math.floor((usable - rowHdrW - GRID_GAP * colours.length) / colours.length)
    ));
    return { rowHdrW, tileW };
  }, [colours.length]);

  // ── PDF export ────────────────────────────────────────────────────────────
  const exportPDF = async () => {
    const { jsPDF } = await import('jspdf');
    const doc  = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw   = doc.internal.pageSize.getWidth();
    const ph   = doc.internal.pageSize.getHeight();
    const n    = colours.length;
    const M    = 14;
    const WHITE = [255, 255, 255];
    const DARK  = [17, 17, 17];
    const MID   = [156, 163, 175];
    const STRIP = [30, 30, 30];

    const pdfBg  = () => { doc.setFillColor(...DARK); doc.rect(0, 0, pw, ph, 'F'); };
    const pdfInk = hex => readableInk(hex) === '#fff' ? WHITE : DARK;

    // Cover
    pdfBg();
    const lineH      = 26;
    const exportDate = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    const metaLines  = [sourceUrl ? 'Source: ' + sourceUrl : null, 'Exported on ' + exportDate].filter(Boolean);
    const startY     = (ph - (lineH * 3 + 10 + metaLines.length * 6)) / 2 + lineH + 10;
    const leftX      = pw / 2 - 60;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(64); doc.setTextColor(...WHITE);
    doc.text('Colour',   leftX,          startY);
    doc.text('Contrast', leftX + 20,     startY + lineH);
    doc.text('Checker',  leftX,          startY + lineH * 2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...MID);
    metaLines.forEach((l, i) => doc.text(l, leftX, startY + lineH * 2 + 10 + i * 6));
    doc.addPage();

    // Matrix
    const HDR_H = 8, ROW_W = 18, START_Y = 27, G = 2;
    const tW = Math.max(4, Math.floor(Math.min(
      (pw - M * 2 - ROW_W - G - (n - 1) * G) / n,
      (ph - START_Y - HDR_H - G - (n - 1) * G - M) / n
    )));
    pdfBg();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...WHITE);
    doc.text('Colour Contrast Matrix', M, 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MID);
    doc.text(n + ' colours · ' + (n * n - n) + ' combinations', M, 22);
    colours.forEach((c, ci) => {
      const cx = M + ROW_W + G + ci * (tW + G);
      doc.setFillColor(...hexToRgb(c)); doc.roundedRect(cx, START_Y, tW, HDR_H, 1, 1, 'F');
      doc.setFontSize(Math.min(7, tW * 0.28)); doc.setFont('helvetica', 'bold'); doc.setTextColor(...pdfInk(c));
      doc.text(c, cx + tW / 2, START_Y + HDR_H * 0.72, { align: 'center' });
    });
    colours.forEach((fg, fi) => {
      const fy = START_Y + HDR_H + G + fi * (tW + G);
      doc.setFillColor(...hexToRgb(fg)); doc.roundedRect(M, fy, ROW_W, tW, 1, 1, 'F');
      doc.setFontSize(Math.min(7, tW * 0.28)); doc.setFont('helvetica', 'bold'); doc.setTextColor(...pdfInk(fg));
      doc.text(fg, M + ROW_W / 2, fy + tW / 2 + 1.2, { align: 'center' });
      colours.forEach((bg, bi) => {
        const bx = M + ROW_W + G + bi * (tW + G);
        if (fi === bi) { doc.setFillColor(30, 30, 30); doc.roundedRect(bx, fy, tW, tW, 1.5, 1.5, 'F'); return; }
        doc.setFillColor(...hexToRgb(bg)); doc.roundedRect(bx, fy, tW, tW, 1.5, 1.5, 'F');
        doc.setTextColor(...hexToRgb(fg)); doc.setFontSize(tW * 0.35); doc.setFont('helvetica', 'bold');
        doc.text('Ag', bx + tW / 2, fy + tW / 2 + tW * 0.12, { align: 'center' });
      });
    });

    // Combos
    const combos = [];
    colours.forEach(fg => colours.forEach(bg => {
      if (fg === bg) return;
      const ratio    = contrastRatio(fg, bg);
      const aaSmall  = ratio >= AA_SMALL,  aaLarge  = ratio >= AA_LARGE;
      const aaaSmall = ratio >= AAA_SMALL, aaaLarge = ratio >= AAA_LARGE;
      combos.push({ fg, bg, ratio, aaSmall, aaLarge, aaaSmall, aaaLarge, passes: aaSmall || aaLarge });
    }));

    const CCOLS = 6, CARD_G = 4, CARD_H = 48, CSTART_Y = 28;
    const CARD_W  = Math.floor((pw - M * 2 - (CCOLS - 1) * CARD_G) / CCOLS);
    const ROWS_PP = Math.floor((ph - CSTART_Y - M) / (CARD_H + CARD_G));
    const PER_PAGE = CCOLS * ROWS_PP;
    const COLOR_AAA = [74, 222, 128], COLOR_AA = [250, 204, 21], COLOR_FAIL = [248, 113, 113];

    const drawBadge = (aa, aaa, x, y, w) => {
      const col = aaa ? COLOR_AAA : aa ? COLOR_AA : COLOR_FAIL;
      doc.setFillColor(...col); doc.setGState(new doc.GState({ opacity: 0.15 }));
      doc.roundedRect(x, y - 3.5, w, 5, 0.8, 0.8, 'F');
      doc.setGState(new doc.GState({ opacity: 1 })); doc.setTextColor(...col);
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
      doc.text((aaa ? 'AAA' : aa ? 'AA' : 'AA') + ' ' + (aaa || aa ? 'Pass' : 'Fail'), x + w / 2, y, { align: 'center' });
    };
    const drawCard = (combo, x, y) => {
      const PH = 22, IH = CARD_H - PH;
      doc.setFillColor(...hexToRgb(combo.bg)); doc.roundedRect(x, y, CARD_W, PH, 2, 2, 'F');
      doc.setTextColor(...hexToRgb(combo.fg)); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
      doc.text('Ag', x + CARD_W / 2, y + PH * 0.48, { align: 'center' });
      const pX = x + CARD_W / 2 - 10, pY = y + PH - 7;
      doc.setFillColor(255, 255, 255); doc.roundedRect(pX, pY, 20, 5, 2, 2, 'F');
      doc.setTextColor(17, 17, 17); doc.setFontSize(5); doc.setFont('helvetica', 'bold');
      doc.text(combo.ratio.toFixed(1) + ':1', x + CARD_W / 2, pY + 3.65, { align: 'center' });
      doc.setFillColor(...STRIP); doc.roundedRect(x, y + PH, CARD_W, IH, 0, 2, 'F');
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...WHITE);
      doc.text(combo.fg + ' on ' + combo.bg, x + 2.5, y + PH + 6);
      doc.setTextColor(...MID); doc.text('Small', x + 2.5, y + PH + 12);
      drawBadge(combo.aaSmall, combo.aaaSmall, x + 17, y + PH + 12, 22);
      doc.setTextColor(...MID); doc.text('Large', x + 2.5, y + PH + 18.5);
      drawBadge(combo.aaLarge, combo.aaaLarge, x + 17, y + PH + 18.5, 22);
    };
    const drawSection = (list, title, sub) => {
      if (!list.length) return;
      let idx = 0;
      doc.addPage(); pdfBg();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...WHITE); doc.text(title, M, 16);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MID); doc.text(sub, M, 22);
      list.forEach(combo => {
        const pos = idx % PER_PAGE;
        if (idx > 0 && pos === 0) {
          doc.addPage(); pdfBg();
          doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...WHITE); doc.text(title + ' (cont.)', M, 16);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MID); doc.text(sub, M, 22);
        }
        drawCard(combo, M + (pos % CCOLS) * (CARD_W + CARD_G), CSTART_Y + Math.floor(pos / CCOLS) * (CARD_H + CARD_G));
        idx++;
      });
    };
    drawSection(combos.filter(c => c.passes),  'Compliant Combinations',     combos.filter(c =>  c.passes).length + ' combinations are compliant');
    drawSection(combos.filter(c => !c.passes), 'Non-Compliant Combinations', combos.filter(c => !c.passes).length + ' combinations are non-compliant');
    doc.save('colour-contrast.pdf');
  };

  // ── Modal ─────────────────────────────────────────────────────────────────
  const openModal  = (fi, bi) => setModal({ fgIndex: fi, bgIndex: bi, target: 'fg', picked: null });
  const closeModal = () => setModal(null);
  const applyModal = () => {
    if (!modal?.picked) return;
    setUndoSnapshot({ colours: [...colours], disabled: new Set(disabled) });
    setCanUndo(true);
    setColours(c => {
      const next = [...c];
      if (modal.target === 'fg') next[modal.fgIndex] = modal.picked;
      else next[modal.bgIndex] = modal.picked;
      return next;
    });
    closeModal();
  };

  const n          = colours.length;
  const showMatrix = n >= 2;
  const { rowHdrW, tileW } = computeLayout();
  const modalFg    = modal ? colours[modal.fgIndex] : null;
  const modalBg    = modal ? colours[modal.bgIndex] : null;
  const SUGG_GROUPS = [
    { label: 'AA',  cls: 'aa',  min: AA_THRESHOLD  },
    { label: 'AAA', cls: 'aaa', min: AAA_THRESHOLD },
  ];

  return (
    <div className="container" ref={containerRef} style={{ paddingBottom: 24 }}>

      {/* Topbar */}
      <div className="topbar">
        <div>
          <h1 onClick={clear} style={{ cursor: 'pointer' }}>
            Colour<br />
            <span style={{ paddingLeft: 20 }}>Contrast Checker</span>
          </h1>
        </div>
        <div className="topbar-right">
          <div className="url-input-row" style={{ maxWidth: '100%' }}>
            <div
              className="url-input"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', height: 'auto', minHeight: 52, flex: 1 }}
            >
              {colours.map((c, i) => {
                const ink = readableInk(c);
                return (
                  <span
                    key={c}
                    className="chip"
                    style={{
                      background: c,
                      color: ink,
                      cursor: 'grab',
                      opacity: dragIndex === i ? 0.4 : 1,
                      outline: dragOver === i && dragIndex !== i ? '2px solid #fff' : 'none',
                      transition: 'opacity 0.15s, outline 0.1s',
                    }}
                    draggable
                    onDragStart={e => onDragStart(e, i)}
                    onDragEnter={e => onDragEnter(e, i)}
                    onDragOver={onDragOver}
                    onDrop={e => onDrop(e, i)}
                    onDragEnd={onDragEnd}
                  >
                    <span className="chip-dot" style={{ background: ink === '#fff' ? 'rgba(255,255,255,.3)' : 'rgba(0,0,0,.2)' }} />
                    {c}
                    <span className="chip-x" onClick={() => removeColour(i)}>×</span>
                  </span>
                );
              })}
              <input
                ref={inputRef}
                type="text"
                value={inputVal}
                onChange={e => { setInputVal(e.target.value); setError(''); }}
                onKeyDown={handleKeyDown}
                placeholder={n === 0 ? 'Enter a URL or HEX colour — e.g. https://stripe.com or #FF885A' : 'Add another colour…'}
                style={{ background: 'none', border: 'none', outline: 'none', color: '#ffffff', fontSize: '0.95rem', flex: 1, minWidth: 160, fontFamily: 'inherit' }}
                disabled={loading}
                autoFocus
              />
            </div>
            {n >= 1 && (
              <button className="btn-primary danger" onClick={clear}>
                ✕ Clear
              </button>
            )}
            {canUndo && (
              <button
                className="btn-primary"
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)' }}
                onClick={undo}
              >
                ↩ Undo
              </button>
            )}
            {n >= 2 && (
              <button className="btn-primary" onClick={exportPDF}>
                ↓ Export PDF
              </button>
            )}
          </div>
          {loading && (
            <div className="status-msg">
              <span className="spinner" />
              Extracting colours…
            </div>
          )}
          {error && (
            <p className="error-msg">
              {error} — try a different URL, or enter HEX codes manually e.g.{' '}
              <code style={{ color: 'var(--pass)', fontFamily: 'monospace' }}>#FF885A</code>
            </p>
          )}
        </div>
      </div>

      {/* Empty / one-colour state */}
      {!showMatrix && (
        <div className="empty">
          <div className="empty-emoji">{n === 0 ? '🎨' : '👀'}</div>
          <h2>{n === 0 ? "Extract any website's colour palette." : "You're almost there…"}</h2>
          <p>
            {n === 0
              ? 'Enter a URL to pull dominant colours from any public website, or enter a HEX code to build a palette manually — then check them against WCAG accessibility standards.'
              : 'We need at least two colours to start checking. Add one more!'}
          </p>
          {n === 0 && (
            <p style={{ marginTop: 16 }}>
              Great design is not just about looking good — it is about working for everyone.
              WCAG guidelines ensure your colours have enough contrast for people with visual
              impairments, colour blindness, or situational limitations.
            </p>
          )}
          <div className="empty-hint">
            {n === 0
              ? <span>Paste a URL or type a HEX like <code>#FF885A</code> and press <code>Enter</code></span>
              : <span>Add another HEX colour and press <code>Enter</code></span>
            }
          </div>
        </div>
      )}

      {/* Matrix */}
      {showMatrix && (
        <div className="fade-up" style={{ marginTop: 8, width: '100%', overflowX: 'auto' }}>
          <div
            className="matrix"
            style={{ gridTemplateColumns: rowHdrW + 'px repeat(' + n + ', ' + tileW + 'px)' }}
          >
            <div style={{ width: rowHdrW, height: 36 }} />
            {colours.map(c => (
              <div key={c} className="col-hdr" style={{ background: c, color: readableInk(c) }}>
                {c}
              </div>
            ))}
            {colours.map((fg, fi) => (
              <React.Fragment key={'row-' + fi}>
                <div
                  className="row-hdr"
                  style={{ background: fg, color: readableInk(fg), height: tileW }}
                  onClick={() => copyHex(fg)}
                >
                  {fg}
                </div>
                {colours.map((bg, bi) => {
                  if (fi === bi) return (
                    <div key={'blank-' + fi + '-' + bi} className="tile blank" style={{ height: tileW }} />
                  );
                  const ratio  = contrastRatio(fg, bg);
                  const off    = isOff(fi, bi);
                  const passes = {
                    aaSmall:  ratio >= AA_SMALL,
                    aaLarge:  ratio >= AA_LARGE,
                    aaaSmall: ratio >= AAA_SMALL,
                    aaaLarge: ratio >= AAA_LARGE,
                  };
                  return (
                    <div
                      key={fi + '-' + bi}
                      className={'tile' + (off ? ' off' : '')}
                      style={{ background: bg, color: fg, height: tileW }}
                    >
                      <div className="notch" style={{ opacity: off ? 0.35 : 1 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {[['Small', passes.aaSmall, passes.aaaSmall], ['Large', passes.aaLarge, passes.aaaLarge]].map(([label, aa, aaa]) => {
                            const color = aaa ? '#4ade80' : aa ? '#facc15' : '#f87171';
                            const badge = aaa ? 'AAA ✓' : aa ? 'AA ✓' : 'AA ✗';
                            return (
                              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ color: '#999', fontSize: 12, width: 38, flexShrink: 0 }}>{label}</span>
                                <span style={{ fontSize: 12, fontWeight: 800, color, background: color + '22', padding: '1px 6px', borderRadius: 4 }}>{badge}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div style={{
                        position: 'absolute', bottom: 10, left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(255,255,255,0.92)', color: '#111',
                        fontSize: 12, fontWeight: 800,
                        padding: '3px 10px', borderRadius: 99,
                        whiteSpace: 'nowrap', zIndex: 1,
                      }}>{ratio.toFixed(1) + ':1'}</div>
                      {off && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3, pointerEvents: 'none' }}>
                          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                            <circle cx="16" cy="16" r="14" stroke="rgba(255,255,255,0.7)" strokeWidth="2" />
                            <line x1="8" y1="8" x2="24" y2="24" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </div>
                      )}
                      <div className="aa-lg">Ag</div>
                      <div className="aa-sm">Ag</div>
                      <div className="tile-ov" style={{ zIndex: 10 }}>
                        <button className="ov-btn" onClick={() => toggleDisable(fi, bi)}>
                          {off ? 'Enable' : 'Disable'}
                        </button>
                        {!off && (
                          <button className="ov-btn improve" onClick={() => openModal(fi, bi)}>
                            Improve
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal">
            <div className="modal-hdr">
              <h2>Improve Combination</h2>
              <button className="modal-x" onClick={closeModal}>×</button>
            </div>
            <div className="modal-sub">
              {modalFg + ' on ' + modalBg + ' · Ratio: ' + contrastRatio(modalFg, modalBg).toFixed(1) + ':1'}
            </div>
            <div
              className="modal-prev"
              style={{
                background: modal.target === 'bg' && modal.picked ? modal.picked : modalBg,
                color:      modal.target === 'fg' && modal.picked ? modal.picked : modalFg,
              }}
            >
              Ag
            </div>
            <TogglePill
              value={modal.target}
              options={[{ value: 'fg', label: 'Text colour' }, { value: 'bg', label: 'Background colour' }]}
              onChange={t => setModal(m => ({ ...m, target: t, picked: null }))}
            />
            {SUGG_GROUPS.map(group => {
              const lighter = findSuggestion(modalFg, modalBg, 'lighter', modal.target, group.min);
              const darker  = findSuggestion(modalFg, modalBg, 'darker',  modal.target, group.min);
              return (
                <div key={group.label} className="sugg-group">
                  <div className={'sugg-group-lbl ' + group.cls}>
                    {group.label + ' Compliant Suggestions'}
                  </div>
                  <div className="m-suggs">
                    {[['Lighter', lighter], ['Darker', darker]].map(([lbl, res]) => (
                      <div
                        key={lbl}
                        className={'m-sugg' + (modal.picked === res?.hex ? ' picked' : '')}
                        onClick={() => { if (res) setModal(m => ({ ...m, picked: res.hex })); }}
                      >
                        <div className="ms-lbl">{lbl}</div>
                        {res ? (
                          <div>
                            <div className="ms-swatch" style={{ background: res.hex }} />
                            <div className="ms-hex">{res.hex}</div>
                            <div className="ms-meta">
                              <span className="ms-ratio-pill">{res.ratio.toFixed(1)}:1</span>
                              <span className={'ms-badge ' + group.cls}>{group.label} ✓</span>
                            </div>
                          </div>
                        ) : (
                          <div className="ms-none">No accessible options found</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="modal-ftr">
              <button className="m-cancel" onClick={closeModal}>Cancel</button>
              <button className="m-update" disabled={!modal.picked} onClick={applyModal}>
                Update Colour
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={'toast' + (toast.show ? ' show' : '')}>{toast.msg}</div>

      <footer style={{
        marginTop: 60,
        textAlign: 'center',
        color: '#fff',
        fontSize: '1rem',
        fontFamily: '"Comic Sans MS", "Comic Sans", cursive',
        fontWeight: 700,
        padding: '14px 24px',
      }}>
        Accessible with love by STEAM 🚀
      </footer>
    </div>
  );
}