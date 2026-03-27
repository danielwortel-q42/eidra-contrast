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

function brightness(hex) {
  const [r,g,b] = hexToRgb(hex);
  return (r*299 + g*587 + b*114) / 1000;
}

// Allow near-white and near-black — only reject mid-range unsaturated greys
function isUseful(hex) {
  const [r,g,b] = hexToRgb(hex);
  const br    = brightness(hex);
  const range = Math.max(r,g,b) - Math.min(r,g,b);
  if (range < 10 && br > 30 && br < 220) return false;
  return true;
}

// ── Selector analysis ─────────────────────────────────────────────────────────

const DEMOTE_SELECTOR = /disabled|muted|placeholder|ghost|skeleton|subtle|faded|inactive|dimmed/i;
const DEMOTE_MEDIA    = /print|forced-colors|prefers-color-scheme/i;
const BROAD_SELECTOR  = /^(\*|html|body\s*\*|a:visited|::selection)$/i;

// ── CSS variable helpers ──────────────────────────────────────────────────────

const BRAND_VAR = /brand|primary|accent|highlight|key|main|hero|cta|theme/i;

function extractCSSVars(text) {
  // First pass: collect all raw variable declarations
  const raw = {};
  const declRe = /(--[\w-]+)\s*:\s*([^;}{]+)/g;
  let d;
  while ((d = declRe.exec(text)) !== null) {
    raw[d[1].trim()] = d[2].trim();
  }

  // Second pass: resolve each variable to a hex, following var() chains
  const resolve = (val, seen = new Set(), depth = 0) => {
    if (depth > 10) return null;
    const hexM = val.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/);
    if (hexM) return normalizeHex(hexM[1]);
    const rgbM = val.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
    if (rgbM) return rgbToHex(+rgbM[1], +rgbM[2], +rgbM[3]);
    const varM = val.match(/var\(\s*(--[\w-]+)/);
    if (varM && raw[varM[1]] && !seen.has(varM[1])) {
      return resolve(raw[varM[1]], new Set([...seen, varM[1]]), depth + 1);
    }
    return null;
  };

  const vars = {};
  for (const [name, val] of Object.entries(raw)) {
    const hex = resolve(val);
    if (hex) vars[name] = hex;
  }
  return vars;
}

function resolveVars(val, vars) {
  return val.replace(/var\(\s*(--[\w-]+)[^)]*\)/g, (_, name) => vars[name] || _);
}

// ── Weight config ─────────────────────────────────────────────────────────────

const WEIGHTS = {
  'background-color': 8,
  'background':       7,
  'fill':             4,
  'border-color':     2,
  'color':            3, // demoted from 6 — accumulates too easily on text elements
  '--':               3,
  'default':          1,
};

function weightFor(prop) {
  for (const [key, w] of Object.entries(WEIGHTS)) {
    if (prop.includes(key)) return w;
  }
  return WEIGHTS.default;
}

// ── Colour parsing ────────────────────────────────────────────────────────────

function countVarReferencesByRole(text, vars) {
  // Walk rule-by-rule; when a property value contains var(--name),
  // resolve it to a hex and count it in the right role bucket.
  const bg = {}, fg = {}, border = {}, fill = {};
  const ruleRe = /([^{}]*)\{([^{}]*)\}/g;
  let rule;
  while ((rule = ruleRe.exec(text)) !== null) {
    const block = rule[2];
    const declRe = /([\w-]+)\s*:\s*([^;]+)/g;
    let d;
    while ((d = declRe.exec(block)) !== null) {
      const prop  = d[1].toLowerCase();
      const isBg     = prop.includes('background');
      const isFg     = prop === 'color';
      const isBorder = prop.includes('border-color') || prop === 'border' || prop === 'outline-color';
      const isFill   = prop === 'fill' || prop === 'stop-color';
      if (!isBg && !isFg && !isBorder && !isFill) continue;
      const varRe = /var\(\s*(--[\w-]+)/g;
      let v;
      while ((v = varRe.exec(d[2])) !== null) {
        const hex = vars[v[1]];
        if (!hex) continue;
        if (isBg)     bg[hex]     = (bg[hex]     || 0) + 1;
        if (isFg)     fg[hex]     = (fg[hex]     || 0) + 1;
        if (isBorder) border[hex] = (border[hex] || 0) + 1;
        if (isFill)   fill[hex]   = (fill[hex]   || 0) + 1;
      }
    }
  }
  return { bg, fg, border, fill };
}

function parseColors(text) {
  const map        = {};  // hex → total weighted score
  const bgCount     = {}; // hex → times used as background
  const fgCount     = {}; // hex → times used as text/foreground
  const borderCount = {}; // hex → times used as border
  const fillCount   = {}; // hex → times used as fill (SVG/icon)
  const vars    = extractCSSVars(text);
  const varByRole = countVarReferencesByRole(text, vars);

  function add(hex, weight) {
    if (isUseful(hex)) map[hex] = (map[hex] || 0) + weight;
  }

  // Split CSS into blocks to get selector + media context per declaration
  // Strategy: walk rule-by-rule by finding { } pairs
  const ruleRe = /([^{}]*)\{([^{}]*)\}/g;
  let rule;
  while ((rule = ruleRe.exec(text)) !== null) {
    const selector  = rule[1].trim();
    const block     = rule[2];

    // Determine context multipliers
    const isBroadSel  = BROAD_SELECTOR.test(selector);
    const isDemoteSel = DEMOTE_SELECTOR.test(selector);
    const isMediaCtx  = DEMOTE_MEDIA.test(selector);
    const selectorMult = isBroadSel || isDemoteSel || isMediaCtx ? 0.5 : 1;

    const declRe = /([\w-]+)\s*:\s*([^;]+)/g;
    let d;
    while ((d = declRe.exec(block)) !== null) {
      const prop = d[1].toLowerCase();
      const raw  = d[2];
      const w    = weightFor(prop);

      // Boost brand-named CSS variable definitions
      const isBrandVar = prop.startsWith('--') && BRAND_VAR.test(prop);
      const varBoost   = isBrandVar ? 2 : 1;

      const val = resolveVars(raw, vars);
      const finalWeight = w * selectorMult * varBoost;

      const isBackground = prop.includes('background');
      const isForeground = prop === 'color';
      const isBorder     = prop.includes('border-color') || prop === 'border' || prop === 'outline-color';
      const isFill       = prop === 'fill' || prop === 'stop-color';

      const hexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
      let m;
      while ((m = hexRe.exec(val)) !== null) {
        const hex = normalizeHex(m[1]);
        add(hex, finalWeight);
        if (isBackground) bgCount[hex]     = (bgCount[hex]     || 0) + 1;
        if (isForeground) fgCount[hex]     = (fgCount[hex]     || 0) + 1;
        if (isBorder)     borderCount[hex] = (borderCount[hex] || 0) + 1;
        if (isFill)       fillCount[hex]   = (fillCount[hex]   || 0) + 1;
      }

      const rgbRe = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
      while ((m = rgbRe.exec(val)) !== null) {
        const hex = rgbToHex(+m[1], +m[2], +m[3]);
        add(hex, finalWeight);
        if (isBackground) bgCount[hex]     = (bgCount[hex]     || 0) + 1;
        if (isForeground) fgCount[hex]     = (fgCount[hex]     || 0) + 1;
        if (isBorder)     borderCount[hex] = (borderCount[hex] || 0) + 1;
        if (isFill)       fillCount[hex]   = (fillCount[hex]   || 0) + 1;
      }
    }
  }

  // Merge var-reference counts into the direct counts
  for (const [hex, n] of Object.entries(varByRole.bg))     bgCount[hex]     = (bgCount[hex]     || 0) + n;
  for (const [hex, n] of Object.entries(varByRole.fg))     fgCount[hex]     = (fgCount[hex]     || 0) + n;
  for (const [hex, n] of Object.entries(varByRole.border)) borderCount[hex] = (borderCount[hex] || 0) + n;
  for (const [hex, n] of Object.entries(varByRole.fill))   fillCount[hex]   = (fillCount[hex]   || 0) + n;

  // Cross-role bonus: colours used as both bg and fg are intentional brand colours
  for (const hex of Object.keys(bgCount)) {
    if (fgCount[hex] && map[hex]) map[hex] = Math.round(map[hex] * 1.5);
  }

  const sorted = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([hex, count]) => ({ hex, count }));

  // Group similar colours — tightened from 28 to 18 to preserve distinct shades
  const groups = [];
  for (const c of sorted) {
    const group = groups.find(g => colorDist(g[0].hex, c.hex) < 18);
    if (group) group.push(c);
    else groups.push([c]);
  }

  const result = groups
    .map(g => ({
      hex:   g[0].hex,
      count: g.reduce((s, c) => s + c.count, 0),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return { result, bgCount, fgCount, borderCount, fillCount };
}

function toPercent(colors) {
  const total = colors.reduce((s, c) => s + c.count, 0);
  return colors.map(c => ({
    ...c,
    pct: Math.round((c.count / total) * 100),
  }));
}

// ── CSS fetching ──────────────────────────────────────────────────────────────

async function fetchCSS(html, baseUrl) {
  const root   = parse(html);
  const origin = new URL(baseUrl).origin;
  let combined = '';

  root.querySelectorAll('style').forEach(s => { combined += s.rawText + '\n'; });

  // Collect CSS hrefs from both stylesheet links and preload hints
  const hrefSet = new Set();
  const toAbsolute = h => h.startsWith('http') ? h : origin + (h.startsWith('/') ? h : '/' + h);

  root.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
    const h = l.getAttribute('href');
    if (h) hrefSet.add(toAbsolute(h));
  });
  root.querySelectorAll('link[rel="preload"][as="style"]').forEach(l => {
    const h = l.getAttribute('href');
    if (h) hrefSet.add(toAbsolute(h));
  });

  // Also scan inline scripts for Next.js / webpack CSS chunk manifests
  const scriptText = root.querySelectorAll('script').map(s => s.rawText).join('\n');
  const chunkRe = /\/_next\/static\/css\/[^"']+\.css/g;
  let cm;
  while ((cm = chunkRe.exec(scriptText)) !== null) hrefSet.add(origin + cm[0]);

  const hrefs = [...hrefSet].slice(0, 24);

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

// ── Base colour extraction ────────────────────────────────────────────────────

function extractBaseColors(html, cssText) {
  const root = parse(html);
  const bases = [];
  const vars  = extractCSSVars(cssText);

  const firstColor = val => {
    if (!val) return null;
    const resolved = resolveVars(val, vars);
    const hexM = resolved.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/);
    if (hexM) return normalizeHex(hexM[1]);
    const rgbM = resolved.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
    if (rgbM) return rgbToHex(+rgbM[1], +rgbM[2], +rgbM[3]);
    return null;
  };

  // 1. body {} rules
  const bodyRuleRe = /body\s*\{([^}]+)\}/gi;
  let bm;
  while ((bm = bodyRuleRe.exec(cssText)) !== null) {
    const block = bm[1];
    const bgM   = block.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    const fgM   = block.match(/(?<![a-z-])color\s*:\s*([^;]+)/i);
    if (bgM) { const c = firstColor(bgM[1]); if (c && isUseful(c)) bases.push({ hex: c, role: 'bg', boost: 50 }); }
    if (fgM) { const c = firstColor(fgM[1]); if (c && isUseful(c)) bases.push({ hex: c, role: 'fg', boost: 40 }); }
  }

  // 2. Inline style on <body>
  const bodyEl = root.querySelector('body');
  if (bodyEl) {
    const inlineStyle = bodyEl.getAttribute('style') || '';
    const bgM = inlineStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    const fgM = inlineStyle.match(/(?<![a-z-])color\s*:\s*([^;]+)/i);
    if (bgM) { const c = firstColor(bgM[1]); if (c && isUseful(c) && !bases.find(b => b.hex === c)) bases.push({ hex: c, role: 'bg', boost: 50 }); }
    if (fgM) { const c = firstColor(fgM[1]); if (c && isUseful(c) && !bases.find(b => b.hex === c)) bases.push({ hex: c, role: 'fg', boost: 40 }); }
  }

  // 3. :root / html rules
  const rootRuleRe = /(?::root|html)\s*\{([^}]+)\}/gi;
  let rm;
  while ((rm = rootRuleRe.exec(cssText)) !== null) {
    const block = rm[1];
    const bgM   = block.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (bgM) { const c = firstColor(bgM[1]); if (c && isUseful(c) && !bases.find(b => b.hex === c)) bases.push({ hex: c, role: 'bg', boost: 45 }); }
  }

  return bases;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let parsed;
  try {
    let normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized;
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

    const baseColors = extractBaseColors(html, cssText);
    const { result: allColors, bgCount, fgCount, borderCount, fillCount } = parseColors(cssText);

    const usageCounts = hex => ({
      bgCount:     bgCount[hex]     || 0,
      fgCount:     fgCount[hex]     || 0,
      borderCount: borderCount[hex] || 0,
      fillCount:   fillCount[hex]   || 0,
    });

    const locked = [];
    ['bg', 'fg'].forEach(role => {
      const found = baseColors.find(b => b.role === role);
      if (found) locked.push({
        hex: found.hex, locked: true, role,
        ...usageCounts(found.hex),
        bgCount:     bgCount[found.hex]     || (role === 'bg' ? 1 : 0),
        fgCount:     fgCount[found.hex]     || (role === 'fg' ? 1 : 0),
      });
    });

    const accents = [];
    for (const c of allColors) {
      if (locked.some(l => colorDist(l.hex, c.hex) < 18)) continue;
      if (accents.some(a => colorDist(a.hex, c.hex) < 18)) continue;
      accents.push({
        hex: c.hex, locked: false, role: 'accent', count: c.count,
        ...usageCounts(c.hex),
      });
      if (accents.length >= 20 - locked.length) break;
    }

    const merged = [...locked, ...accents];
    const colors = toPercent(merged.map((c, i) => ({
      ...c,
      count: c.locked ? (i === 0 ? 1000 : 900) : (c.count || 1),
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