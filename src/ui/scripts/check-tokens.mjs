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

/** #abc, #aabbcc, #aabbccdd, rgb(), rgba() -> [r, g, b, a] or null. */
function parseColor(literal) {
  const value = literal.trim().toLowerCase();
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

/** Every colour a token defines, ready to measure against. */
function readTokens() {
  const source = readFileSync(tokensFile, 'utf8');
  const tokens = [];
  const seen = new Set();
  for (const [, name, rawValue] of source.matchAll(/(--oc-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const value = rawValue.trim().toLowerCase();
    if (!/^(#|rgba?\()/.test(value)) continue;
    // --oc-l-* are the light palette's raw inputs, which the theme blocks map
    // onto the real tokens. Nothing should reference them directly, and their
    // values collide with dark surfaces -- #202024 is light text and a dark
    // panel -- so indexing them would tell a dark rule to use a text token.
    if (name.startsWith('--oc-l-')) continue;
    if (seen.has(name)) continue;
    const color = parseColor(value);
    if (!color) continue;
    seen.add(name);
    tokens.push({ name, value, color, lab: toLab(color) });
  }
  return tokens;
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

const tokens = readTokens();
const args = process.argv.slice(2);
const fix = args.includes('--fix');
const targets = args.filter((arg) => arg !== '--fix').map((arg) => resolve(process.cwd(), arg));
const files = (targets.length > 0 ? targets : [join(packageRoot, 'css')]).flatMap(collectStylesheets);

const drift = [];
const loose = [];
const shadows = [];
const rewritten = new Set();

for (const file of files) {
  // tokens.css is where the literals are supposed to live.
  if (resolve(file) === tokensFile) continue;
  const original = readFileSync(file, 'utf8');
  const edits = [];

  for (const hit of original.matchAll(/(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\))/g)) {
    const literal = hit[0];
    const index = hit.index;
    if (inComment(original, index)) continue;
    if (exemptAt(original, index)) continue;
    const color = parseColor(literal);
    if (!color) continue;
    const found = match(color, tokens);
    if (!found || found.distance > LOOSE) continue;

    const property = propertyAt(original, index);
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
  if (loose.length > 0) {
    console.log(`\n${loose.length} colour(s) are close to a token but not close enough to rewrite.`);
    console.log('Pick a token deliberately, or add one if the palette is missing a rung:');
    for (const f of loose) console.log(`  ${f.file}:${f.line}  ${f.literal}  ~ var(${f.token}) (off by ${f.distance.toFixed(1)})`);
  }
  process.exit(0);
}

if (drift.length === 0 && themeProblems.length === 0) {
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
