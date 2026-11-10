#!/usr/bin/env node
// Fill template.html with a bricks spec. Pulls every code line from the PR head (never retyped),
// checks each brick against the real diff, and fails when an added line belongs to no brick.
//
//   node build.mjs <spec.json> <out.html> --diff <pr.diff> [--repo <git dir>] [--allow-gaps]
//
// The spec format is documented in SKILL.md. Exit code 1 means the page was not written.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const diffPath = flag('--diff');
const repo = flag('--repo') || process.cwd();
const allowGaps = args.includes('--allow-gaps');
const [specPath, outPath] = args.filter((a) => a !== '--allow-gaps');
if (!specPath || !outPath || !diffPath) {
  console.error('usage: node build.mjs <spec.json> <out.html> --diff <pr.diff> [--repo <dir>] [--allow-gaps]');
  process.exit(2);
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const errors = [];
const warnings = [];
const LAYERS = ['data', 'logic', 'ui', 'wiring', 'test'];
const MAX_KEY_LINES = 16;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const hasEmail = (s) => /[\w.+-]+@[\w-]+\.[\w.-]+/.test(s);

// 1. Parse the diff: per file, which new-side lines sit in a hunk and which of them were added.
const files = {};
let cur = null, n = 0, deletions = 0;
for (const line of readFileSync(diffPath, 'utf8').split('\n')) {
  if (line.startsWith('diff --git')) { cur = null; continue; }
  if (line.startsWith('+++ ')) {
    const p = line.slice(4).replace(/^b\//, '');
    cur = p === '/dev/null' ? null : (files[p] = { hunk: new Set(), added: new Set() });
    continue;
  }
  if (line.startsWith('--- ')) continue;
  const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (h) { n = Number(h[1]); continue; }
  if (!cur) { if (line.startsWith('-') && !line.startsWith('---')) deletions++; continue; }
  if (line.startsWith('+')) { cur.hunk.add(n); cur.added.add(n); n++; }
  else if (line.startsWith(' ')) { cur.hunk.add(n); n++; }
  else if (line.startsWith('-')) deletions++;
}

// 2. Read each referenced file at the PR head.
const pr = spec.pr || {};
if (!pr.url || !pr.head) errors.push('pr.url and pr.head are required');
const source = {};
const fileLines = (path) => {
  if (!source[path]) {
    try {
      source[path] = execFileSync('git', ['-C', repo, 'show', `${pr.head}:${path}`], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n');
    } catch {
      errors.push(`cannot read ${path} at ${pr.head}; fetch the head first (git fetch origin pull/${pr.number}/head)`);
      source[path] = [];
    }
  }
  return source[path];
};
const anchor = (path) => createHash('sha256').update(path).digest('hex');
const href = (path, line) => `${pr.url}/files#diff-${anchor(path)}R${line}`;

// 3. Bricks: ids, layers, dependency order, ranges inside the diff, key snippets from the real file.
const skip = new Set(spec.skip || []);
const owner = {};
const seen = new Set();
for (const b of spec.bricks || []) {
  const where = `brick "${b.id}"`;
  if (!b.id || seen.has(b.id)) errors.push(`${where}: missing or duplicate id`);
  if (!LAYERS.includes(b.layer)) errors.push(`${where}: layer must be one of ${LAYERS.join(', ')}`);
  for (const f of ['name', 'job', 'adds']) if (!b[f]) errors.push(`${where}: missing ${f}`);
  for (const d of b.deps || []) if (!seen.has(d)) errors.push(`${where}: dep "${d}" is unknown or listed after it; order bricks so every dep comes first`);
  seen.add(b.id);
  b.size = 0;
  for (const r of b.ranges || []) {
    const f = files[r.file];
    if (!f) { errors.push(`${where}: ${r.file} is not in the diff`); continue; }
    const lines = fileLines(r.file);
    if (!(r.start >= 1 && r.end >= r.start && r.end <= lines.length)) { errors.push(`${where}: ${r.file}:${r.start}-${r.end} is outside the file`); continue; }
    let added = 0;
    for (let i = r.start; i <= r.end; i++) {
      if (!f.hunk.has(i)) { errors.push(`${where}: ${r.file}:${i} is not part of the diff`); break; }
      if (f.added.has(i) && lines[i - 1].trim()) {
        added++;
        (owner[`${r.file}:${i}`] = owner[`${r.file}:${i}`] || []).push(b.id);
      }
    }
    if (!added) warnings.push(`${where}: ${r.file}:${r.start}-${r.end} adds no lines`);
    b.size += added;
    r.href = href(r.file, r.start);
  }
  if (!(b.ranges || []).length) errors.push(`${where}: no ranges`);
  for (const k of b.key || []) {
    const inside = (b.ranges || []).some((r) => r.file === k.file && k.start >= r.start && k.end <= r.end);
    if (!inside) errors.push(`${where}: key ${k.file}:${k.start}-${k.end} must sit inside one of its ranges`);
    if (k.end - k.start + 1 > MAX_KEY_LINES) errors.push(`${where}: key ${k.file}:${k.start}-${k.end} is longer than ${MAX_KEY_LINES} lines; pick the lines that matter`);
    const lines = fileLines(k.file);
    k.href = href(k.file, k.start);
    k.lines = [];
    for (let i = k.start; i <= k.end && i <= lines.length; i++) {
      let text = lines[i - 1];
      if (hasEmail(text)) { warnings.push(`${where}: masked an email in ${k.file}:${i}`); text = text.replace(EMAIL, 'someone@example.com'); }
      k.lines.push({ n: i, text, add: !!files[k.file]?.added.has(i) });
    }
  }
  if (b.shot && !spec.shots?.[b.shot.id]) errors.push(`${where}: shot "${b.shot.id}" is not in shots`);
}

// 4. Coverage: every added, non-blank line of a non-skipped file belongs to exactly one brick.
let total = 0, covered = 0;
const gaps = [];
for (const [path, f] of Object.entries(files)) {
  if (skip.has(path)) continue;
  const lines = fileLines(path);
  for (const i of [...f.added].sort((a, b) => a - b)) {
    if (!lines[i - 1]?.trim()) continue;
    total++;
    const o = owner[`${path}:${i}`];
    if (o) { covered++; if (o.length > 1) warnings.push(`${path}:${i} is in ${o.length} bricks (${o.join(', ')})`); }
    else gaps.push(`${path}:${i}`);
  }
}
if (gaps.length) {
  const msg = `${gaps.length} added line(s) in no brick: ${gaps.slice(0, 12).join(', ')}${gaps.length > 12 ? ', ...' : ''}`;
  (allowGaps ? warnings : errors).push(msg);
}

// 5. Screens point at real bricks; prose carries no emails.
const ids = new Set((spec.bricks || []).map((b) => b.id));
const walk = (r, where) => {
  if (r.brick && !ids.has(r.brick)) errors.push(`${where}: region "${r.label}" names unknown brick "${r.brick}"`);
  for (const g of r.badges || []) if (!ids.has(g.brick)) errors.push(`${where}: badge "${g.text}" names unknown brick "${g.brick}"`);
  (r.children || []).forEach((c) => walk(c, where));
};
for (const s of spec.screens || []) {
  if (!s.root) errors.push(`screen "${s.name}": missing root`); else walk(s.root, `screen "${s.name}"`);
  if (s.shot && !spec.shots?.[s.shot.id]) errors.push(`screen "${s.name}": shot "${s.shot.id}" is not in shots`);
}
if (!(spec.screens || []).length) errors.push('at least one screen is required');
for (const [id, s] of Object.entries(spec.shots || {})) if (!(s.src && s.w && s.h)) errors.push(`shot "${id}": needs src, w and h`);
const prose = JSON.stringify({ ...spec, bricks: (spec.bricks || []).map(({ key, ...rest }) => rest) });
if (hasEmail(prose)) errors.push(`an email address appears in the spec text: ${prose.match(EMAIL).slice(0, 3).join(', ')}; mask it`);

// 6. Dependency diagram, by layer, dep -> dependent.
const label = (s) => String(s).replace(/"/g, '#quot;').replace(/`/g, '');
const nodeId = {};
(spec.bricks || []).forEach((b, i) => { nodeId[b.id] = `n${i + 1}`; });
const LAYER_NAMES = { data: 'Data', logic: 'Logic', ui: 'Screen', wiring: 'Wiring', test: 'Tests' };
let mermaid = `flowchart ${spec.diagram || 'TB'}\n`;
for (const l of LAYERS) {
  const list = (spec.bricks || []).filter((b) => b.layer === l);
  if (!list.length) continue;
  mermaid += `  subgraph L_${l}["${LAYER_NAMES[l]}"]\n`;
  for (const b of list) mermaid += `    ${nodeId[b.id]}["${label(b.name)}"]\n`;
  mermaid += '  end\n';
}
// Draw only direct steps: skip d -> b when b already reaches d through another dep.
const ancestors = {};
for (const b of spec.bricks || []) {
  ancestors[b.id] = new Set();
  for (const d of b.deps || []) { ancestors[b.id].add(d); for (const a of ancestors[d] || []) ancestors[b.id].add(a); }
}
for (const b of spec.bricks || []) {
  for (const d of b.deps || []) {
    const indirect = (b.deps || []).some((o) => o !== d && ancestors[o]?.has(d));
    if (nodeId[d] && !indirect) mermaid += `  ${nodeId[d]} --> ${nodeId[b.id]}\n`;
  }
}

for (const w of warnings) console.warn(`warn: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\n${errors.length} error(s); page not written.`);
  process.exit(1);
}

pr.additions = [...Object.values(files)].reduce((s, f) => s + f.added.size, 0);
pr.deletions = deletions;
pr.files = Object.keys(files).length;
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const template = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'template.html'), 'utf8');
const html = template
  .replace('__TITLE__', () => escHtml(spec.title || pr.title))
  .replace('__MERMAID__', () => escHtml(mermaid))
  .replace('__BRICKS_DATA__', () => JSON.stringify(spec).replace(/</g, '\\u003c'));
writeFileSync(outPath, html);

console.log(`Bricks: ${spec.bricks.length}   added lines covered: ${covered}/${total}${total ? ` (${Math.round((covered / total) * 100)}%)` : ''}   warnings: ${warnings.length}`);
for (const b of spec.bricks) console.log(`  ${String(b.size).padStart(4)}  ${b.layer.padEnd(6)}  ${b.name}${b.deps?.length ? `  <- ${b.deps.join(', ')}` : ''}`);
console.log(`Wrote ${outPath}`);
