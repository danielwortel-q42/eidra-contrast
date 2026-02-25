import { parse } from 'node-html-parser';
import { NextResponse } from 'next/server';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

function normalizeHex(h) {
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return '#' + h.toUpperCase();
}

function colorDist(a, b) {
  const [r1,g1,b1] = hexToRgb(a);
  const [r2,g2,b2] = hexToRgb(b);
  return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
}

function isUseful(hex) {
  const [r,g,b] = hexToRgb(hex);
  const br = (r*299 + g*587 + b*114) / 1000;
  if (br > 248 || br < 8) return false;
  const range = Math.max(r,g,b) - Math.min(r,g,b);
  if (range < 10 && br > 215) return false;
  if (range < 10 && br < 20)  return false;
  return true;
}

// Weight multipliers — background/fill colors count more than a single mention
const WEIGHTS = {
  'background-color': 8,
  'background':       7,
  'fill':             4,
  'border-color':     2,
  'color':            6,
  '--':               3, // CSS custom properties
  'default':          1,
};

function weightFor(context) {
  for (const [key, w] of Object.entries(WEIGHTS)) {
    if (context.includes(key)) return w;
  }
  return WEIGHTS.default;
}

function parseColors(text) {
  const map = {};

  function add(hex, weight = 1) {
    if (isUseful(hex)) map[hex] = (map[hex] || 0) + weight;
  }

  // Walk every CSS declaration and extract colors with context-aware weighting
  // Matches: property: ...#hex... or property: ...rgb(...)...
  const declRe = /([\w-]+)\s*:\s*([^;}{]+)/g;
  let d;
  while ((d = declRe.exec(text)) !== null) {
    const prop = d[1].toLowerCase();
    const val  = d[2];
    const w    = weightFor(prop);

    // Hex colors within this declaration
    const hexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
    let m;
    while ((m = hexRe.exec(val)) !== null) add(normalizeHex(m[1]), w);

    // rgb/rgba within this declaration
    const rgbRe = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
    while ((m = rgbRe.exec(val)) !== null) add(rgbToHex(+m[1], +m[2], +m[3]), w);
  }

  // Also catch any hex/rgb not inside a declaration (e.g. raw style attributes)
  const hexRe2 = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
  let m2;
  while ((m2 = hexRe2.exec(text)) !== null) add(normalizeHex(m2[1]), 1);

  const sorted = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([hex, count]) => ({ hex, count }));

  // Group similar colors, keep the most frequent as representative
  const groups = [];
  for (const c of sorted) {
    const group = groups.find(g => colorDist(g[0].hex, c.hex) < 28);
    if (group) group.push(c);
    else groups.push([c]);
  }

  // Each group's score = sum of all members' counts
  const result = groups
    .map(g => ({
      hex:   g[0].hex, // most frequent is already first (sorted above)
      count: g.reduce((s, c) => s + c.count, 0),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return result;
}

function toPercent(colors) {
  const total = colors.reduce((s, c) => s + c.count, 0);
  return colors.map(c => ({
    hex: c.hex,
    count: c.count,
    pct: Math.round((c.count / total) * 100),
  }));
}

async function fetchCSS(html, baseUrl) {
  const root = parse(html);
  const origin = new URL(baseUrl).origin;
  let combined = '';

  root.querySelectorAll('style').forEach(s => { combined += s.rawText + '\n'; });

  const hrefs = root
    .querySelectorAll('link[rel="stylesheet"]')
    .map(l => l.getAttribute('href'))
    .filter(Boolean)
    .map(h => h.startsWith('http') ? h : origin + (h.startsWith('/') ? h : '/' + h))
    .slice(0, 8);

  await Promise.allSettled(
    hrefs.map(async href => {
      try {
        const r = await fetch(href, { signal: AbortSignal.timeout(5000) });
        if (r.ok) combined += await r.text() + '\n';
      } catch (_) {}
    })
  );

  root.querySelectorAll('[style]').forEach(el => {
    combined += el.getAttribute('style') + '\n';
  });

  return { css: combined, html };
}

// Extract the body background and main text colour directly from the HTML/CSS
function extractBaseColors(html, cssText) {
  const root = parse(html);
  const bases = [];

  // Helper: pull first hex/rgb from a value string
  const firstColor = val => {
    const hexM = val && val.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/);
    if (hexM) return normalizeHex(hexM[1]);
    const rgbM = val && val.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
    if (rgbM) return rgbToHex(+rgbM[1], +rgbM[2], +rgbM[3]);
    return null;
  };

  // 1. Look for explicit body { background / color } rules in CSS
  const bodyRuleRe = /body\s*\{([^}]+)\}/gi;
  let bm;
  while ((bm = bodyRuleRe.exec(cssText)) !== null) {
    const block = bm[1];
    const bgM   = block.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    const fgM   = block.match(/(?<![a-z-])color\s*:\s*([^;]+)/i);
    if (bgM) { const c = firstColor(bgM[1]); if (c && isUseful(c)) bases.push({ hex: c, role: 'bg', boost: 50 }); }
    if (fgM) { const c = firstColor(fgM[1]); if (c && isUseful(c)) bases.push({ hex: c, role: 'fg', boost: 40 }); }
  }

  // 2. Fallback: inline style on <body> tag
  const bodyEl = root.querySelector('body');
  if (bodyEl) {
    const inlineStyle = bodyEl.getAttribute('style') || '';
    const bgM = inlineStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    const fgM = inlineStyle.match(/(?<![a-z-])color\s*:\s*([^;]+)/i);
    if (bgM) { const c = firstColor(bgM[1]); if (c && isUseful(c) && !bases.find(b => b.hex === c)) bases.push({ hex: c, role: 'bg', boost: 50 }); }
    if (fgM) { const c = firstColor(fgM[1]); if (c && isUseful(c) && !bases.find(b => b.hex === c)) bases.push({ hex: c, role: 'fg', boost: 40 }); }
  }

  // 3. Fallback: look for :root or html rule backgrounds
  const rootRuleRe = /(?::root|html)\s*\{([^}]+)\}/gi;
  let rm;
  while ((rm = rootRuleRe.exec(cssText)) !== null) {
    const block = rm[1];
    const bgM   = block.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (bgM) { const c = firstColor(bgM[1]); if (c && isUseful(c) && !bases.find(b => b.hex === c)) bases.push({ hex: c, role: 'bg', boost: 45 }); }
  }

  return bases;
}

// ── Route handler (App Router) ────────────────────────────────────────────────

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let parsed;
  try {
    // Strip leading/trailing whitespace
    let normalized = url.trim();
    // If no protocol, prepend https://
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = 'https://' + normalized;
    }
    parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  try {
    const pageRes = await fetch(parsed.href, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ColorBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!pageRes.ok) {
      return NextResponse.json({ error: `Target returned ${pageRes.status}` }, { status: 502 });
    }

    const html = await pageRes.text();
    const { css: cssText } = await fetchCSS(html, parsed.href);

    // Extract locked base colors (body bg + text)
    const baseColors = extractBaseColors(html, cssText);

    // Parse all colors from CSS
    const allColors = parseColors(cssText);

    // Build locked slots first
    const locked = [];
    const lockedRoles = ['bg', 'fg'];
    lockedRoles.forEach(role => {
      const found = baseColors.find(b => b.role === role);
      if (found) locked.push({ hex: found.hex, locked: true, role });
    });

    // Fill remaining slots with accent colors, skipping anything too close to locked
    const accents = [];
    for (const c of allColors) {
      if (locked.some(l => colorDist(l.hex, c.hex) < 28)) continue;
      if (accents.some(a => colorDist(a.hex, c.hex) < 28)) continue;
      accents.push({ hex: c.hex, locked: false, role: 'accent', count: c.count });
      if (accents.length >= 6 - locked.length) break;
    }

    const merged = [...locked, ...accents];
    const colors = toPercent(merged.map((c, i) => ({
      ...c,
      count: c.locked
        ? (i === 0 ? 1000 : 900) // locked slots get fixed high counts for % calc
        : (c.count || 1),
    })));

    if (!colors.length) {
      return NextResponse.json({ colors: [], message: 'No distinct colors found' });
    }

    return NextResponse.json({ colors }, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate' },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Failed to fetch or parse the target URL' }, { status: 500 });
  }
}