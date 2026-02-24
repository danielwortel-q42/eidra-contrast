'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function labelColor(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#111' : '#fff';
}

export default function Home() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [url, setUrl]       = useState('');
  const [colors, setColors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [domain, setDomain] = useState('');
  const [toast, setToast]   = useState({ show: false, msg: '' });
  const [copiedHex, setCopiedHex] = useState(null);
  const toastTimer = useRef(null);

  // On mount, read ?site= from URL and auto-extract
  useEffect(() => {
    const site = searchParams.get('site');
    if (site) { setUrl(site); extractUrl(site); }
  }, []);

  function wcagUrl(colors) {
    return `/wcag?colours=${colors.map(c => c.hex.replace('#', '')).join(',')}`;
  }

  async function extractUrl(target) {
    if (!target?.trim()) return;
    setLoading(true);
    setError('');
    setColors([]);
    try {
      const res  = await fetch(`/api/extract?url=${encodeURIComponent(target.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      if (!data.colors?.length) throw new Error('No colors found on this page');
      setColors(data.colors);
      try { setDomain(new URL(target.trim()).hostname); } catch { setDomain(target.trim()); }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function extract() {
    if (!url.trim()) return;
    // Push ?site= into the URL
    router.replace(`/?site=${encodeURIComponent(url.trim())}`);
    await extractUrl(url.trim());
  }

  function copyHex(hex) {
    navigator.clipboard.writeText(hex).catch(() => {});
    setCopiedHex(hex);
    clearTimeout(toastTimer.current);
    setToast({ show: true, msg: `Copied ${hex}!` });
    toastTimer.current = setTimeout(() => {
      setToast(t => ({ ...t, show: false }));
      setCopiedHex(null);
    }, 2000);
  }

  const total = colors.reduce((s, c) => s + c.count, 0);

  return (
    <div className="container">
      {/* Topbar */}
      <div className="topbar">
        <div>
          <h1
            onClick={() => { setUrl(''); setColors([]); setError(''); setDomain(''); router.replace('/'); }}
            style={{ cursor:'pointer' }}
          >Colour<br />Extractor</h1>
        </div>
        <div className="topbar-right">
          <div className="url-input-row">
            <input
              className="url-input"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && extract()}
              placeholder="https://example.com"
            />
            <button
              className="btn-primary"
              onClick={extract}
              disabled={loading}
            >
              {loading
                ? <><span className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />Analyzing…</>
                : 'Extract Colors'}
            </button>
            {colors.length > 0 && (
              <Link href={wcagUrl(colors)} className="btn-outline">WCAG Check</Link>
            )}
          </div>
          {error && <p className="error-msg">{error}</p>}
        </div>
      </div>

      {/* Empty state */}
      {!colors.length && !loading && (
        <div className="empty">
          <div className="empty-emoji">🎨</div>
          <h2>Extract any website's colour palette.</h2>
          <p>Enter a URL above to pull the dominant colours from any public website — then check them for WCAG accessibility.</p>
          <p style={{ marginTop: 16 }}>Because great design isn't just about looking good — it's about working for everyone. WCAG guidelines help ensure your colours have enough contrast for people with visual impairments, colour blindness, low vision, or situational limitations (like bright sunlight or a cracked screen). Accessibility isn't a constraint — it's a superpower.</p>
          <div className="empty-hint">Paste a URL and press <code>Enter</code> or click <code>Extract Colors</code></div>
        </div>
      )}

      {/* Results */}
      {colors.length > 0 && (
        <div className="fade-up">
          <div className="section-label" style={{ marginBottom: 18 }}>Color swatches — {domain}</div>

          {/* Swatches */}
          <div className="swatches" style={{ marginBottom: 36 }}>
            {colors.map(c => (
              <div key={c.hex} className="swatch" onClick={() => copyHex(c.hex)} title="Click to copy">
                <div className="swatch-color" style={{ background: c.hex }}>
                  <span className="pct-badge">{c.pct}%</span>
                </div>
                <div className="swatch-info">
                  <div className="swatch-hex">{c.hex}</div>
                  <div className="swatch-pct">{c.pct}% of stylesheet</div>
                </div>
              </div>
            ))}
          </div>

          {/* Proportional bar */}
          <div className="section-label">Proportional usage</div>
          <div className="prop-bar" style={{ marginBottom: 36 }}>
            {colors.map(c => (
              <div
                key={c.hex}
                className="bar-seg"
                style={{ width: `${c.pct}%`, background: c.hex }}
                onClick={() => copyHex(c.hex)}
                title={`${c.hex} — ${c.pct}%`}
              >
                <span className="bar-seg-label" style={{ color: labelColor(c.hex) }}>{c.pct}%</span>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="section-label">Usage breakdown</div>
          <div className="legend">
            {colors.map(c => (
              <div key={c.hex} className="legend-row" onClick={() => copyHex(c.hex)}>
                <div className="leg-dot" style={{ background: c.hex }} />
                <div className="leg-hex">{c.hex}</div>
                <div className="leg-bar-bg">
                  <div className="leg-bar-fill" style={{ width: `${c.pct}%`, background: c.hex }} />
                </div>
                <div className="leg-pct">{c.pct}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={`toast${toast.show ? ' show' : ''}`}>{toast.msg}</div>
    </div>
  );
}