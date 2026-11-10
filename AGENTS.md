# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- The skill is `skill/`; `template.html` is the product, so don't redesign it per run. The plugin manifest (`.claude-plugin/plugin.json`) points at `./skill`.
- `docs/` is the GitHub Pages site (main, /docs), plain static files with relative links. `docs/demo/index.html` is `build.mjs` output for `skill/example.json`, wrapped as SKILL.md step 5 shows (doctype + Mermaid script). Rebuild it after any template or build change: `gather.sh excalidraw/excalidraw#12173 <scratch>`, then `build.mjs skill/example.json ... --diff <scratch>/pr.diff --repo <scratch>/repo`, then wrap.
- Test template changes on the standalone page too, not only as an Artifact: Artifacts inject resets (e.g. `[hidden]{display:none!important}`) that a plain file lacks, so `el.hidden` on anything styled with `display` silently fails on Pages.
- Never put a private repo, company name, or personal email in the example or docs.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
