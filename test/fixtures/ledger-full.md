# Ironwood Trust — loss ledger

Synthetic ledger invented for lantern's own tests. Every name, path and
identifier below is made up.

```lantern-config
repo: ./repo
```

## Loss list

| ID | Unacceptable outcome |
| --- | --- |
| **L1** | We ask a customer for money during a cooldown they were promised. |
| **L2** | An erasure request completes while rows for the subject survive. |
| **L3** | Records outlive the retention horizon we published. |
| **L4** | We contact a customer inside a holdback window. |
| **L5** | Consent captured for one purpose is reused for another. |
| **L6** | A recommendation is shown that the underlying model never produced. |
| **L7** | A customer receives a receipt for a payment that did not settle. |

## Lights currently burning

**L1** — The ask cooldown is enforced in one place and unit-tested against the
boundary day in both directions.

```lantern
loss: L1
covers:
  - test: test/unit/refund-guards.test.ts
    project: unit
  - file: lib/refund-guards.ts
```

**L2** — Erasure completeness is checked by an integration test that reads back
every table in the manifest after the erase.

```lantern
# The gated one. This test needs a database, so it lives in a separate
# project and does not run under the default command.
loss: L2
covers:
  - test: test/integration/erasure-completeness.test.ts
    project: integration
  - symbol: verifyErasure
    file: lib/erasure.ts
```

**L3** — Retention is swept nightly and the sweep asserts its own read-back.

```lantern
loss: L3
covers:
  - test: test/unit/retention.test.ts
    project: unit
```

**L4** — Holdback windows are evaluated before any outbound send.

```lantern
loss: L4
covers:
  - test: test/unit/holdback.test.ts
    project: unit
```

**L5** — Consent scope is carried on the record and re-checked at use.

```lantern
loss: L5
covers:
  - test: test/unit/quota-scope.test.ts
    project: unit
```

**L6** — Recommendations come from the executor and nowhere else.

```lantern
loss: L6
covers:
  - symbol: applyRefund
    file: lib/order-router.ts
  - file: lib/no-such-file.ts
  - commit: 0000000
```

**L7** — Receipt sending is covered end to end.

The prose says so. There is no claim block underneath it, which is the whole
point of this entry.
