---
name: update-docs
description: Updates CLAUDE.md based on recent project changes. Use when user says "update docs", "add to CLAUDE.md", "document this", or runs /update-docs command.
---

# Update CLAUDE.md

Maintains project documentation by analyzing git history and syncing CLAUDE.md with code changes.

## Quick Start

1. `git log -1 --format="%H" -- CLAUDE.md` → find baseline
2. `git diff <hash>..HEAD --name-only` → list changed files
3. Read CLAUDE.md → identify sections → map changes → propose → apply → check `dev`

## Workflow

### Phase 1: Discover Changes

```bash
# Find last CLAUDE.md commit
git log -1 --format="%H" -- CLAUDE.md

# Get all changes since then
git diff <last-claude-commit>..HEAD --name-only
git log <last-claude-commit>..HEAD --oneline
```

**If CLAUDE.md not in git** (new file or untracked):

Ask user: "CLAUDE.md isn't tracked in git. How long since it was last updated?"

Options:
- "1 week" → `git log --since="1 week ago" --oneline --name-only`
- "1 month" → `git log --since="1 month ago" --oneline --name-only`
- "Specific date" → `git log --since="YYYY-MM-DD" --oneline --name-only`

### Phase 2: Analyze CLAUDE.md Structure

**Read the actual CLAUDE.md first.** Extract:
- All `##` and `###` section headings
- What each section documents (modules, commands, config, etc.)
- File/directory patterns mentioned in each section

Build a dynamic mapping: `changed file → relevant section(s)`

Example discovery:
```
Sections found:
- "## Configuration" mentions: config.py, .env, environment variables
- "## Middleware System" mentions: middlewares.py, filters.py
- "## Project Structure" lists: all module files
→ If middlewares.py changed, update "Middleware System" + "Project Structure"
```

### Phase 3: Propose Updates

For each affected area:
1. **Existing sections needing updates** - list specific changes
2. **New sections to add** - describe what they'd cover

Present to engineer:
```
Changes detected since last CLAUDE.md update (<commit>):

**Files changed:**
• path/to/file.py - <brief description of change>
• path/to/new_module.py - NEW FILE

**Sections to UPDATE:**
• [Section Name] - reason
  └─ files: x.py, y.py

**Potential NEW sections:**
• [Proposed Title] - would document X
  └─ files: new_module.py

Which changes should I document?
```

Wait for engineer confirmation before proceeding.

### Phase 4: Apply Updates

After engineer approval:
1. Read affected sections from current CLAUDE.md
2. Apply changes matching existing style
3. Add new sections in appropriate locations

### Phase 5: Resolve conflicts with `dev` (after applying updates)

```bash
git diff dev -- CLAUDE.md
```

Run this after applying updates so it catches:
- Sections modified on `dev` that we also modified
- New sections added on `dev` we might overwrite

**If `dev` differs:**
1. `git show dev:CLAUDE.md` → fetch the `dev` version
2. Identify conflicting sections
3. Merge: keep additions from both, prefer more complete version
4. Show engineer the diff before finalizing

**Conflict strategy:**
- Only on `dev` → keep it
- Only in current → keep it
- Both modified → merge carefully, ask if unclear

## Quality Checks

Before finalizing:
- [ ] All identified changes documented
- [ ] No merge conflicts with `dev`
- [ ] Matches existing formatting style
- [ ] Cross-references still valid

## References

- [CLAUDE.md Memory Management](https://code.claude.com/docs/en/memory) ([md](https://code.claude.com/docs/en/memory.md)) - official docs on CLAUDE.md structure and best practices
- [All Claude Code Docs](https://code.claude.com/docs/llms.txt) - LLM-friendly documentation index
