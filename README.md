# lantern

An execution checker for loss ledgers.

A loss ledger names a handful of unacceptable real-world outcomes — `L1`, `L2`,
`L8` — and, for each, says in prose which code and which tests stand in front
of it. The failure this tool exists to catch is not a missing test. It is this:

> The ledger claims a loss is covered by a test. The test exists. It is well
> written. It does not execute in the run that people quote as proof.

The case that prompted it: an erasure-completeness integration test sat behind
`describe.skipIf(!HAS_DB)` in a separate vitest project, so the default
`pnpm test` never ran it. The ledger read as covered, and a green `pnpm test`
got cited as the evidence.

So `lantern verify` asks one question of every claim:

**Did the check standing in front of this harm actually run, in the run you are
quoting?**

It is an execution checker, not an existence checker. A test that exists but
never ran is never reported as a pass.

## Install

```
npm install --save-dev lantern
```

Node 20 or newer. No runtime dependencies.

## Use

```
lantern verify <ledger.md> [--report <project>=<report.json>]... [--json]
```

```
lantern verify docs/LOSS-LEDGER.md \
  --report unit=reports/unit.json \
  --report integration=reports/integration.json
```

Reports are supplied on the command line and never in the ledger. The ledger
says what should guard a loss; the command line says what you actually ran.
Keeping them apart is the point.

Exit codes:

| code | meaning |
| --- | --- |
| 0 | every loss is `LIT` |
| 1 | some loss is `DARK-IN-PRACTICE` or `UNCLAIMED` |
| 2 | usage or parse error |

`--json` prints the whole result to stdout instead of the human table.

## Ledger format

Two fenced block types. Everything else in the file is prose lantern ignores.

### The config block — once, anywhere

````markdown
```lantern-config
repo: ../../customerflow/app
```
````

`repo` is the git repository root that every file, symbol and commit citation
resolves against, **relative to the ledger file's own location** (not the
working directory).

This is load-bearing. Real code often lives in a git repository nested inside
another one, and a checker pointed at the outer repository false-negatives
every commit citation in the inner one. lantern uses exactly the path you give
it, runs all git commands as `git -C <repo>`, and tells you in its notes when
the path you gave is not itself the top level of a repository.

### A claim block — once per light, right after its prose

````markdown
```lantern
loss: L8
covers:
  - test: test/unit/refund-guards.test.ts
    project: unit
  - file: lib/refund-guards.ts
  - symbol: applyRefund
    file: lib/order-router.ts
  - commit: 7c3a1e9
```
````

Four claim kinds. All paths are relative to `repo`.

- **`test:`** a test file, plus a required **`project:`** naming which suite it
  belongs to. `project` is what `--report <project>=...` keys off. This is the
  kind that carries the tool's weight; the other three are supporting evidence.
- **`file:`** a source file that must exist.
- **`symbol:`** an identifier that must appear in the named **`file:`**.
- **`commit:`** a SHA, possibly abbreviated, that must resolve **and** be an
  ancestor of `HEAD`.

Unrecognised keys are an error, with the ledger file and line number. That is
deliberate: a typo'd `projet:` that got silently dropped would turn a claim
into nothing at all, which is the same class of failure the whole tool exists
to prevent.

### The loss list

lantern looks for a heading whose text contains "loss list" and collects
`L<number>` identifiers appearing in bolded or table-leading position until the
next heading at the same or a higher level. Tables, bullet lists and plain
lines all work:

```markdown
## Loss list

| ID | Unacceptable outcome |
| --- | --- |
| **L1** | We ask a customer for money during a promised cooldown. |
```

An `L9` mentioned mid-sentence is prose and is ignored. If there is no
loss-list section at all, lantern says so and exits 2 rather than reporting
zero losses.

## Verdicts

Per claim:

| verdict | meaning |
| --- | --- |
| `LIT` | resolved, and for tests, present in a supplied report with every case passing |
| `SKIPPED` | the file is in a report, but some or all cases are `skipped` or `todo`. Reports how many of how many |
| `FAILED` | in a report, with a failing case |
| `NOT-RUN` | a report **was** supplied for this project, but this file is not in it. Usually filtered out by the runner's include globs, or gated so it never collected |
| `NO-REPORT` | **no report was supplied for this claim's project at all** |
| `UNRESOLVED` | the file, symbol or commit is not in the repo |

`NO-REPORT` is the signature verdict and it is not a pass. It means: you are
claiming this light burns, and you have handed over nothing showing it ever
ran. A ledger verified with no reports at all is entirely `NO-REPORT`, and
exits 1.

Per loss: `LIT` only when **every** claim is `LIT`. Otherwise
`DARK-IN-PRACTICE`, headlined by the weakest claim's reason. Severity runs
`UNRESOLVED` → `FAILED` → `NO-REPORT` → `NOT-RUN` → `SKIPPED` → `LIT`, and the
output is ordered worst first.

A loss in the list with no claim block at all is `UNCLAIMED`, reported at the
end. That is a real finding, not a parse gap.

## Report formats

Auto-detected by shape, not by filename.

- **Vitest JSON reporter** — `numTotalTests` / `testResults[]`, each with a
  `name` path and `assertionResults[]` carrying `passed` / `failed` /
  `skipped` / `todo`.
- **Playwright JSON reporter** — nested `suites`, specs with `ok`, tests with
  `status` / `expectedStatus`.

Generate them with `vitest run --reporter=json --outputFile=unit.json` and
`playwright test --reporter=json > e2e.json`.

Claim paths are repo-relative and report paths are usually absolute and from
some other machine, so they are matched by resolving against the repo root and
then comparing whole path segments from the right. Never a bare substring:
`test/unit/erasure.test.ts` must not match
`test/integration/erasure.test.ts`. `test/paths.test.ts` exists specifically to
hold that line.

## Limits, stated rather than dressed up

- **`symbol:` is a text search, not AST analysis.** lantern checks that the
  identifier appears in the file on a word boundary. It will match an
  identifier inside a comment or a string literal, and it cannot tell an export
  from a local variable. Honest for v1; do not read more into a `LIT` symbol
  claim than that.
- **A report is taken at its word.** lantern cannot tell whether the JSON you
  handed it came from the run you are talking about, or from a lucky run last
  Tuesday. Generate reports in the same command as the claim you are making.
- **`flaky` counts as failed.** Playwright's `flaky` outcome means the test
  passed only on retry. A guard that holds only on retry is not a light that
  burns, so lantern calls it `FAILED`. This is a judgement call, not something
  the format dictates.
- **An unknown case status counts as failed**, never as a pass.
- **Only the four claim kinds above exist.** There is no way to say "this is
  covered by a manual procedure" or "by a monitor". If the light is not a test,
  a file, a symbol or a commit, lantern cannot see it.

## Development

```
npm install
npm run build      # tsc to dist/, no bundler
npm test           # vitest
npm run typecheck
```

Zero runtime dependencies. `vitest` and `typescript` are dev-only.

The verdict logic in `src/verdict.ts` is a pure function taking parsed claims
plus parsed reports and returning verdicts, with no I/O of any kind. All of it
is unit-testable with no repository and no report file on disk, and
`test/verdict.test.ts` exercises it that way.

Source layout:

| file | job |
| --- | --- |
| `src/yaml.ts` | the hand-rolled YAML subset, and its rejections |
| `src/parse-ledger.ts` | fences, config, claim blocks, the loss list |
| `src/reports.ts` | vitest and playwright JSON, flattened to one shape |
| `src/paths.ts` | repo-relative claim path vs absolute report path |
| `src/resolve.ts` | file, symbol and commit checks against the repo (the I/O) |
| `src/verdict.ts` | the pure core |
| `src/render.ts` | plain-text output |
| `src/verify.ts` | argument parsing and wiring |
| `src/cli.ts` | the bin |

## Licence

MIT, FlossyPurse Studios.
