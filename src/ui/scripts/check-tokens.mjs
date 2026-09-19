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

/** Map every colour literal a token defines back to that token's name. */
function readTokenColors() {
  const source = readFileSync(tokensFile, 'utf8');
  const colors = new Map();
  for (const [, name, rawValue] of source.matchAll(/(--oc-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const value = rawValue.trim().toLowerCase();
    if (!/^(#|rgba?\()/.test(value)) continue;
    if (!colors.has(value)) colors.set(value, name);
    // #rrggbb and #rgb spell the same colour; index both.
    const short = value.match(/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/);
    if (short) colors.set(`#${short[1]}${short[2]}${short[3]}`, name);
  }
  return colors;
}

function collectStylesheets(target) {
  const stats = statSync(target);
  if (stats.isFile()) return extname(target) === '.css' ? [target] : [];
  return readdirSync(target).flatMap((entry) => {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) return [];
    return collectStylesheets(join(target, entry));
  });
}

const tokenColors = readTokenColors();
const args = process.argv.slice(2);
const fix = args.includes('--fix');
const targets = args.filter((arg) => arg !== '--fix').map((arg) => resolve(process.cwd(), arg));
const files = (targets.length > 0 ? targets : [join(packageRoot, 'css')]).flatMap(collectStylesheets);

const findings = [];
const rewritten = new Set();
for (const file of files) {
  // tokens.css is where the literals are supposed to live.
  if (resolve(file) === tokensFile) continue;
  const original = readFileSync(file, 'utf8');
  const lines = original.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('/*')) return;
    for (const [, literal] of line.matchAll(/(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\))/g)) {
      const token = tokenColors.get(literal.toLowerCase().replace(/\s+/g, ''))
        ?? tokenColors.get(literal.toLowerCase());
      if (!token) continue;
      findings.push({
        file: relative(process.cwd(), file),
        line: index + 1,
        literal,
        token,
        text: line.trim(),
      });
    }
  });

  if (!fix) continue;
  // Rewrite longest literals first so #ffffff is not clipped by a #fff rule.
  const literals = [...new Set(findings.filter((f) => resolve(process.cwd(), f.file) === resolve(file)).map((f) => f.literal))]
    .sort((a, b) => b.length - a.length);
  let updated = original;
  for (const literal of literals) {
    const token = tokenColors.get(literal.toLowerCase().replace(/\s+/g, '')) ?? tokenColors.get(literal.toLowerCase());
    const pattern = new RegExp(`${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9a-fA-F])`, 'g');
    updated = updated.replace(pattern, `var(${token})`);
  }
  if (updated !== original) {
    writeFileSync(file, updated);
    rewritten.add(relative(process.cwd(), file));
  }
}

if (fix) {
  if (rewritten.size === 0) {
    console.log(`check-tokens --fix: nothing to rewrite in ${files.length} stylesheet(s).`);
  } else {
    console.log(`check-tokens --fix: replaced ${findings.length} literal(s) in ${rewritten.size} file(s):`);
    for (const file of rewritten) console.log(`  ${file}`);
  }
  process.exit(0);
}

if (findings.length === 0) {
  console.log(`check-tokens: ${files.length} stylesheet(s) clean.`);
  process.exit(0);
}

console.error(`check-tokens: ${findings.length} hardcoded colour(s) that a token already names.\n`);
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}`);
  console.error(`    ${finding.text}`);
  console.error(`    ${finding.literal} is var(${finding.token})\n`);
}
console.error('Run with --fix to rewrite these to their tokens.');
process.exit(1);
