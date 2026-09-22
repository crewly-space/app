#!/usr/bin/env node
/*
 * Drift guard.
 *
 * The three Crewly surfaces drifted apart once already: the accent was
 * #f05b3e in the app and console but #ef5b3e on the website, and bg, line,
 * muted and text each had two spellings. This script fails when a stylesheet
 * hardcodes a colour that a token already names, so the drift cannot come back
 * without someone deciding to.
 *
 * Matching an exact literal was not enough. When the guard only caught
 * spellings equal to a token, the drift came back as near misses it could not
 * see: six greys within a shade of --oc-muted (#68686f, #73737a, #77777e,
 * #7b7b83, #7d7d84, #8a8a92), seven improvised panel rungs between --oc-bg and
 * --oc-panel-2, and the old website accent still shipping as
 * rgba(239, 91, 62, .15) where no string comparison would ever match it. So
 * the comparison is perceptual: every literal is converted to CIELAB and
 * measured against every token, and anything that lands within a shade of one
 * is drift.
 *
 * Usage:
 *   node scripts/check-tokens.mjs [dir-or-file...]
 *   node scripts/check-tokens.mjs --fix [dir-or-file...]
 *
 * With no arguments it checks this package's own stylesheets. A consuming repo
 * points it at its CSS directory and runs it in CI. --fix rewrites each
 * hardcoded colour to the token that already names it.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokensFile = join(packageRoot, 'css', 'tokens.css');

/*
 * How close a literal has to be before the guard calls it drift.
 *
 * NEAR is a CIELAB delta-E. Around 2.3 is the textbook "just noticeable
 * difference"; 6 is comfortably inside "the same colour, typed twice from
 * memory" and still well short of two rungs of a surface ramp, which are 8 to
 * 12 apart. Raising it past that would start collapsing --oc-panel into
 * --oc-panel-2, which are different roles.
 *
 * ALPHA keeps a translucent tint from matching the opaque colour it is a tint
 * of: rgba(240, 91, 62, .08) is --oc-accent-wash, not --oc-accent. A scrim at
 * .55 sits between --oc-scrim (.4) and --oc-scrim-strong (.72) and is reported
 * rather than rewritten, because which one it meant is a judgement call.
 */
const NEAR = 6;
const ALPHA = 0.04;
/* Beyond NEAR but inside this, the guard reports without failing: close enough
 * to be worth a look, far enough that it may be a colour the palette lacks. */
const LOOSE = 14;

/*
 * The named colours CSS allows. `color: white` is exactly the hardcoding this
 * guard exists to catch, and for a while it walked straight past it: four
 * accent-filled buttons across the app and console spelled their label `white`
 * and no hex ever appeared for the matcher to see. Only the handful that turn
 * up in real stylesheets are listed; the rest would be noise.
 */
const NAMED = {
  white: '#ffffff', black: '#000000', red: '#ff0000', gray: '#808080', grey: '#808080',
  silver: '#c0c0c0', whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc', lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', dimgray: '#696969',
  dimgrey: '#696969', orange: '#ffa500', tomato: '#ff6347', coral: '#ff7f50',
  crimson: '#dc143c', green: '#008000', lime: '#00ff00', teal: '#008080',
  navy: '#000080', blue: '#0000ff', yellow: '#ffff00', gold: '#ffd700',
};

/** #abc, #aabbcc, #aabbccdd, rgb(), rgba(), or a named colour -> [r,g,b,a]. */
function parseColor(literal) {
  let value = literal.trim().toLowerCase();
  if (NAMED[value]) value = NAMED[value];
  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), alpha];
  }
  const match = value.match(/^rgba?\(([^)]*)\)$/);
  if (!match) return null;
  const parts = match[1].split(/[,/\s]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  const alpha = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
  return [parts[0], parts[1], parts[2], alpha];
}

function toLab([r, g, b]) {
  const linear = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = linear(r), G = linear(g), B = linear(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* How far a colour sits from the grey axis, and which way. */
const chroma = (lab) => Math.hypot(lab[1], lab[2]);
const hue = (lab) => (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;

/*
 * Whether two colours belong to the same family.
 *
 * Delta-E alone is not enough at the dark end of the ramp. CIELAB compresses
 * as lightness falls, so a green-tinted chip ground (#121a15) and a warm one
 * (#17120f) measure barely four apart -- inside any sane threshold -- and the
 * guard cheerfully rewrote a healthy green status chip to the accent's orange.
 * Below, once both colours are tinted enough for the tint to be the point,
 * their hues have to agree as well.
 */
const TINTED = 3.5;      /* chroma above which a colour reads as tinted, not grey */
const HUE_AGREE = 45;    /* degrees two tints may differ and still be one family */

function sameFamily(a, b) {
  const ca = chroma(a);
  const cb = chroma(b);
  // One is grey and the other is not: a tinted surface is not a neutral one.
  if ((ca < TINTED) !== (cb < TINTED)) return false;
  if (ca < TINTED && cb < TINTED) return true;
  let delta = Math.abs(hue(a) - hue(b));
  if (delta > 180) delta = 360 - delta;
  return delta <= HUE_AGREE;
}

/**
 * Every colour a token defines, ready to measure against -- twice.
 *
 * A rule inside :root[data-theme="light"] is painting the light theme, so its
 * literals have to be measured against the light palette. Measuring them
 * against the dark one is how #ffffff came out as var(--oc-text-strong): true
 * in the dark theme, and in the light theme that token is #0b0b0c, so every
 * white surface in the app's light block turned near-black.
 *
 * Both tables carry the same role names; only the values differ. Matching in
 * the right table and emitting the role name gets a token that is correct in
 * the theme where it is written.
 */
function readTokens() {
  const source = readFileSync(tokensFile, 'utf8');
  const raw = new Map();
  for (const [, name, rawValue] of source.matchAll(/(--oc-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const value = rawValue.trim().toLowerCase();
    if (!/^(#|rgba?\()/.test(value)) continue;
    if (!raw.has(name)) raw.set(name, value);
  }
  const build = (light) => {
    const out = [];
    for (const [name, value] of raw) {
      // --oc-l-* are the light palette's raw inputs; the roles are what code
      // refers to, so only roles are indexed.
      if (name.startsWith('--oc-l-')) continue;
      const chosen = light ? (raw.get(name.replace('--oc-', '--oc-l-')) ?? value) : value;
      const color = parseColor(chosen);
      if (!color) continue;
      out.push({ name, value: chosen, color, lab: toLab(color) });
    }
    return out;
  };
  return { dark: build(false), light: build(true) };
}

/*
 * Which palette the literal at `index` is painting. A rule under
 * [data-theme="light"], or inside an @media (prefers-color-scheme: light),
 * is writing the light theme.
 */
function paletteAt(source, index) {
  // The selector this declaration belongs to.
  const brace = source.lastIndexOf('{', index);
  if (brace !== -1) {
    const prior = Math.max(source.lastIndexOf('}', brace), source.lastIndexOf('{', brace - 1));
    const selector = source.slice(prior + 1, brace);
    if (/\[data-theme=["']?light["']?\]/.test(selector)) return 'light';
  }
  // Or an enclosing light media query.
  for (const at of source.matchAll(/@media[^{]*prefers-color-scheme:\s*light[^{]*\{/g)) {
    if (at.index > index) break;
    let depth = 1;
    let i = at.index + at[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') depth -= 1;
      i += 1;
    }
    if (index < i) return 'light';
  }
  return 'dark';
}

/*
 * The light theme is mapped twice -- once for an explicit [data-theme="light"]
 * and once for a reader whose system asks for light -- and a role added to one
 * block but not the other renders its dark value on a white panel. The file
 * says the two cannot drift apart; this is what makes that true.
 */
function checkThemeBlocksAgree() {
  const source = readFileSync(tokensFile, 'utf8');
  const explicit = source.match(/:root\[data-theme="light"\]\s*\{[\s\S]*?\n\}/);
  const media = source.match(/@media \(prefers-color-scheme: light\)[\s\S]*?\n\s*\}\n\}/);
  if (!explicit || !media) return ['tokens.css: could not find both light-theme blocks'];
  const roles = (text) => new Set([...text.matchAll(/(--oc-[a-z0-9-]+):\s*var\(--oc-l-/g)].map((m) => m[1]));
  const a = roles(explicit[0]);
  const b = roles(media[0]);
  const missing = [
    ...[...a].filter((r) => !b.has(r)).map((r) => `${r} is mapped for [data-theme="light"] but not for prefers-color-scheme`),
    ...[...b].filter((r) => !a.has(r)).map((r) => `${r} is mapped for prefers-color-scheme but not for [data-theme="light"]`),
  ];
  // Every light input should actually be mapped somewhere.
  const declared = new Set([...source.matchAll(/(--oc-l-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  for (const input of declared) {
    const role = input.replace('--oc-l-', '--oc-');
    if (!a.has(role)) missing.push(`${input} is declared but never mapped onto ${role}`);
  }
  return missing;
}

/*
 * A hover or focus rule that resolves to the value its base rule already has.
 *
 * This is the failure mode of a careless token swap. The app's primary button
 * brightened to #fa6749 on hover; the nearest token by distance was
 * --oc-accent, which is exactly what the button already sat at, so the rewrite
 * left a button that no longer responded to the pointer. The same swap ate a
 * secondary button's border and a server row's hover in the console. Nothing
 * looks wrong in the diff -- the colour is a token now -- so the check has to
 * compare resolved values rather than trust the literal.
 */
const STATE_SELECTOR = /:hover(?:\([^)]*\))?|:focus(?:-visible|-within)?|\.active|\[aria-selected=["']?true["']?\]|:not\([^)]*\)/g;

function findDeadStates(file, source, aliases) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const resolve_ = (value) =>
    value.replace(/var\((--[a-z0-9-]+)\)/g, (hit, name) => `var(${aliases.get(name) ?? name})`)
      .replace(/\s+/g, ' ')
      .trim();
  const declarations = [];
  for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/@media|@supports|@keyframes/.test(rule[1])) continue;
    const line = text.slice(0, rule.index).split(/\r?\n/).length;
    /*
     * A rule may set a custom property and then use it:
     *
     *   .session-row:hover { --surface: var(--oc-panel-2); background: var(--surface); }
     *
     * Compared literally that background matches the base rule's and looks
     * dead, when the rule in fact repainted --surface first. Substitute what
     * the rule itself declares before comparing.
     */
    const local = new Map();
    for (const d of rule[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/g)) local.set(d[1], resolve_(d[2]));
    const settle = (value) => {
      let out = resolve_(value);
      for (let pass = 0; pass < 4 && /var\(--/.test(out); pass += 1) {
        const next = out.replace(/var\((--[a-z0-9-]+)\)/g, (hit, name) => local.get(name) ?? hit);
        if (next === out) break;
        out = next;
      }
      return out;
    };
    for (const selector of rule[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean)) {
      for (const d of rule[2].matchAll(/([-a-z]+)\s*:\s*([^;]+)/g)) {
        declarations.push({ selector, property: d[1].trim(), value: settle(d[2]), line });
      }
    }
  }
  const index = new Map();
  for (const d of declarations) index.set(`${d.selector}|${d.property}`, d);
  const found = [];
  const seen = new Set();
  for (const d of declarations) {
    if (!/:hover|:focus|\.active|\[aria-selected/.test(d.selector)) continue;
    const base = d.selector.replace(STATE_SELECTOR, '').replace(/\s+/g, ' ').trim();
    if (!base || base === d.selector) continue;
    const other = index.get(`${base}|${d.property}`);
    if (!other || other.value !== d.value) continue;
    const key = `${d.selector}|${d.property}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ file: relative(process.cwd(), file), line: d.line, selector: d.selector, property: d.property, value: d.value, base });
  }
  return found;
}

/** tokens.css aliases --accent onto --oc-accent; two spellings, one colour. */
function readAliases() {
  const source = readFileSync(tokensFile, 'utf8');
  const aliases = new Map();
  for (const [, name, target] of source.matchAll(/(--[a-z0-9-]+):\s*var\((--oc-[a-z0-9-]+)\);/g)) {
    if (!name.startsWith('--oc-')) aliases.set(name, target);
  }
  return aliases;
}

function collectStylesheets(target) {
  const stats = statSync(target);
  if (stats.isFile()) return extname(target) === '.css' ? [target] : [];
  return readdirSync(target).flatMap((entry) => {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) return [];
    return collectStylesheets(join(target, entry));
  });
}

/*
 * Shadows have their own tokens (--oc-shadow*), and the black they are built
 * from is not a scrim. Matching inside one would rewrite the blur colour of a
 * box-shadow into a modal-backdrop token, so the guard leaves them alone and
 * says so once at the end.
 */
/*
 * Which declaration a colour belongs to.
 *
 * Scanning line by line was wrong for the console, which packs a whole rule
 * onto one line: a single box-shadow anywhere on the line made the guard treat
 * every colour on it as a shadow and skip the lot, hiding 60-odd literals. So
 * the property is recovered per declaration -- scan back to the punctuation
 * that ended the previous one -- and each colour is judged on its own.
 */
function propertyAt(source, index) {
  let start = index;
  while (start > 0 && !';{}'.includes(source[start - 1])) start -= 1;
  const declaration = source.slice(start, index);
  const match = declaration.match(/([-a-zA-Z]+)\s*:/);
  return match ? match[1].toLowerCase() : '';
}

/*
 * Shadows have their own tokens (--oc-shadow*), and the black they are built
 * from is not a scrim. Rewriting one would turn a box-shadow's blur colour
 * into a modal-backdrop token, so the guard leaves them alone.
 */
const isShadow = (property) => /^(?:box-shadow|text-shadow|--oc-shadow)/.test(property);

/*
 * A bare word is a colour only where a colour can go. Without this, \bwhite\b
 * also matches the selector .white-panel, a font named "Helvetica White",
 * url(/white.png), and any custom property with the word in its name.
 */
const COLOR_PROPERTY = /^(?:color|background|background-color|border[a-z-]*|outline[a-z-]*|fill|stroke|caret-color|accent-color|text-decoration-color|column-rule-color)$/;
const isText = (property) => property === 'color';

/* `/* token-exempt: why *\/` opts a colour out. The reason is not optional. */
const EXEMPT = /token-exempt:\s*[A-Za-z][^*]*/;

/* True when the literal at `index` sits inside a comment. */
function inComment(source, index) {
  const open = source.lastIndexOf('/*', index);
  if (open === -1) return false;
  return source.indexOf('*/', open) > index;
}

/* The line `index` falls on, and the one before it, for the exemption check. */
function exemptAt(source, index) {
  const start = source.lastIndexOf('\n', index) + 1;
  let end = source.indexOf('\n', index);
  if (end === -1) end = source.length;
  const line = source.slice(start, end);
  const priorStart = source.lastIndexOf('\n', start - 2) + 1;
  const prior = start > 0 ? source.slice(priorStart, start - 1) : '';
  return EXEMPT.test(line) || EXEMPT.test(prior);
}

function match(color, tokens) {
  const lab = toLab(color);
  let best = null;
  let bestDistance = Infinity;
  for (const token of tokens) {
    if (Math.abs(token.color[3] - color[3]) > ALPHA) continue;
    if (!sameFamily(lab, token.lab)) continue;
    const distance = deltaE(lab, token.lab);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = token;
    }
  }
  return best ? { token: best, distance: bestDistance } : null;
}

const palettes = readTokens();
const tokens = palettes.dark;
const args = process.argv.slice(2);
const fix = args.includes('--fix');
const targets = args.filter((arg) => arg !== '--fix').map((arg) => resolve(process.cwd(), arg));
const files = (targets.length > 0 ? targets : [join(packageRoot, 'css')]).flatMap(collectStylesheets);

const aliases = readAliases();
const deadStates = [];
const drift = [];
const loose = [];
const shadows = [];
const rewritten = new Set();

for (const file of files) {
  // tokens.css is where the literals are supposed to live.
  if (resolve(file) === tokensFile) continue;
  const original = readFileSync(file, 'utf8');
  deadStates.push(...findDeadStates(file, original, aliases));
  const edits = [];

  for (const hit of original.matchAll(/(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:black|blue|coral|crimson|darkgray|darkgrey|dimgray|dimgrey|gainsboro|gold|gray|green|grey|lightgray|lightgrey|lime|navy|orange|red|silver|teal|tomato|white|whitesmoke|yellow)\b)/g)) {
    const literal = hit[0];
    const index = hit.index;
    if (inComment(original, index)) continue;
    if (exemptAt(original, index)) continue;
    const color = parseColor(literal);
    if (!color) continue;
    const property = propertyAt(original, index);
    // A named colour counts only where a colour can go, or .white-panel,
    // url(/white.png) and --my-white-thing all read as the colour white.
    if (NAMED[literal.toLowerCase()] && !COLOR_PROPERTY.test(property)) continue;
    const palette = paletteAt(original, index);
    const found = match(color, palettes[palette]);
    if (!found || found.distance > LOOSE) continue;

    const line = original.slice(0, index).split(/\r?\n/).length;
    const text = original.slice(original.lastIndexOf('\n', index) + 1,
      original.indexOf('\n', index) === -1 ? undefined : original.indexOf('\n', index)).trim();
    const where = { file: relative(process.cwd(), file), line, literal, text: text.slice(0, 120) };

    if (isShadow(property)) {
      if (found.distance <= NEAR) shadows.push({ ...where, token: found.token.name });
      continue;
    }
    if (found.distance <= NEAR) {
      drift.push({ ...where, token: found.token.name, distance: found.distance });
      edits.push({ index, length: literal.length, token: found.token.name });
    } else {
      loose.push({ ...where, token: found.token.name, distance: found.distance, isText: isText(property) });
    }
  }

  if (!fix || edits.length === 0) continue;
  // Splice from the back so earlier offsets stay valid.
  let updated = original;
  for (const edit of edits.reverse()) {
    updated = updated.slice(0, edit.index) + `var(${edit.token})` + updated.slice(edit.index + edit.length);
  }
  if (updated !== original) {
    writeFileSync(file, updated);
    rewritten.add(relative(process.cwd(), file));
  }
}

const themeProblems = checkThemeBlocksAgree();

if (fix) {
  if (rewritten.size === 0) {
    console.log(`check-tokens --fix: nothing to rewrite in ${files.length} stylesheet(s).`);
  } else {
    console.log(`check-tokens --fix: replaced ${drift.length} literal(s) in ${rewritten.size} file(s):`);
    for (const file of rewritten) console.log(`  ${file}`);
  }
  if (deadStates.length > 0) {
    console.log(`\n${deadStates.length} hover/focus rule(s) now change nothing; check them:`);
    for (const d of deadStates) console.log(`  ${d.file}:${d.line}  ${d.selector} ${d.property}: ${d.value}`);
  }
  if (loose.length > 0) {
    console.log(`\n${loose.length} colour(s) are close to a token but not close enough to rewrite.`);
    console.log('Pick a token deliberately, or add one if the palette is missing a rung:');
    for (const f of loose) console.log(`  ${f.file}:${f.line}  ${f.literal}  ~ var(${f.token}) (off by ${f.distance.toFixed(1)})`);
  }
  process.exit(0);
}

if (deadStates.length > 0) {
  console.error(`check-tokens: ${deadStates.length} hover/focus rule(s) that change nothing.\n`);
  for (const d of deadStates) {
    console.error(`  ${d.file}:${d.line}`);
    console.error(`    ${d.selector} sets ${d.property}: ${d.value}`);
    console.error(`    which is what ${d.base} already has\n`);
  }
}

if (drift.length === 0 && themeProblems.length === 0 && deadStates.length === 0) {
  console.log(`check-tokens: ${files.length} stylesheet(s) clean.`);
  if (loose.length > 0) console.log(`${loose.length} near-token colour(s) noted; run with --fix to list them.`);
  if (shadows.length > 0) console.log(`${shadows.length} shadow colour(s) left alone; --oc-shadow* may fit.`);
  process.exit(0);
}

if (themeProblems.length > 0) {
  console.error(`check-tokens: the two light-theme blocks do not agree.\n`);
  for (const problem of themeProblems) console.error(`  ${problem}`);
  console.error('');
}

if (drift.length > 0) {
  console.error(`check-tokens: ${drift.length} hardcoded colour(s) that a token already names.\n`);
  for (const finding of drift) {
    console.error(`  ${finding.file}:${finding.line}`);
    console.error(`    ${finding.text}`);
    console.error(`    ${finding.literal} is var(${finding.token})${finding.distance > 0.5 ? ` (off by ${finding.distance.toFixed(1)})` : ''}\n`);
  }
  console.error('Run with --fix to rewrite these to their tokens.');
}
process.exit(1);
