'use client';

import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
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
const SUGG_GROUPS   = [
  { label: 'AA',  cls: 'aa',  min: AA_THRESHOLD  },
  { label: 'AAA', cls: 'aaa', min: AAA_THRESHOLD },
];

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
const isTouchDevice = () => typeof window !== 'undefined' && 'ontouchstart' in window;

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
function HomeInner() {
  
  const router        = useRouter();
  const searchParams  = useSearchParams();
  const containerRef  = useRef(null);
  const toastTimer    = useRef(null);
  const inputRef      = useRef(null);
  const activeTileRef = useRef(null);
  const logoRatioRef  = useRef(3);

  const [colours,      setColours]      = useState([]);
  const [disabled,     setDisabled]     = useState(new Set());
  const [canUndo,      setCanUndo]      = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState(null);
  const [dragIndex,    setDragIndex]    = useState(null);
  const [dragOver,     setDragOver]     = useState(null);
  const [activeTile,   setActiveTile]   = useState(null);
  const [modal,        setModal]        = useState(null);
  const [toast,        setToast]        = useState({ show: false, msg: '' });
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [sourceUrl,    setSourceUrl]    = useState('');
  const [inputVal,     setInputVal]     = useState('');
  
  const [comboView,    setComboView]    = useState('grid');
  const [, forceUpdate]                = useState(0);

  // Dismiss active tile when tapping outside
  useEffect(() => {
    const handler = e => {
      if (!activeTileRef.current) return;
      const tileEl = document.querySelector(`[data-tile="${activeTileRef.current}"]`);
      if (tileEl && tileEl.contains(e.target)) return;
      setActiveTile(null);
      activeTileRef.current = null;
    };
    document.addEventListener('touchend', handler);
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('touchend', handler);
      document.removeEventListener('mousedown', handler);
    };
  }, []);

  // Recalculate layout on resize
  useEffect(() => {
    const observer = new ResizeObserver(() => forceUpdate(n => n + 1));
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

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
  }, [colours, sourceUrl, router]);

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
    setDisabled(new Set());
    setCanUndo(false);
    setDragIndex(null);
    setDragOver(null);
  };
  const onDragEnd = () => { setDragIndex(null); setDragOver(null); };

  const handleKeyDown = async e => {
    if (e.key === 'Backspace' && inputVal === '' && colours.length) {
      setColours(c => c.slice(0, -1));
      setDisabled(new Set());
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
                  setError(err.message === 'No colours found' ? 'No colours were found because this site likely loads its styles via JavaScript, which our extractor cannot detect.' : err.message);
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
    setDisabled(new Set());
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
    setInputVal('');
    setSourceUrl('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const tileKey       = (fi, bi) => fi + '-' + bi;
  const isOff         = (fi, bi) => disabled.has(tileKey(fi, bi));
  const toggleDisable = (fi, bi) => {
    setDisabled(d => {
      const next = new Set(d);
      const k  = tileKey(fi, bi);
      const km = tileKey(bi, fi);
      if (next.has(k)) { next.delete(k); next.delete(km); }
      else             { next.add(k);    next.add(km);    }
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

    let logoBase64 = null;
    try {
      const svgRes  = await fetch('/Eidra_Q42_Black.svg');
      const svgText = await svgRes.text();
      const img     = new Image();
      const blob    = new Blob([svgText], { type: 'image/svg+xml' });
      const url     = URL.createObjectURL(blob);
      await new Promise(resolve => { img.onload = resolve; img.src = url; });
      const scale  = 3;
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth  * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d');
      ctx.filter = 'invert(1)';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      logoBase64 = canvas.toDataURL('image/png');
      logoRatioRef.current = img.naturalWidth / img.naturalHeight;
      URL.revokeObjectURL(url);
    } catch (_) {}

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const FONT_HDG = 'helvetica';
    const pw    = doc.internal.pageSize.getWidth();
    const ph    = doc.internal.pageSize.getHeight();
    const n     = colours.length;
    const M     = 14;
    const WHITE = [255, 255, 255];
    const DARK  = [17,  17,  17];
    const MID   = [156, 163, 175];
    const STRIP = [30,  30,  30];

    const addLogo = () => {
      if (!logoBase64) return;
      const LOGO_H = 8;
      const LOGO_W = LOGO_H * logoRatioRef.current;
      doc.addImage(logoBase64, 'PNG', pw - M - LOGO_W, 11, LOGO_W, LOGO_H);
    };
    const pdfBg  = () => { doc.setFillColor(...DARK); doc.rect(0, 0, pw, ph, 'F'); addLogo(); };
    const pdfInk = hex => readableInk(hex) === '#fff' ? WHITE : DARK;

    pdfBg();
    const lineH       = 26;
    const exportDate  = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    const metaLines   = [sourceUrl ? 'Source: ' + sourceUrl : null, 'Exported on ' + exportDate].filter(Boolean);
    const titleBlockH = lineH * 3;
    const totalH      = titleBlockH + 20 + metaLines.length * 8;
    const startY      = (ph - totalH) / 2 + lineH;
    const leftX       = pw / 2 - 60;
    doc.setFont(FONT_HDG, 'bold'); doc.setFontSize(64); doc.setTextColor(...WHITE);
    doc.text('Colour',   leftX,       startY);
    doc.text('Contrast', leftX + 10,  startY + lineH);
    doc.text('Checker',  leftX,       startY + lineH * 2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...MID);
    metaLines.forEach((l, i) => doc.text(l, leftX, startY + titleBlockH + 20 + i * 8));
    doc.addPage();

    const HDR_H = 8, ROW_W = 18, START_Y = 27, G = 2;
    const tW = Math.max(4, Math.floor(Math.min(
      (pw - M * 2 - ROW_W - G - (n - 1) * G) / n,
      (ph - START_Y - HDR_H - G - (n - 1) * G - M) / n
    )));
    pdfBg();
    doc.setFont(FONT_HDG, 'bold'); doc.setFontSize(16); doc.setTextColor(...WHITE);
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
        const isDisabled = disabled.has(fi + '-' + bi);
        doc.setFillColor(...hexToRgb(bg));
        doc.setGState(new doc.GState({ opacity: isDisabled ? 0.25 : 1 }));
        doc.roundedRect(bx, fy, tW, tW, 1.5, 1.5, 'F');
        doc.setGState(new doc.GState({ opacity: isDisabled ? 0.25 : 1 }));
        doc.setTextColor(...hexToRgb(fg)); doc.setFontSize(tW * 0.35); doc.setFont('helvetica', 'bold');
        doc.text('Ag', bx + tW / 2, fy + tW / 2 + (tW * 0.35) * 0.18, { align: 'center' });
        doc.setGState(new doc.GState({ opacity: 1 }));
        if (isDisabled) {
          doc.setDrawColor(255, 255, 255);
          doc.setLineWidth(0.5);
          doc.line(bx + 2, fy + 2, bx + tW - 2, fy + tW - 2);
        }
      });
    });

    const combos = [];
    colours.forEach((fg, fi) => colours.forEach((bg, bi) => {
      if (fg === bg) return;
      if (disabled.has(fi + '-' + bi)) return;
      const ratio    = contrastRatio(fg, bg);
      const aaSmall  = ratio >= AA_SMALL,  aaLarge  = ratio >= AA_LARGE;
      const aaaSmall = ratio >= AAA_SMALL, aaaLarge = ratio >= AAA_LARGE;
      combos.push({ fg, bg, ratio, aaSmall, aaLarge, aaaSmall, aaaLarge, passes: aaSmall || aaLarge });
    }));

    const CCOLS = 6, CARD_G = 4, CARD_H = 48, CSTART_Y = 28;
    const CARD_W   = Math.floor((pw - M * 2 - (CCOLS - 1) * CARD_G) / CCOLS);
    const ROWS_PP  = Math.floor((ph - CSTART_Y - M) / (CARD_H + CARD_G));
    const PER_PAGE = CCOLS * ROWS_PP;
    const C_AAA = [74, 222, 128], C_AA = [250, 204, 21], C_FAIL = [248, 113, 113];

    const drawBadge = (aa, aaa, x, y, w) => {
      const col = aaa ? C_AAA : aa ? C_AA : C_FAIL;
      doc.setFillColor(...col); doc.setGState(new doc.GState({ opacity: 0.15 }));
      doc.roundedRect(x, y - 3.5, w, 5, 0.8, 0.8, 'F');
      doc.setGState(new doc.GState({ opacity: 1 }));
      doc.setTextColor(...col); doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
      doc.text((aaa ? 'AAA' : 'AA') + ' ' + (aaa || aa ? 'Pass' : 'Fail'), x + w / 2, y, { align: 'center' });
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
      doc.setFont(FONT_HDG, 'bold'); doc.setFontSize(16); doc.setTextColor(...WHITE); doc.text(title, M, 16);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MID); doc.text(sub, M, 22);
      list.forEach(combo => {
        const pos = idx % PER_PAGE;
        if (idx > 0 && pos === 0) {
          doc.addPage(); pdfBg();
          doc.setFont(FONT_HDG, 'bold'); doc.setFontSize(16); doc.setTextColor(...WHITE); doc.text(title + ' (cont.)', M, 16);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MID); doc.text(sub, M, 22);
        }
        drawCard(combo, M + (pos % CCOLS) * (CARD_W + CARD_G), CSTART_Y + Math.floor(pos / CCOLS) * (CARD_H + CARD_G));
        idx++;
      });
    };

    drawSection(combos.filter(c =>  c.passes), 'Compliant Combinations',     combos.filter(c =>  c.passes).length + ' combinations are compliant');
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

  return (
    <div className="container" ref={containerRef} style={{ paddingBottom: 24 }}>

      {/* Topbar */}
      <div className="topbar">
        <div>
          <h1 onClick={clear} style={{ cursor: 'pointer' }}>
            Colour <span style={{ paddingLeft: 20 }}>Contrast</span> Checker
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
              <button className="btn-primary ghost" onClick={undo}>
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
          <h2>{n === 0 ? "Extract & check colour palettes for WCAG 2.2 compliance" : "You're almost there…"}</h2>
          <p>
            {n === 0
              ? 'Enter a URL to automatically extract the dominant colours from any public website, or add HEX codes manually to test specific combinations. We scan CSS files to identify the most used colours and calculate their contrast ratios. The tool checks them against WCAG 2.2 standards, suggests AA or AAA‑compliant alternatives, and lets you export a shareable report for clients or teams.'
              : 'We need at least two colours to start checking. Add one more!'}
          </p>
          <div className="empty-hint">
            {n !== 0 && <span>Add another HEX colour and press <code>Enter</code></span>}
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
              <div key={c} className="col-hdr" style={{ background: c, color: readableInk(c) }} onClick={() => copyHex(c)}>
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
                  const key = fi + '-' + bi;
                  return (
                    <div
                      key={key}
                      data-tile={key}
                      className={'tile' + (off ? ' off' : '') + (activeTile === key ? ' touch-active' : '')}
                      style={{ background: bg, color: fg, height: tileW }}
                      onClick={() => {
                        if (activeTile !== key) {
                          setActiveTile(key);
                          activeTileRef.current = key;
                        } else {
                          setActiveTile(null);
                          activeTileRef.current = null;
                        }
                      }}
                      onTouchEnd={e => {
                        e.preventDefault();
                        if (activeTile !== key) {
                          setActiveTile(key);
                          activeTileRef.current = key;
                        } else {
                          setActiveTile(null);
                          activeTileRef.current = null;
                        }
                      }}
                    >
                      <div className="notch" style={{ opacity: off ? 0.35 : 1 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {[['Small', passes.aaSmall, passes.aaaSmall], ['Large', passes.aaLarge, passes.aaaLarge]].map(([label, aa, aaa]) => {
                            const color = aaa ? '#4ade80' : aa ? '#facc15' : '#f87171';
                            const badge = aaa ? 'AAA ✓' : aa ? 'AA ✓' : 'AA ✗';
                            return (
                              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ color: 'var(--muted)', fontSize: 12, width: 38, flexShrink: 0 }}>{label}</span>
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
                        <button
                          className="ov-btn"
                          onTouchEnd={e => {
                            e.stopPropagation();
                            e.preventDefault();
                            toggleDisable(fi, bi);
                            if (!off) { setActiveTile(null); activeTileRef.current = null; }
                          }}
                          onClick={() => toggleDisable(fi, bi)}
                        >
                          {off ? 'Enable' : 'Disable'}
                        </button>
                        {!off && !passes.aaaSmall && (
                          <button
                            className="ov-btn improve"
                            onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); openModal(fi, bi); setActiveTile(null); activeTileRef.current = null; }}
                            onClick={() => openModal(fi, bi)}
                          >
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

      {/* Combination cards */}
      {showMatrix && (() => {
        const combos = [];
        colours.forEach((fg, fi) => colours.forEach((bg, bi) => {
          if (fg === bg) return;
          if (disabled.has(fi + '-' + bi)) return;
          const ratio    = contrastRatio(fg, bg);
          const aaSmall  = ratio >= AA_SMALL,  aaLarge  = ratio >= AA_LARGE;
          const aaaSmall = ratio >= AAA_SMALL, aaaLarge = ratio >= AAA_LARGE;
          combos.push({ fg, bg, ratio, aaSmall, aaLarge, aaaSmall, aaaLarge, passes: aaSmall || aaLarge });
        }));
        const sortScore = c => {
          if (c.aaaSmall) return 0;
          if (c.aaSmall && c.aaaLarge) return 1;
          if (c.aaSmall) return 2;
          return 3;
        };
        const compliantCombos    = combos.filter(c =>  c.passes).sort((a, b) => sortScore(a) - sortScore(b));
        const nonCompliantCombos = combos.filter(c => !c.passes);
        const aaLargeOnlyCombos  = compliantCombos.filter(c => !c.aaSmall &&  c.aaLarge);
        const aaSmallOnlyCombos  = compliantCombos.filter(c =>  c.aaSmall && !c.aaaSmall);
        const aaaAllCombos       = compliantCombos.filter(c =>  c.aaaSmall);

        const Card = ({ combo, onCopy }) => (
          <div style={{
            borderRadius: 12, overflow: 'hidden',
            border: '1px solid var(--border)',
            background: 'var(--bg-raised)',
            flex: '1 1 160px',
          }}>
            <div style={{ background: combo.bg, padding: '14px 12px', textAlign: 'center' }}>
              <div style={{ color: combo.fg, fontSize: 28, fontWeight: 800, lineHeight: 1 }}>Ag</div>
              <div style={{ marginTop: 8, display: 'inline-block', background: 'rgba(255,255,255,0.92)', color: '#111', fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 99 }}>
                {combo.ratio.toFixed(1)}:1
              </div>
            </div>
            <div style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--white)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {[combo.fg, combo.bg].map((hex, i) => {
                const ink = readableInk(hex);
                return (
                  <React.Fragment key={hex + i}>
                    <span className="chip" style={{ background: hex, color: ink, cursor: 'pointer' }} onClick={() => onCopy(hex)}>
                      {hex}
                    </span>
                    {i === 0 && <span style={{ color: 'var(--muted)', fontSize: 10 }}>on</span>}
                  </React.Fragment>
                );
              })}
            </div>
              {[['Small', combo.aaSmall, combo.aaaSmall], ['Large', combo.aaLarge, combo.aaaLarge]].map(([label, aa, aaa]) => {
                const color = aaa ? '#4ade80' : aa ? '#facc15' : '#f87171';
                const badge = aaa ? 'AAA ✓' : aa ? 'AA ✓' : 'AA ✗';
                return (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                    <span style={{ color: 'var(--muted)', fontSize: 11, width: 36, flexShrink: 0 }}>{label}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color, background: color + '22', padding: '1px 6px', borderRadius: 4 }}>{badge}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );

        const ComboRow = ({ combo }) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ background: combo.bg, borderRadius: 8, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ color: combo.fg, fontSize: 18, fontWeight: 800 }}>Ag</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, flexWrap: 'wrap' }}>
              {[combo.fg, combo.bg].map((hex, j) => {
                const ink = readableInk(hex);
                return (
                  <React.Fragment key={hex + j}>
                    <span className="chip" style={{ background: hex, color: ink, cursor: 'pointer' }} onClick={() => copyHex(hex)}>{hex}</span>
                    {j === 0 && <span style={{ color: 'var(--muted)', fontSize: 10 }}>on</span>}
                  </React.Fragment>
                );
              })}
            </div>
            <div style={{ background: 'rgba(255,255,255,0.92)', color: '#111', fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 99, flexShrink: 0 }}>
              {combo.ratio.toFixed(1)}:1
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
              {[
                { label: 'Small', aa: combo.aaSmall, aaa: combo.aaaSmall },
                { label: 'Large', aa: combo.aaLarge, aaa: combo.aaaLarge },
              ].map(({ label, aa, aaa }) => {
                const color = aaa ? '#4ade80' : aa ? '#facc15' : '#f87171';
                const badge = aaa ? 'AAA ✓' : aa ? 'AA ✓' : 'AA ✗';
                return (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: 'var(--muted)', fontSize: 11, width: 36, flexShrink: 0 }}>{label}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color, background: color + '22', padding: '1px 6px', borderRadius: 4 }}>{badge}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );

        const Section = ({ title, sub, list, showToggle, columns = 3 }) => list.length === 0 ? null : (
          <div style={{ marginTop: 64 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: 6 }}>{title}</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{sub}</p>
              </div>
              {showToggle && (
                <TogglePill
                  value={comboView}
                  options={[{ value: 'grid', label: 'Card' }, { value: 'list', label: 'List' }]}
                  onChange={setComboView}
                />
              )}
            </div>
            {comboView === 'grid' ? (
              <div className="combo-grid">
                {list.map((combo, i) => <Card key={i} combo={combo} onCopy={copyHex} />)}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: columns === 1 ? 'calc(33.333% - 11px)' : 'repeat(3, 1fr)', gap: 16, marginTop: 20, alignItems: 'start' }}>
                {columns === 3 ? (
                  [
                    list.filter(c => c.aaaSmall),
                    list.filter(c => c.aaSmall && !c.aaaSmall),
                    list.filter(c => !c.aaSmall && c.aaLarge),
                  ].map((items, colIdx) => (
                    <div key={colIdx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {items.length === 0
                        ? <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 0' }}>No combinations</div>
                        : items.map((combo, i) => <ComboRow key={i} combo={combo} />)
                      }
                    </div>
                  ))
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {list.map((combo, i) => <ComboRow key={i} combo={combo} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        );

        return (
          <>
            {compliantCombos.length > 0 && (() => {
              const groups = [
                { title: 'AAA Compliant — All Text',               sub: 'Meets AAA for all text sizes, no restrictions',              list: aaaAllCombos },
                { title: 'AA Compliant — All Text, Partially AAA', sub: 'Meets AA for all text sizes and AAA for large text',          list: aaSmallOnlyCombos },
                { title: 'AA Compliant — Large Text Only',         sub: 'Meets AA for large text only, not suitable for small text',   list: aaLargeOnlyCombos },
              ].filter(g => g.list.length > 0);
              return (
                <div style={{ marginTop: 64 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 32, flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <h2 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: 6 }}>Compliant Combinations</h2>
                      <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{compliantCombos.length + ' combination' + (compliantCombos.length !== 1 ? 's' : '') + ' meet AA or AAA standards'}</p>
                      <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 4 }}>Large text is defined as 18pt (24px) or larger for regular weight, or 14pt (≈19px) or larger for bold.</p>
                    </div>
                    <TogglePill value={comboView} options={[{ value: 'grid', label: 'Card' }, { value: 'list', label: 'List' }]} onChange={setComboView} />
                  </div>
                  {comboView === 'list' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + groups.length + ', 1fr)', gap: 24, alignItems: 'start' }}>
                      {groups.map(({ title, sub, list }) => (
                        <div key={title}>
                          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: 4 }}>{title}</h3>
                          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 12 }}>{sub} · {list.length} combination{list.length !== 1 ? 's' : ''}</p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {list.map((combo, i) => <ComboRow key={i} combo={combo} />)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    groups.map(({ title, sub, list }) => (
                      <div key={title} style={{ marginBottom: 48 }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: 4 }}>{title}</h3>
                        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 16 }}>{sub} · {list.length} combination{list.length !== 1 ? 's' : ''}</p>
                        <div className="combo-grid">
                          {list.map((combo, i) => <Card key={i} combo={combo} onCopy={copyHex} />)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              );
            })()}
            <Section
              title="Non-Compliant Combinations"
              sub={nonCompliantCombos.length + ' combination' + (nonCompliantCombos.length !== 1 ? 's' : '') + ' do not meet AA standards'}
              list={nonCompliantCombos}
              columns={1}
            />
          </>
        );
      })()}

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
            {(() => {
              const currentRatio = contrastRatio(modalFg, modalBg);
              const isAAA = currentRatio >= AAA_THRESHOLD;
              const isAA  = currentRatio >= AA_THRESHOLD;

              if (isAAA) {
                const color = 'rgb(74, 222, 128)';
                const bg    = 'rgba(74, 222, 128, 0.1)';
                return (
                  <div style={{ border: `1.5px solid ${color}`, borderRadius: 10, padding: '18px 20px', background: bg, textAlign: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color, marginBottom: 6 }}>AAA Compliant</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      This combination already meets AAA standards with a ratio of <span style={{ color, fontWeight: 700 }}>{currentRatio.toFixed(1)}:1</span>. No improvements needed.
                    </div>
                  </div>
                );
              }

              if (isAA) {
                const color = 'rgb(250, 204, 21)';
                const bg    = 'rgba(250, 204, 21, 0.1)';
                const aaaGroup = SUGG_GROUPS.find(g => g.label === 'AAA');
                const lighter  = findSuggestion(modalFg, modalBg, 'lighter', modal.target, aaaGroup.min);
                const darker   = findSuggestion(modalFg, modalBg, 'darker',  modal.target, aaaGroup.min);
                return (
                  <>
                    <div style={{ border: `1.5px solid ${color}`, borderRadius: 10, padding: '18px 20px', background: bg, textAlign: 'center', marginBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color, marginBottom: 6 }}>AA Compliant</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        This combination meets AA standards with a ratio of <span style={{ color, fontWeight: 700 }}>{currentRatio.toFixed(1)}:1</span>. Suggestions below to reach AAA.
                      </div>
                    </div>
                    <div className="sugg-group">
                      <div className="sugg-group-lbl aaa">AAA Compliant Suggestions</div>
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
                                  <span className="ms-badge aaa">AAA ✓</span>
                                </div>
                              </div>
                            ) : (
                              <div className="ms-none">No accessible options found</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                );
              }

              return SUGG_GROUPS.map(group => {
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
              });
            })()}
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

      <footer style={{ marginTop: 60, textAlign: 'center', padding: '14px 24px' }}>
        <img src="/Eidra_Q42_Black.svg" alt="Eidra Q42" style={{ height: 32, filter: 'invert(1)' }} />
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}