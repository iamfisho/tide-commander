# Fork patches

This fork (`iamfisho/tide-commander`) tracks `deivid11/tide-commander`.

## Branch model

| Branch | Purpose |
|---|---|
| `master` | Exact mirror of upstream `master`. Never commit here. |
| `julio` | Upstream `master` plus the patches listed below. Rebased on every upstream release. |
| topic branches | One per patch. Each one is, or becomes, an upstream PR. |
| `backup/master-pre-realign-20261118` | Old fork `master` from before the realignment. Kept for reference and rollback. |

Divergence budget: keep this list short (5 patches or fewer). A patch that
upstream merges is dropped by the rebase, so remove its row when that happens.

## Patches carried in `julio`

| Patch | Topic branch | Upstream PR | Status |
|---|---|---|---|
| Claude Haiku 5.5 [1M] in the model registry; `haiku` becomes a legacy alias hidden from the pickers | `feat/claude-haiku-5-5-model` | [#19](https://github.com/deivid11/tide-commander/pull/19) | Open, rebased onto v1.225.0 |

## Not carried

- **Dev API URL for LAN devices** (`0849a5c8`, kept on `backup/master-pre-realign-20261118`; upstream PR #6, closed). It only changes the Vite dev server (`import.meta.env.DEV`) and has no effect on release builds.
- **Session-not-found recovery** (upstream PR #20). Superseded by upstream's own fix of 2026-10-28.

## Syncing with upstream

`origin` is upstream and `iamfisho` is this fork.

```bash
git fetch origin
git push iamfisho origin/master:refs/heads/master   # keep the mirror exact
git switch julio && git rebase origin/master        # enable `git rerere` for repeat conflicts

# CI parity: the same steps as upstream's quality workflow
npm ci && npm run lint:types && npm run lint && npm run test:ci && npm run build

git push iamfisho julio --force-with-lease
```
