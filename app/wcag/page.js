'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

// ── Constants ─────────────────────────────────────────────────────────────────
const AA_THRESHOLD  = 4.5;
const AAA_THRESHOLD = 7;
const TILE_MIN      = 125;
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
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2,'0')).join('').toUpperCase();
const relativeLuminance = hex =>
  hexToRgb(hex).reduce((acc, ch, i) => {
    let v = ch / 255;
    v = v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return acc + v * [0.2126, 0.7152, 0.0722][i];
  }, 0);
const contrastRatio = (a, b) => {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const readableInk = hex => relativeLuminance(hex) > 0.179 ? '#111' : '#fff';
const findSuggestion = (fg, bg, direction, target, minRatio) => {
  const base = hexToRgb(target === 'fg' ? fg : bg);
  const toward = direction === 'lighter' ? 255 : 0;
  for (let step = 1; step <= SUGGEST_STEPS; step++) {
    const f = step / SUGGEST_STEPS;
    const candidate = rgbToHex(base[0]+(toward-base[0])*f, base[1]+(toward-base[1])*f, base[2]+(toward-base[2])*f);
    const ratio = target === 'fg' ? contrastRatio(candidate, bg) : contrastRatio(fg, candidate);
    if (ratio >= minRatio) return { hex: candidate, ratio };
  }
  return null;
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function WCAGChecker() {
  const searchParams            = useSearchParams();
  const [colours, setColours]   = useState([]);
  const [disabled, setDisabled] = useState(new Set());
  const [history, setHistory]   = useState([]);
  const [inputVal, setInputVal] = useState('');
  const [modal, setModal]       = useState(null);
  const [toast, setToast]       = useState({ show: false, msg: '' });
  const containerRef            = useRef(null);
  const toastTimer              = useRef(null);

  useEffect(() => {
    const raw = searchParams.get('colours');
    if (!raw) return;
    const loaded = [...new Set(raw.split(',').map(t => {
      const v = (t.trim().startsWith('#') ? t.trim() : '#' + t.trim()).toUpperCase();
      return HEX_RE.test(v) ? v : null;
    }).filter(Boolean))];
    setColours(loaded);
  }, [searchParams]);

  const snapshot = useCallback((cols, dis) => {
    setHistory(h => [...h, { colours: [...cols], disabled: new Set(dis) }]);
  }, []);

  const showToast = msg => {
    clearTimeout(toastTimer.current);
    setToast({ show: true, msg });
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, show: false })), 2000);
  };

  const handleKeyDown = e => {
    if (e.key === 'Backspace' && inputVal === '' && colours.length) {
      snapshot(colours, disabled); setColours(c => c.slice(0, -1)); return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = inputVal.trim(); setInputVal('');
    if (!raw) return;
    const toAdd = raw.split(',').map(t => {
      let v = t.trim();
      if (!v) return null;
      if (!v.startsWith('#')) v = '#' + v;
      if (!HEX_RE.test(v)) return null;
      return v.toUpperCase();
    }).filter(Boolean).filter(v => !colours.includes(v));
    if (!toAdd.length) return;
    snapshot(colours, disabled);
    setColours(c => [...c, ...toAdd]);
  };

  const removeColour = i => { snapshot(colours, disabled); setColours(c => c.filter((_, idx) => idx !== i)); };
  const undo  = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setColours(prev.colours); setDisabled(prev.disabled);
  };
  const clear = () => { setColours([]); setDisabled(new Set()); setHistory([]); };

  const tileKey = (fi, bi) => `${fi}-${bi}`;
  const isOff   = (fi, bi) => disabled.has(tileKey(fi, bi));
  const toggleDisable = (fi, bi) => {
    snapshot(colours, disabled);
    setDisabled(d => { const n = new Set(d); const k = tileKey(fi,bi); n.has(k)?n.delete(k):n.add(k); return n; });
  };

  const computeLayout = useCallback(() => {
    if (!containerRef.current) return { rowHdrW: 80, tileW: 140 };
    const st = getComputedStyle(containerRef.current);
    const usable = containerRef.current.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
    const rowHdrW = Math.max(ROW_HDR_MIN, Math.min(ROW_HDR_MAX, usable * ROW_HDR_PCT));
    const tileW   = Math.max(TILE_MIN, Math.min(TILE_MAX, Math.floor((usable - rowHdrW - GRID_GAP * colours.length) / colours.length)));
    return { rowHdrW, tileW };
  }, [colours.length]);

  const exportPDF = async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw  = doc.internal.pageSize.getWidth();
    const ph  = doc.internal.pageSize.getHeight();
    const n   = colours.length;
    const M   = 14, G = 1.5;
    const pdfBg  = () => { doc.setFillColor(17,17,17); doc.rect(0,0,pw,ph,'F'); };
    const pdfInk = hex => readableInk(hex) === '#fff' ? [255,255,255] : [17,17,17];
    pdfBg();
    doc.setTextColor(255,255,255); doc.setFontSize(18); doc.setFont('helvetica','bold');
    doc.text('Colour Contrast Checker', M, 16);
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(156,163,175);
    doc.text(`${n} colours · ${n*n-n} combinations`, M, 22);
    const rW = 22, tW = Math.min(30, Math.floor((pw-M*2-rW-(n-1)*G)/n)), sY = 30;
    colours.forEach((c, ci) => {
      const cx = M+rW+G+ci*(tW+G);
      doc.setFillColor(...hexToRgb(c)); doc.roundedRect(cx,sY,tW,8,1,1,'F');
      doc.setFontSize(5); doc.setFont('helvetica','bold'); doc.setTextColor(...pdfInk(c));
      doc.text(c, cx+tW/2, sY+5.2, { align:'center' });
    });
    colours.forEach((fg, fi) => {
      const fy = sY+10+fi*(tW+G);
      doc.setFillColor(...hexToRgb(fg)); doc.roundedRect(M,fy,rW,tW,1,1,'F');
      doc.setFontSize(5); doc.setFont('helvetica','bold'); doc.setTextColor(...pdfInk(fg));
      doc.text(fg, M+rW/2, fy+tW/2+1.5, { align:'center' });
      colours.forEach((bg, bi) => {
        if (fi===bi) return;
        const ratio=contrastRatio(fg,bg), pAA=ratio>=AA_THRESHOLD, pAAA=ratio>=AAA_THRESHOLD;
        const bx=M+rW+G+bi*(tW+G);
        doc.setFillColor(...hexToRgb(bg)); doc.roundedRect(bx,fy,tW,tW,1.5,1.5,'F');
        doc.setFillColor(17,17,17); doc.roundedRect(bx+tW-16,fy,16,6,0,1.5,'F');
        doc.setFontSize(3.8); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
        doc.text(`${ratio.toFixed(1)}:1`, bx+tW-8, fy+2.6, {align:'center'});
        doc.setFontSize(3);
        doc.setTextColor(...(pAA?[74,222,128]:[248,113,113])); doc.text(`AA ${pAA?'✓':'✗'}`, bx+tW-14, fy+5.4);
        doc.setTextColor(...(pAAA?[74,222,128]:[248,113,113])); doc.text(`AAA ${pAAA?'✓':'✗'}`, bx+tW-8, fy+5.4);
        doc.setTextColor(...hexToRgb(fg)); doc.setFontSize(tW*0.35); doc.setFont('helvetica','bold');
        doc.text('Aa', bx+tW/2, fy+tW*0.62, {align:'center'});
      });
    });
    doc.save('colour-contrast.pdf');
  };

  const openModal  = (fi, bi) => setModal({ fgIndex: fi, bgIndex: bi, target: 'fg', picked: null });
  const closeModal = ()        => setModal(null);
  const applyModal = () => {
    if (!modal?.picked) return;
    snapshot(colours, disabled);
    setColours(c => { const n=[...c]; n[modal.target==='fg'?modal.fgIndex:modal.bgIndex]=modal.picked; return n; });
    closeModal();
  };

  const n = colours.length;
  const { rowHdrW, tileW } = computeLayout();
  const showMatrix = n >= 2;
  const modalFg = modal ? colours[modal.fgIndex] : null;
  const modalBg = modal ? colours[modal.bgIndex] : null;
  const SUGG_GROUPS = [
    { label:'AA',  cls:'aa',  min: AA_THRESHOLD  },
    { label:'AAA', cls:'aaa', min: AAA_THRESHOLD },
  ];

  return (
    <div className="container" ref={containerRef}>
      <Link href="/" className="back-link">← Back to Colour Extractor</Link>

      <div className="topbar">
        <div>
          <h1
            onClick={() => { setColours([]); setDisabled(new Set()); setHistory([]); setInputVal(''); setModal(null); }}
            style={{ cursor:'pointer' }}
          >Colour<br/>Contrast<br/>Checker</h1>
        </div>
        <div className="topbar-right">
          <div className="url-input-row">
            <div className="url-input" style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center', height:'auto', minHeight:52 }}>
              {colours.map((c, i) => {
                const ink = readableInk(c);
                return (
                  <span key={c} className="chip" style={{ background:c, color:ink }}>
                    <span className="chip-dot" style={{ background: ink==='#fff'?'rgba(255,255,255,.3)':'rgba(0,0,0,.2)' }} />
                    {c}
                    <span className="chip-x" onClick={() => removeColour(i)}>×</span>
                  </span>
                );
              })}
              <input
                type="text" value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. #FF885A or 111111, 307362"
                style={{ background:'none', border:'none', outline:'none', color:'#fff', fontSize:'0.95rem', flex:1, minWidth:160, fontFamily:'inherit' }}
              />
            </div>
            {n >= 1 && <button className="btn-primary" style={{ background:'none', border:'1px solid #f87171', color:'#f87171' }} onClick={clear}>✕ Clear</button>}
            {history.length >= 1 && <button className="btn-primary" style={{ background:'none', border:'1px solid var(--border)', color:'var(--muted)' }} onClick={undo}>↩ Undo</button>}
            {n >= 2 && <button className="btn-primary" onClick={exportPDF}>↓ Export PDF</button>}
          </div>
        </div>
      </div>

      {/* Empty state */}
      {!showMatrix && (
        <div className="empty">
          <div className="empty-emoji">{n === 0 ? '🎨' : '👀'}</div>
          <h2>{n === 0 ? <>Make the web readable<br/>for everyone.</> : <>You&rsquo;re almost there&hellip;</>}</h2>
          <p>{n === 0
            ? 'Add your colours above and instantly see which combinations pass WCAG accessibility standards.'
            : 'We need at least two colours to start checking. Add one more!'}
          </p>
          {n === 0 && <p style={{ marginTop: 16 }}>WCAG (Web Content Accessibility Guidelines) exist to make sure people of all abilities can read, navigate, and interact with digital experiences. Clear contrast doesn't just help users with visual impairments — it improves readability for everyone. Better accessibility means better usability, wider reach, stronger brand trust, and often legal compliance too.</p>}
          <div className="empty-hint">
            {n === 0
              ? <>Type a HEX colour like <code>#FF885A</code> and press <code>Enter</code></>
              : <>Add another HEX colour and press <code>Enter</code></>}
          </div>
        </div>
      )}

      {/* Matrix */}
      {showMatrix && (
        <div style={{ marginTop:20, width:'100%', overflowX:'auto' }}>
          <div className="matrix" style={{ gridTemplateColumns:`${rowHdrW}px repeat(${n}, ${tileW}px)` }}>
            <div style={{ width:rowHdrW, height:36 }} />
            {colours.map(c => (
              <div key={c} className="col-hdr" style={{ background:c, color:readableInk(c) }}>{c}</div>
            ))}
            {colours.map((fg, fi) => (
              <>
                <div key={`rh-${fi}`} className="row-hdr" style={{ background:fg, color:readableInk(fg), height:tileW }}>{fg}</div>
                {colours.map((bg, bi) => {
                  if (fi===bi) return <div key={`b-${fi}-${bi}`} className="tile blank" style={{ height:tileW }} />;
                  const ratio=contrastRatio(fg,bg), pAA=ratio>=AA_THRESHOLD, pAAA=ratio>=AAA_THRESHOLD, off=isOff(fi,bi);
                  return (
                    <div key={`${fi}-${bi}`} className={`tile${off?' off':''}`} style={{ background:bg, color:fg, height:tileW }}>
                      <div className="notch">
                        <div className="notch-badges">
                          <span className={`nbadge ${pAA?'pass':'fail'}`}>AA {pAA?'✓':'✗'}</span>
                          <span className={`nbadge ${pAAA?'pass':'fail'}`}>AAA {pAAA?'✓':'✗'}</span>
                        </div>
                        <div className="notch-ratio">{ratio.toFixed(1)}:1</div>
                      </div>
                      <div className="aa-lg">Aa</div>
                      <div className="aa-sm">Aa</div>
                      <div className="tile-ov">
                        <button className="ov-btn" onClick={() => toggleDisable(fi,bi)}>{off?'Enable':'Disable'}</button>
                        {!off && <button className="ov-btn improve" onClick={() => openModal(fi,bi)}>Improve</button>}
                      </div>
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && closeModal()}>
          <div className="modal">
            <div className="modal-hdr">
              <h2>Improve Combination</h2>
              <button className="modal-x" onClick={closeModal}>×</button>
            </div>
            <div className="modal-sub">{modalFg} on {modalBg} · Ratio: {contrastRatio(modalFg,modalBg).toFixed(1)}:1</div>
            <div className="modal-prev" style={{
              background: modal.target==='bg'&&modal.picked ? modal.picked : modalBg,
              color:      modal.target==='fg'&&modal.picked ? modal.picked : modalFg,
            }}>Aa</div>
            <div className="m-tabs">
              {['fg','bg'].map(t => (
                <button key={t} className={`m-tab${modal.target===t?' on':''}`}
                  onClick={() => setModal(m => ({ ...m, target:t, picked:null }))}>
                  {t==='fg'?'Text colour':'Background colour'}
                </button>
              ))}
            </div>
            {SUGG_GROUPS.map(group => {
              const lighter = findSuggestion(modalFg, modalBg, 'lighter', modal.target, group.min);
              const darker  = findSuggestion(modalFg, modalBg, 'darker',  modal.target, group.min);
              return (
                <div key={group.label} className="sugg-group">
                  <div className={`sugg-group-lbl ${group.cls}`}>{group.label} Compliant suggestions</div>
                  <div className="m-suggs">
                    {[['Lighter',lighter],['Darker',darker]].map(([lbl,res]) => (
                      <div key={lbl} className={`m-sugg${modal.picked===res?.hex?' picked':''}`}
                        onClick={() => res && setModal(m => ({ ...m, picked:res.hex }))}>
                        <div className="ms-lbl">{lbl}</div>
                        {res ? <>
                          <div className="ms-swatch" style={{ background:res.hex }} />
                          <div className="ms-hex">{res.hex}</div>
                          <div className="ms-ratio">{res.ratio.toFixed(1)}:1</div>
                          <span className={`ms-badge ${group.cls}`}>{group.label} Pass</span>
                        </> : <div className="ms-none">No match found</div>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="modal-ftr">
              <button className="m-cancel" onClick={closeModal}>Cancel</button>
              <button className="m-update" disabled={!modal.picked} onClick={applyModal}>Update Colour</button>
            </div>
          </div>
        </div>
      )}

      <div className={`toast${toast.show?' show':''}`}>{toast.msg}</div>
    </div>
  );
}