"""Pre-push audit of the extracted history: secrets, absolute paths, added filenames, identities.

Usage: audit.py <repo> <report-dir> <allowlist>

Scans every reachable blob and every commit message of <repo>. Scanner output is read from a pipe
and a finding is keyed by the SHA-256 of its secret, so no candidate secret is ever written to disk;
the report shows each untriaged finding's source line with the value masked.
Exits 1 on any untriaged finding (absolute paths included) or on a scanner error; the report says why.
"""

import collections
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading

ABS_PATH = re.compile(rb"/Users/[A-Za-z]|/home/[A-Za-z]|/mnt/user-data/[A-Za-z]")
BARE_ISSUE_REF = re.compile(rb"(?<![\w/#&])#\d+\b")
SENSITIVE_NAME = re.compile(r"(^|/)\.env($|\.)|\.pem$|keystore|key", re.IGNORECASE)


def git(repo, *args, data=None):
    return subprocess.run(["git", "-C", repo, *args], input=data, capture_output=True, check=True).stdout


def load_allowlist(path):
    keys = {}
    for line in open(path, encoding="utf-8"):
        entry = line.split("#", 1)[0].strip()
        if entry:
            keys[entry] = line.split("#", 1)[1].strip() if "#" in line else ""
    return keys


def reachable_blobs(repo):
    objects = git(repo, "rev-list", "--objects", "--all").decode().splitlines()
    first_path = {}
    for line in objects:
        oid, _, path = line.partition(" ")
        first_path.setdefault(oid, path)
    checks = git(repo, "cat-file", "--batch-check=%(objecttype) %(objectname)", data="\n".join(first_path).encode())
    blobs = [line.split()[1] for line in checks.decode().splitlines() if line.startswith("blob ")]
    return blobs, first_path


def blob_contents(repo, oids):
    proc = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def feed():
        proc.stdin.write(("\n".join(oids) + "\n").encode())
        proc.stdin.close()

    # Fed from a thread: writing every id before reading deadlocks once both pipe buffers fill.
    writer = threading.Thread(target=feed)
    writer.start()
    for _ in oids:
        header = proc.stdout.readline().split()
        size = int(header[2])
        data = proc.stdout.read(size)
        proc.stdout.read(1)
        yield header[0].decode(), data
    writer.join()
    if proc.wait() != 0:
        raise RuntimeError("git cat-file --batch failed")


def commit_messages(repo):
    raw = git(repo, "log", "--all", "--format=%H%x00%B%x01")
    for record in raw.split(b"\x01"):
        record = record.lstrip(b"\n")
        if record:
            sha, _, body = record.partition(b"\x00")
            yield sha.decode(), body


def secret_key(scanner, rule, path, secret):
    digest = hashlib.sha256(secret.encode()).hexdigest()[:16]
    return f"secret:{scanner}:{rule}:{path}:{digest}"


def run_gitleaks(target_args, source):
    proc = subprocess.run(
        ["gitleaks", *target_args, "--no-banner", "--exit-code", "0", "--report-format", "json", "--report-path", "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"gitleaks ({source}) exited {proc.returncode}: {proc.stderr.decode()[-500:]}")
    findings = json.loads(proc.stdout or b"[]")
    return [(f["RuleID"], f["File"], f.get("Commit", ""), f.get("StartLine", 0), f["Secret"]) for f in findings]


def run_trufflehog(target_args, source):
    proc = subprocess.run(
        ["trufflehog", *target_args, "--no-verification", "--json", "--no-update", "--fail-on-scan-errors"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"trufflehog ({source}) exited {proc.returncode}: {proc.stderr.decode()[-500:]}")
    out = []
    for line in proc.stdout.decode().splitlines():
        if not line.startswith("{"):
            continue
        result = json.loads(line)
        data = result.get("SourceMetadata", {}).get("Data", {})
        meta = data.get("Git") or data.get("Filesystem") or {}
        out.append((result["DetectorName"], meta.get("file", ""), meta.get("commit", ""), meta.get("line", 0), result.get("Raw", "")))
    return out


def masked_context(repo, commit, path, line, secret):
    """The finding's source line with the secret masked, so triage never needs the raw value."""
    if not commit or not line:
        return ""
    try:
        text = git(repo, "show", f"{commit}:{path}").decode("utf-8", "replace").split("\n")[line - 1]
    except (subprocess.CalledProcessError, IndexError):
        return ""
    mask = f"{secret[:4]}…[{len(secret)}]"
    text = text.replace(secret, mask).strip()
    at = max(text.find(mask), 0)
    return text[max(at - 90, 0) : at + len(mask) + 60]


def main():
    repo, report_dir, allowlist_path = sys.argv[1:4]
    allow = load_allowlist(allowlist_path)
    used = set()
    untriaged = []
    lines = []

    blobs, first_path = reachable_blobs(repo)
    abs_hits = set()
    for oid, data in blob_contents(repo, blobs):
        if ABS_PATH.search(data):
            abs_hits.add(f"abspath:{first_path[oid]}:{oid[:12]}")
    messages = list(commit_messages(repo))
    msg_abs = [sha for sha, body in messages if ABS_PATH.search(body)]
    msg_refs = [sha for sha, body in messages if BARE_ISSUE_REF.search(body)]
    lines += [f"- reachable blobs: {len(blobs)}; commits: {len(messages)}",
              f"- absolute paths: {len(abs_hits)} blob(s), {len(msg_abs)} message(s)",
              f"- bare issue references left in messages: {len(msg_refs)}"]
    for key in sorted(abs_hits):
        used.add(key) if key in allow else untriaged.append(key)
    lines += [f"  - message of {sha}" for sha in msg_abs + msg_refs]
    failed = bool(msg_abs or msg_refs)

    added = git(repo, "log", "--all", "--diff-filter=A", "--name-only", "--format=").decode().split("\n")
    for path in sorted({p for p in added if p and SENSITIVE_NAME.search(p)}):
        key = f"filename:{path}"
        used.add(key) if key in allow else untriaged.append(key)

    idents = git(repo, "log", "--all", "--format=%an <%ae>%n%cn <%ce>").decode().splitlines()
    for ident, count in sorted(collections.Counter(idents).items()):
        key = f"identity:{ident}"
        lines.append(f"- identity `{ident}` × {count}")
        used.add(key) if key in allow else untriaged.append(key)

    with tempfile.TemporaryDirectory() as msg_dir:
        for sha, body in messages:
            with open(os.path.join(msg_dir, sha), "wb") as fh:
                fh.write(body)
        scans = [
            ("gitleaks", run_gitleaks(["git", repo], "history")),
            ("gitleaks", run_gitleaks(["dir", msg_dir], "messages")),
            ("trufflehog", run_trufflehog(["git", f"file://{os.path.abspath(repo)}"], "history")),
            ("trufflehog", run_trufflehog(["filesystem", msg_dir], "messages")),
        ]
    context = {}
    for scanner, findings in scans:
        for rule, path, commit, line, secret in findings:
            path = os.path.basename(path) if path.startswith(tempfile.gettempdir()) else path
            key = secret_key(scanner, rule, path, secret)
            if key in allow:
                used.add(key)
                continue
            untriaged.append(key)
            context.setdefault(key, f"{commit[:10]} L{line}: {masked_context(repo, commit, path, line, secret)}")
        lines.append(f"- {scanner}: {len(findings)} raw finding(s)")

    stale = sorted(set(allow) - used)
    untriaged = sorted(set(untriaged))
    lines.append(f"- untriaged: {len(untriaged)}; allowlist entries unused: {len(stale)}")
    for key in untriaged:
        lines.append(f"  - UNTRIAGED {key}")
        if key in context:
            lines.append(f"    `{context[key]}`")
    lines += [f"  - unused {k}" for k in stale]
    failed = failed or bool(untriaged or stale)

    lines.insert(0, f"# History audit — {'FAIL' if failed else 'PASS'}\n")
    with open(os.path.join(report_dir, "audit.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
