---
name: bricks
description: "Help a person review a big pull request, often one an AI wrote, by cutting it into 8 to 20 small pieces (bricks) they place one at a time in the order the feature was built. Each brick says what it adds, shows its key lines and how it connects. A sketch of the screen fills in as they go, and the last brick opens a 'how it all fits' view with a dependency diagram and a five-line summary. Every added line lands in exactly one brick. Builds one HTML page. Use for '/bricks <PR>', 'break this PR into bricks', 'help me review this PR', or 'show me how this feature was built'. Not a code review: it explains the change, it does not judge it."
---

# Bricks

The reader rebuilds one PR brick by brick. A brick snaps in only when the bricks it needs are placed, so the order teaches how the feature was built. The reader is a product owner who reads code lightly: plain words, short sentences, code only where it teaches.

Read only: never change the codebase. Mask every real person's name and email, in prose, crops and sample data.

Needs `gh` (logged in), `git`, `python3` and `node` 18 or later.

In this skill's folder (the folder this file is in):
- `template.html`: the page. Fill it; never redesign it per run.
- `gather.sh`: one command that fetches the PR, clones its head into scratch and lists every added line with its number.
- `build.mjs`: fills the template from your spec, pulls every code line from the PR head, and refuses to write the page when a brick strays from the diff.
- `example.json`: a complete spec from a real run on a public PR. Copy its shape.

## 1. Gather

```bash
<skill folder>/gather.sh <pr url | owner/repo#n> <scratch>
```

One command, about two seconds. It writes `pr.json`, `pr.diff`, a readable `pr.read.diff` with lockfiles and generated files cut out, a shallow clone of the PR head in `<scratch>/repo` (never fetch into a real checkout), and `added.txt`: every added non-blank line with its new-side number, which is exactly what `ranges` and `key` need. It prints the file list, the linked issue body, any screenshots linked in the PR body, and a suggested `skip` array.

Then read only:
1. `pr.read.diff`, whole.
2. Each changed file at the head under `repo/`, plus the unchanged parents the new code plugs into (the page that renders a new component, the helpers it reuses). Those parents become the grey "already in the app" boxes.
3. Screenshots, only when gather printed some: download each into `<scratch>/out/img/`, look at it, and note its pixel size. No screenshots means no crops; never invent one.

Copy `skip` from gather's suggestion. Write `bricks.json` in one pass from `added.txt`; build.mjs refuses any real person's email in the spec text, so write role mailboxes as "the invites mailbox" rather than the address.

## 2. Cut the bricks

- One brick is the smallest piece that makes sense alone and that a product owner could name: a query, a filter rule, a component, a price, a link, a click event, a flag check, an admin switch, a group of tests.
- Every added non-blank line belongs to exactly one brick; build.mjs fails otherwise. Imports go with the brick that uses them. Lockfiles and generated files go in `skip`. A file of pure scaffolding (a test harness) is one brick.
- Order the array the way the feature is built: data, logic, screen, wiring, tests. Each dep comes earlier in the array. A dep is real only when the brick reads, calls, renders or tests the other one: check the code, not the names.
- 8 to 20 bricks. On a big PR, merge small pieces into their parent behaviour instead of passing 20.
- `layer` is `data`, `logic`, `ui`, `wiring` or `test`. `ui` bricks fill screen boxes; the others show under "Behind the screen".

Per brick: `name` (2 to 5 words), `job` (one sentence), `adds` (2 to 4 short sentences: what it does and why it's written that way), `connects` (how it uses the bricks before it), `ranges` (file and new-side line numbers, as in the diff), and `key` (one or two snippets of at most 16 lines, inside its ranges, that teach the most). Test bricks list their real test names in `checks`. Backticks mark code names in prose.

## 3. Draw the screen

One `screens[]` entry per screen the PR touches, as nested boxes. build.mjs requires at least one. A server-only PR has no screen: draw the path instead, with the real entry function as the root box, the new code as the brick box, and the existing callers as grey boxes, each carrying real strings from the code such as an email subject.
- Every labelled box is a real component, element or function from the code. Never invent one.
- `existing: true` for boxes the PR didn't add. A new box names the `brick` that fills it.
- `lines` hold short text copied from the real UI, each with a `look`: heading, strong, muted, button, chip or text.
- `badges` mark a brick that attaches to a box without being one (a lazy import, an analytics call).
- A layout-only group has just `dir` (`row` or `col`) and `children`.

Screenshots go in `shots` with `src` (published path), `w`, `h`, `alt`. A brick's `shot` and a screen's `shot` take `crop: [x, y, w, h]` as fractions of the image: crop to what that brick adds. Write five plain sentences in `summary` for the final view.

## 4. Build

```bash
node <skill folder>/build.mjs <scratch>/bricks.json <scratch>/out/bricks.html \
  --diff <scratch>/pr.diff --repo <repo checkout>
```

Fix every error and rerun until it writes the page and reports 100% coverage. `--allow-gaps` is only for a draft. It also builds the Mermaid dependency diagram (direct edges only, by layer; set `"diagram": "LR"` for a wide one).

## 5. Look once, publish

build.mjs writes a page fragment. To view it as a file, wrap it:

```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<!-- the built page -->
<script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs"; mermaid.initialize({ startOnLoad: true, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });</script>
</body></html>
```

Put any screenshots beside it under `img/`. Optional single look: open it in a browser, click Place all, and check the final view in light, dark and at 390px wide.

Publish the page anywhere that serves HTML. Two common options:
- A static file: commit the wrapped page and its `img/` folder to GitHub Pages, a gist preview, or any static host.
- The claude.ai Artifact tool, if you have it: publish the built page with `icon: "blocks"` and pass screenshots in `files`. Artifacts render the diagram themselves, so skip the wrapper.

## Report

Where the page lives, the coverage line build.mjs printed, and any brick whose cut you weren't sure about.
