#!/usr/bin/env bash
# One-shot gather for /bricks. Writes everything build.mjs and the brick cut need
# into <scratch>, then prints a compact brief. Idempotent; reruns reuse the clone.
#
#   gather.sh <pr-url | owner/repo#n> <scratch-dir>
#
# Writes:
#   pr.json      gh pr view fields build.mjs needs (number,url,title,body,head...)
#   pr.diff      the full diff, for build.mjs coverage
#   pr.read.diff the same diff without lockfiles/generated files, for reading
#   repo/        shallow clone of the PR head (never touches an existing checkout)
#   added.txt    every added non-blank line: file:newLine: text, grouped by file
#   skip.json    suggested "skip" array (lockfiles and generated files)
set -euo pipefail

ref="${1:?pr url or owner/repo#n}"; scratch="${2:?scratch dir}"
if [[ "$ref" =~ github.com/([^/]+/[^/]+)/pull/([0-9]+) ]]; then repo="${BASH_REMATCH[1]}"; num="${BASH_REMATCH[2]}"
elif [[ "$ref" =~ ^([^#]+)#([0-9]+)$ ]]; then repo="${BASH_REMATCH[1]}"; num="${BASH_REMATCH[2]}"
else echo "unrecognised PR ref: $ref" >&2; exit 2; fi
mkdir -p "$scratch/out"
t0=$(date +%s)

gh pr view "$num" --repo "$repo" --json number,url,title,body,headRefName,headRefOid,files,closingIssuesReferences > "$scratch/pr.json"
gh pr diff "$num" --repo "$repo" > "$scratch/pr.diff"
head=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["headRefOid"])' "$scratch/pr.json")
branch=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["headRefName"])' "$scratch/pr.json")

# Head clone: shallow, into scratch only. Reuse when it already holds the head.
if ! git -C "$scratch/repo" cat-file -e "$head^{commit}" 2>/dev/null; then
  rm -rf "$scratch/repo"
  git clone -q --depth 1 --branch "$branch" "https://github.com/$repo.git" "$scratch/repo"
  git -C "$scratch/repo" rev-parse HEAD | grep -q "^$head" || { echo "clone HEAD is not the PR head $head (branch moved?)" >&2; exit 1; }
fi

# Generated files: out of the readable diff, into the suggested skip list.
gen='package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$|\.snap$|/dist/|/build/|\.min\.(js|css)$|\.generated\.|schema\.graphql$'
awk -v gen="$gen" '/^diff --git/{f=$4; sub(/^b\//,"",f); skip=(f ~ gen)} !skip' "$scratch/pr.diff" > "$scratch/pr.read.diff"
python3 - "$scratch/pr.json" "$gen" > "$scratch/skip.json" <<'PY'
import json,re,sys
files=[f["path"] for f in json.load(open(sys.argv[1]))["files"]]
print(json.dumps([f for f in files if re.search(sys.argv[2],f)]))
PY

# Every added non-blank line with its new-side number (what ranges/key need).
awk -v gen="$gen" '
  /^diff --git/{f=$4; sub(/^b\//,"",f); skip=(f ~ gen); next}
  /^\+\+\+|^---/{next}
  /^@@/{split($3,a,/[,+]/); n=a[2]-1; next}
  /^\+/{n++; if(!skip && $0 !~ /^\+[[:space:]]*$/){ if(f!=last){print "\n## " f; last=f} print n": "substr($0,2)} next}
  /^[^-\\]/{n++}
' "$scratch/pr.diff" > "$scratch/added.txt"

# Brief.
python3 - "$scratch/pr.json" <<'PY'
import json,re,sys
d=json.load(open(sys.argv[1]))
print(f"PR #{d['number']}  {d['title']}\n{d['url']}\nhead {d['headRefOid']}  branch {d['headRefName']}")
print("files:", *[f"\n  {f['path']} (+{f['additions']} -{f['deletions']})" for f in d['files']])
iss=[i['number'] for i in d.get('closingIssuesReferences') or []]
print("linked issues:", iss or "none")
m=re.findall(r'https://claude\.ai/artifact/\S+', d.get('body') or '')
print("demo report artifact:", m[0] if m else "none (no screenshots; draw the screen from code only)")
PY
for n in $(python3 -c 'import json,sys;print(" ".join(str(i["number"]) for i in json.load(open(sys.argv[1])).get("closingIssuesReferences") or []))' "$scratch/pr.json"); do
  echo; echo "## issue #$n"; gh issue view "$n" --repo "$repo" --json title,body --jq '"\(.title)\n\n\(.body)"' 2>/dev/null || echo "(issue #$n is not in $repo; read it from its own repo)"
done
echo; echo "suggested skip: $(cat "$scratch/skip.json")"
echo "added lines ($(grep -c '^[0-9]' "$scratch/added.txt")): $scratch/added.txt"
echo
cat "$scratch/added.txt"
echo
echo "gather done in $(( $(date +%s) - t0 ))s. Next: read pr.read.diff and the changed files under repo/, write bricks.json, then"
echo "  node $(dirname "$0")/build.mjs $scratch/bricks.json $scratch/out/bricks.html --diff $scratch/pr.diff --repo $scratch/repo"
