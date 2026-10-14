# Deployments

`<network>.json` files are written by `scripts/deploy.ts` and updated by `scripts/verify.ts`.
They contain public data only (addresses, block, tx hash, commit) and are committed to the repository:
the backend reads `address` and `deployBlock` from here.
