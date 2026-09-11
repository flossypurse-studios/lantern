# Ironwood Trust — loss ledger (signature case)

Synthetic ledger invented for lantern's own tests.

This one exists to demonstrate the verdict lantern was written for. Both
entries below read, in prose, as covered. One of them is covered by a test in a
project nobody runs.

```lantern-config
repo: ./repo
```

## Loss list

- **L1** — We ask a customer for money during a cooldown they were promised.
- **L8** — An erasure request completes while rows for the subject survive.

## Lights currently burning

**L1** — The ask cooldown is enforced in one place and unit-tested against the
boundary day in both directions.

```lantern
loss: L1
covers:
  - test: test/unit/refund-guards.test.ts
    project: unit
```

**L8** — Erasure completeness is checked by an integration test that reads back
every table in the manifest after the erase. The test is real, it is well
written, and a green run of the default test command says nothing about it.

```lantern
loss: L8
covers:
  - test: test/integration/erasure-completeness.test.ts
    project: integration
```
