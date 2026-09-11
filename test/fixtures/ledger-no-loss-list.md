# Ironwood Trust — notes

Synthetic ledger invented for lantern's own tests. It has a config block and a
claim block but no loss-list section at all, so lantern must say so rather than
quietly reporting zero losses.

```lantern-config
repo: ./repo
```

## Lights currently burning

**L1** — The ask cooldown is enforced in one place.

```lantern
loss: L1
covers:
  - file: lib/refund-guards.ts
```
