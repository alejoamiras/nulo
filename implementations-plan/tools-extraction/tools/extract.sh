#!/usr/bin/env bash
# Replays the unleashed history import at a freeze SHA: a fresh clone of nulo filtered to the
# extracted paths, one bootstrap commit of root config, then the pre-push audit. Pushes nothing:
# the push is a separate, owner-approved step, and the rehearsal and the real run differ only there.
#
#   extract.sh <freeze-sha> <workdir>
#
# <workdir> must not exist. It receives unleashed/ (the repository, one ref: main), freeze/ (the
# freeze tree, the only source of copied material) and report/ (analysis, commit-map, audit).
# Tools come from $EXTRACTION_TOOLS (default ~/.local/share/extraction-tools/bin).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tools_bin=${EXTRACTION_TOOLS:-$HOME/.local/share/extraction-tools/bin}
remote=${NULO_REMOTE:-https://github.com/alejoamiras/nulo.git}

die() {
  echo "extract: $*" >&2
  exit 1
}

[ $# -eq 2 ] || die "usage: extract.sh <freeze-sha> <workdir>"
sha=$1
[[ $sha =~ ^[0-9a-f]{40}$ ]] || die "the freeze SHA must be a full 40-hex commit id"
[ ! -e "$2" ] || die "$2 exists; the recipe runs only in a fresh directory"
for tool in git-filter-repo gitleaks trufflehog; do
  [ -x "$tools_bin/$tool" ] || die "missing $tools_bin/$tool"
done
command -v bun >/dev/null || die "bun is not on PATH"
export PATH="$tools_bin:$PATH"

mkdir -p "$2/report" "$2/freeze"
work=$(cd "$2" && pwd)
repo=$work/unleashed
report=$work/report
{
  echo "freeze: $sha"
  echo "remote: $remote"
  git filter-repo --version | sed 's/^/git-filter-repo: /'
  gitleaks version | sed 's/^/gitleaks: /'
  trufflehog --version 2>&1 | tail -1
} >"$report/inputs.txt"

git clone --quiet --single-branch --branch dev --no-tags "$remote" "$repo"
git -C "$repo" cat-file -e "$sha^{commit}" || die "$sha is not in $remote dev"
git -C "$repo" merge-base --is-ancestor "$sha" origin/dev || die "$sha is not an ancestor of dev"
git -C "$repo" reset --quiet --hard "$sha"
[ "$(git -C "$repo" rev-parse HEAD)" = "$sha" ] || die "HEAD did not land on $sha"
# Filtering dev's tip would replay the removal as a final commit that deletes the whole tree.
git -C "$repo" cat-file -e "HEAD:apps/tools/package.json" 2>/dev/null ||
  die "apps/tools/package.json is absent at $sha: not a pre-removal commit"
# One ref in, one ref out: the remote-tracking ref would carry the post-freeze removal along.
git -C "$repo" remote remove origin

git -C "$repo" archive "$sha" | tar -x -C "$work/freeze"
git -C "$repo" ls-tree -r --full-tree HEAD >"$report/tree-before.txt"
git -C "$repo" -c diff.renameLimit=100000 log --format= --name-status -M --diff-filter=R HEAD >"$report/renames.txt"
git -C "$repo" log --format= --name-only HEAD | sort -u >"$report/touched.txt"
python3 "$here/check-paths.py" ancestry "$here/paths.txt" "$report/renames.txt" "$report/touched.txt"

git -C "$repo" filter-repo --analyze --force
cp -R "$repo/.git/filter-repo/analysis" "$report/analysis"

# Bare #N in a message would autolink to unleashed's own issues and PRs.
callback='return re.sub(rb"(?<![\w/#&])#(\d+)\b", rb"alejoamiras/nulo#\1", message)'
# --force only because the reset above left a reflog entry in the clone this script just made.
git -C "$repo" filter-repo --force --quiet \
  --paths-from-file "$here/paths.txt" \
  --replace-text "$here/replace-text.txt" \
  --replace-message "$here/replace-text.txt" \
  --message-callback "$callback"
cp "$repo/.git/filter-repo/commit-map" "$repo/.git/filter-repo/ref-map" "$report/"

git -C "$repo" branch -m main
git -C "$repo" ls-tree -r --full-tree HEAD >"$report/tree-after.txt"
python3 "$here/check-paths.py" tree "$here/paths.txt" "$report/tree-before.txt" "$report/tree-after.txt" "$work/freeze"
[ "$(git -C "$repo" for-each-ref --format='%(refname)')" = "refs/heads/main" ] || die "expected exactly one ref, refs/heads/main"

bun "$here/bootstrap/build.ts" "$work/freeze" "$repo"
git -C "$repo" add -A
printf 'chore: bootstrap the unleashed workspace\n\nRoot configuration copied from alejoamiras/nulo@%s by\nimplementations-plan/tools-extraction/tools/bootstrap/.\n' "$sha" >"$report/bootstrap-message.txt"
git -C "$repo" commit --quiet -F "$report/bootstrap-message.txt"

python3 "$here/audit.py" "$repo" "$report" "$here/audit-allowlist.txt"
echo "extract: done — $repo ($(git -C "$repo" rev-list --count HEAD) commits); report in $report"
