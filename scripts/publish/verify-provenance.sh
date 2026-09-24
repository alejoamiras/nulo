#!/usr/bin/env bash
# Verifies the npm provenance of a published tarball:
#
#   scripts/publish/verify-provenance.sh <tarball> [<owner/repo> <workflow path>]
#
# The registry's SLSA bundle for the tarball's name@version must be signed through Sigstore by that
# workflow on refs/heads/dev or refs/heads/main (the certificate's identity, not the statement's own
# claims) and must name the tarball's exact sha512. Prints the attested source commit.
# Needs curl, jq and an authenticated gh.
set -euo pipefail

tgz=$1
repo=${2:-alejoamiras/nulo}
workflow=${3:-.github/workflows/publish-packages.yml}

manifest=$(tar -xOzf "$tgz" package/package.json)
name=$(jq -r .name <<< "$manifest")
version=$(jq -r .version <<< "$manifest")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
bundle="$scratch/bundle.jsonl" # gh reads a bundle file only by a .json or .jsonl name

# The registry may lag a fresh publish by a minute or two.
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "https://registry.npmjs.org/-/npm/v1/attestations/${name/\//%2f}@$version" \
    | jq -c '.attestations[] | select(.predicateType == "https://slsa.dev/provenance/v1") | .bundle' > "$bundle" || true
  [ -s "$bundle" ] && break
  [ "$attempt" = 10 ] && { echo "::error::$name@$version has no SLSA provenance on the registry" >&2; exit 1; }
  sleep 15
done

identity="^https://github\\.com/${repo//./\\.}/${workflow//./\\.}@refs/heads/(dev|main)\$"
gh attestation verify "$tgz" --bundle "$bundle" --digest-alg sha512 \
  --repo "$repo" \
  --cert-oidc-issuer https://token.actions.githubusercontent.com \
  --cert-identity-regex "$identity" \
  --predicate-type https://slsa.dev/provenance/v1 \
  --deny-self-hosted-runners \
  --format json --jq '.[0].verificationResult.statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit'
