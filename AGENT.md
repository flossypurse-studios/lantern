# AGENT.md — lantern

Orientation for AI agents working on this repo. lantern is a CLI that
verifies loss-ledger coverage claims against real test reports: it reads a
ledger's `lantern-config`/`lantern` blocks, reads the vitest/Playwright JSON
reports you point it at, and reports whether each claimed check actually
ran and passed — not just whether the referenced file exists.

## Architecture

`src/` is split by concern, not by command:

- **ledger parsing** — extracts `lantern-config` and `lantern` fenced
  blocks from a markdown file into structured losses and claims.
- **report parsing** — normalizes vitest JSON reporter output and
  Playwright JSON reporter output into one internal shape (test path,
  project, status).
- **repo resolution** — resolves `file:`, `symbol:`, and `commit:` claims
  against the repo path from `lantern-config`. This is the only layer that
  touches the filesystem or shells out to git.
- **verdict logic** — pure. See the hard rule below.
- **rendering** — turns verdicts into the human-readable table and the
  `--json` output.
- **CLI** — argument parsing, wiring the above together, exit codes.

`test/` uses synthetic fixtures only — invented ledgers, invented repos,
invented report JSON. See the rule below on why.

## Hard rule: verdict logic is pure

The function that turns parsed claims plus parsed reports into verdicts
(`LIT` / `SKIPPED` / `FAILED` / `NOT-RUN` / `NO-REPORT` / `UNRESOLVED`, and
loss-level `LIT` / `DARK-IN-PRACTICE` / `UNCLAIMED`) takes only data
already parsed — no file reads, no git calls, no network. This is what
lets the whole verdict contract be tested with in-memory fixtures, with no
repo checkout and no real report file anywhere. If you find yourself
wanting to pass a file path or a repo dir into this layer, resolve it one
layer up instead.

## Hard rule: no real ledger content

Every fixture in `test/` — ledgers, repo trees, report JSON — is invented.
No real ledger, loss description, file path, or commit hash from any
private project ever enters this package, in code, tests, comments, or
commit messages. lantern is meant to ship as a public npm package; the
ledgers it reads never are. If a bug report or example arrives with real
ledger content attached, invent an equivalent fixture instead of copying it
in.

## Routing (for delegating work on this repo)

- **haiku** — mechanical sweeps: renaming, formatting, dependency bumps,
  moving fixtures around.
- **sonnet** — default for this repo: implementing a specified command,
  writing tests against a stated spec, fixing a described bug.
- **opus** — anything that changes the verdict contract itself (new
  verdict states, changed precedence rules for loss-level status, changed
  claim kinds). That surface is the whole point of the tool; get a deeper
  pass on it.

## Not built yet

Three commands are designed but deliberately unimplemented. They're
deferred until `verify` — the core execution-vs-existence check — has
earned its place; adding more surface before that would dilute the one
thing this tool needs to get right first.

- **`sweep`** — inventory a repo's write sites, shape boundaries, and
  duplicate concepts, as a starting point for drafting a ledger.
- **`lint`** — structural checks on a ledger itself: identifiers are
  append-only against git history (an `L3` never gets renumbered or
  reused), entry count stays in the 5-9 range, change-log entries are
  complete.
- **`drift`** — how far the tree has moved since a ledger's last dated
  sweep, as a signal that it may need re-review.

Do not start implementing these without checking in first — they may be
re-scoped once real usage of `verify` shows what's actually needed.

## Deliberately rejected — do not build these

Two directions were considered and turned down on the merits. Both are the
obvious first idea, so they will come up again.

**An interview / wizard that asks what must never go wrong and drafts a
ledger for you.** Rejected because naming and ranking losses is a judgement
about a specific product and its users. A fixed questionnaire cannot follow
a thread — it cannot hear "the account-drain one worries me most" and
re-rank. An agent reading the written protocol does that job better than
any form will, so the judgement stays in prose and the mechanism stays
here.

**A generator that emits a ledger from a spec.** Rejected because it makes
the artifact cheap to produce and expensive to trust. The failure mode of
these artifacts has never been that they are laborious to write; it is that
they go quietly false and then get cited. A generator without a verifier
produces more ledgers and less truth.

The tested-and-mostly-false hypothesis, recorded so nobody rebuilds around
it: *"ledgers cite code that doesn't exist."* A hand resolution of all 88
citations in the first real ledger found 83 resolve cleanly, 4 ambiguous,
1 stale. Existence is not the problem. Execution is.
