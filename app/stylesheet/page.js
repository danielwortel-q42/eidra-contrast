'use client';

// ─────────────────────────────────────────────────────────────────────────────
// /stylesheet — Design Library
// Hidden reference page. Not linked from the app.
// ─────────────────────────────────────────────────────────────────────────────

import s from './stylesheet.module.css';

const Section = ({ title, children }) => (
  <section className={s.section}>
    <h2 className={s.sectionTitle}>{title}</h2>
    {children}
  </section>
);

const Row = ({ label, top, children }) => (
  <div className={`${s.row} ${top ? s.rowTop : ''}`}>
    <span className={s.rowLabel}>{label}</span>
    <div>{children}</div>
  </div>
);

const ColorToken = ({ variable, value, label }) => (
  <div className={s.token}>
    <div className={s.tokenSwatch} style={{ background: `var(${variable})` }} />
    <div>
      <p className={s.tokenLabel}>{label}</p>
      <p className={s.tokenMeta}>{variable}</p>
      <p className={s.tokenMeta}>{value}</p>
    </div>
  </div>
);

const Badge = ({ label, variant }) => (
  <span className={`ms-badge ${variant}`}>{label}</span>
);

const Btn = ({ label, cls }) => (
  <button className={`${cls} ${s.noPointer}`}>{label}</button>
);

// ─────────────────────────────────────────────────────────────────────────────
export default function StylesheetPage() {
  return (
    <div className={s.page}>

      {/* Header */}
      <header className={s.pageHeader}>
        <p className={`eyebrow text-accent ${s.headerEyebrow}`}>Design Library</p>
        <h1 className={s.headerTitle}>Colour Contrast Checker</h1>
        <p className={s.headerDesc}>
          A single source of truth for all visual decisions. Changes to CSS variables in{' '}
          <code className="mono">globals.css</code>{' '}
          are reflected throughout the entire app.
        </p>
      </header>

      {/* ── Colour Tokens ── */}
      <Section title="Colour Tokens">
        <p className={s.sectionDesc}>
          All colours are defined as CSS custom properties on <code className="mono">:root</code> in{' '}
          <code className="mono">globals.css</code>.
          Changing a value there updates every component simultaneously.
        </p>

        <h3 className={s.subHeading}>Backgrounds & Surfaces</h3>
        <div className={s.tokenGroup}>
          <ColorToken variable="--bg"        value="#111111" label="Background" />
          <ColorToken variable="--bg-raised" value="#1a1a1a" label="Raised surface" />
          <ColorToken variable="--border"    value="#2a2a2a" label="Border" />
        </div>

        <h3 className={s.subHeading}>Text</h3>
        <div className={s.tokenGroup}>
          <ColorToken variable="--white"     value="#ffffff" label="Primary text" />
          <ColorToken variable="--muted-mid" value="#b2b8c4" label="Secondary text" />
          <ColorToken variable="--muted"     value="#a0a7b3" label="Tertiary text" />
        </div>

        <h3 className={s.subHeading}>Interactive & Semantic</h3>
        <div className={s.tokenGroupLast}>
          <ColorToken variable="--accent"    value="#3b82f6" label="Accent / Primary" />
          <ColorToken variable="--accent-hv" value="#2563eb" label="Accent hover" />
          <ColorToken variable="--pass"      value="#4ade80" label="Pass / Success" />
          <ColorToken variable="--fail"      value="#f87171" label="Fail / Danger" />
        </div>
      </Section>

      {/* ── Typography ── */}
      <Section title="Typography">
        <p className={s.sectionDesc}>
          Headings use <strong>EidraSans</strong> (loaded via <code className="mono">next/font/local</code>).
          Body text uses the system sans-serif stack. All sizes and weights are set in{' '}
          <code className="mono">globals.css</code> — no overrides needed.
        </p>

        <Row label="h1 · 800 · Eidra · clamp(1.3–2rem)" top>
          <h1 aria-hidden="true">Colour Contrast Checker</h1>
        </Row>
        <Row label="h2 · 700 · Eidra · 1.8rem" top>
          <h2 aria-hidden="true">Extract & check colour palettes</h2>
        </Row>
        <Row label="h3 · 700 · Eidra · 1.4rem" top>
          <h3 aria-hidden="true">Section heading</h3>
        </Row>
        <Row label="h4 · 700 · Eidra · 1rem" top>
          <h4 aria-hidden="true">Subsection heading</h4>
        </Row>
        <Row label="body · 1rem · system" top>
          <p className={s.bodyMax}>
            We scan CSS files to identify the most used colours and calculate their contrast ratios against WCAG 2.2 standards.
          </p>
        </Row>
        <Row label=".body-sm · 0.875rem" top>
          <p className={`body-sm ${s.bodySm}`}>
            Secondary body text. Used for descriptions, hints, and supporting copy throughout the interface.
          </p>
        </Row>
        <Row label=".eyebrow · 0.68rem · 700 · caps">
          <p className="eyebrow text-muted">Section label / eyebrow</p>
        </Row>
        <Row label=".mono · 12px · accent">
          <code className="mono">#3B82F6 · var(--accent) · rgba(0,0,0,0.75)</code>
        </Row>
      </Section>

      {/* ── Utility Classes ── */}
      <Section title="Utility Classes">
        <p className={s.sectionDesc}>
          Reusable classes defined in <code className="mono">globals.css</code>.
          Apply these directly instead of writing inline styles.
        </p>
        <Row label=".eyebrow">
          <p className="eyebrow text-muted">Section label / eyebrow</p>
        </Row>
        <Row label=".text-muted">
          <p className="text-muted">Tertiary and supporting text</p>
        </Row>
        <Row label=".text-muted-mid">
          <p className="text-muted-mid">Secondary and descriptive text</p>
        </Row>
        <Row label=".text-accent">
          <p className="text-accent">Highlighted or interactive text</p>
        </Row>
        <Row label=".body-sm">
          <p className="body-sm">Smaller body text at 0.875rem</p>
        </Row>
        <Row label=".mono">
          <code className="mono">var(--accent) · #3B82F6</code>
        </Row>
      </Section>

      {/* ── WCAG Badges ── */}
      <Section title="WCAG Badges">
        <Row label=".ms-badge.aaa"><Badge label="AAA ✓" variant="aaa" /></Row>
        <Row label=".ms-badge.aa"><Badge label="AA ✓"  variant="aa"  /></Row>
        <Row label=".ms-badge.fail"><Badge label="AA ✗" variant="fail" /></Row>
        <Row label=".ratioPill">
          <span className={s.ratioPill}>4.6:1</span>
        </Row>
      </Section>

      {/* ── Buttons ── */}
      <Section title="Buttons">
        <Row label=".btn-primary"><Btn label="Export PDF" cls="btn-primary" /></Row>
        <Row label=".btn-primary.ghost"><Btn label="↩ Undo" cls="btn-primary ghost" /></Row>
        <Row label=".btn-primary.danger"><Btn label="✕ Clear" cls="btn-primary danger" /></Row>
        <Row label=".ov-btn">
          <div className={s.btnGroup}>
            <button className={`ov-btn ${s.noPointer}`}>Disable</button>
            <button className={`ov-btn improve ${s.noPointer}`}>Improve</button>
          </div>
        </Row>
      </Section>

      {/* ── Chips ── */}
      <Section title="Colour Chips">
        <Row label=".chip">
          <div className={s.chipRow}>
            {['#3B82F6', '#4ADE80', '#F87171', '#FACC15', '#111111', '#FFFFFF'].map(hex => {
              const dark = ['#FACC15', '#4ADE80', '#FFFFFF'].includes(hex);
              return (
                <span key={hex} className="chip" style={{
                  background: hex,
                  color: dark || hex === '#111111' ? '#111' : '#fff',
                }}>
                  <span className="chip-dot" style={{ background: dark || hex === '#111111' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.3)' }} />
                  {hex}
                  <span className={`chip-x ${s.noPointer}`}>×</span>
                </span>
              );
            })}
          </div>
        </Row>
      </Section>

      {/* ── Border Radius ── */}
      <Section title="Border Radius">
        {[
          ['4px',  'WCAG badge · .ms-badge'],
          ['7px',  'Small button · .ov-btn'],
          ['10px', 'Input · modal toggle · card'],
          ['11px', 'Matrix tile · .tile'],
          ['14px', 'Picker swatch · .picker-swatch'],
          ['18px', 'Modal · .modal'],
          ['99px', 'Pill · .ratioPill · .toast'],
        ].map(([radius, usage]) => (
          <Row key={radius} label={`${radius} — ${usage}`}>
            <div className={s.radiusSwatch} style={{ borderRadius: radius }} />
          </Row>
        ))}
      </Section>

      {/* ── Spacing Scale ── */}
      <Section title="Spacing Scale">
        <p className={s.sectionNote}>
          No spacing tokens are currently defined — values are applied per component.
          Consider extracting into CSS variables if the scale grows.
        </p>
        <div className={s.spacingRow}>
          {[4, 6, 8, 12, 16, 24, 32, 48, 64].map(n => (
            <div key={n} className={s.spacingItem}>
              <div className={s.spacingDot} style={{ width: n, height: n }} />
              <span className={s.spacingLabel}>{n}</span>
            </div>
          ))}
        </div>
      </Section>

    </div>
  );
}
