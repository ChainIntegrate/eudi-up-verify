# Deployments

`<network>.json` files are written by `scripts/deploy.ts` and updated by `scripts/verify.ts`.
They contain public data only (addresses, block, tx hash, commit) and are committed to the repository:
the backend reads `address` and `deployBlock` from here.

A redeploy moves the previous deployment into `superseded`. The admin page lists those contracts and sets their
attester to zero ("Superseded contracts"), so that no earlier contract keeps a live attester (audit UCL-38).
