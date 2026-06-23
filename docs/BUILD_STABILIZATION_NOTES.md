# Build Stabilization Notes

Last-Updated: 2026-06-23

This note records why `npm run build` originally failed and how the build
boundary was stabilized without redesigning the repo or adding runtime
features.

## Initial build failure summary

The first `npm run build` pass failed in the older runtime / classifier cluster,
not in the new adapter scaffold.

Observed failure groups:

- NodeNext import-extension errors in `src/events/*`, `src/runtime/*`,
  `src/memory/ledgerStore.ts`, `src/memory/replay.ts`,
  `src/executors/localExecutor.ts`, `src/routing/taskClassifier.ts`, and
  `src/routing/types.ts`
- missing `zod` in `src/routing/taskClassifier.ts`
- type mismatches in `src/runtime/executionCoordinator.ts`

## Classification

| File / cluster | Error type | Repo evidence | Classification | Safest fix | Fixed this sprint |
| --- | --- | --- | --- | --- | --- |
| `src/events/*` | NodeNext import-extension errors | Not exported from `src/index.ts`; only referenced by the runtime cluster | Experimental/runtime code | Exclude from production build boundary | Yes, by build boundary |
| `src/runtime/executionCoordinator.ts` | NodeNext import-extension errors and typing mismatches | Not exported from `src/index.ts`; only appears in the runtime cluster docs and imports older runtime helpers | Experimental/runtime code | Exclude from production build boundary rather than rewrite the subsystem | Yes, by build boundary |
| `src/runtime/*` other files | NodeNext import-extension errors | Same runtime cluster as above; not part of exported public API | Experimental/runtime code | Exclude from production build boundary | Yes, by build boundary |
| `src/routing/taskClassifier.ts` | Missing `zod` plus NodeNext import-extension errors | `src/routing/router.ts` explicitly says this file is separate / not on the active router path; no active export from `src/index.ts` | Future-integration code | Exclude from production build boundary instead of adding `zod` | Yes, by build boundary |
| `src/routing/types.ts` | NodeNext import-extension errors | Only used by the classifier-side routing path | Future-integration code | Exclude with the classifier cluster | Yes, by build boundary |
| `src/executors/localExecutor.ts` | NodeNext import-extension errors | Only used by the runtime cluster; not part of the active `ExecutionEngine` path | Future-integration code | Exclude with the runtime cluster | Yes, by build boundary |
| `src/providers/ollamaClient.ts` | NodeNext import-extension errors | Only used by the classifier / localExecutor cluster | Future-integration code | Exclude with the runtime cluster | Yes, by build boundary |
| `src/config/modelRegistry.ts` | NodeNext import-extension errors | Only used by the classifier / localExecutor cluster | Future-integration code | Exclude with the runtime cluster | Yes, by build boundary |
| `src/memory/ledgerStore.ts` | NodeNext import-extension errors | Only used by `runtime/executionCoordinator.ts`; active engine uses `memory/ledger.ts` instead | Future-integration code | Exclude with the runtime cluster | Yes, by build boundary |
| `src/memory/replay.ts` | NodeNext import-extension errors | Only used by the excluded runtime cluster | Future-integration code | Exclude with the runtime cluster | Yes, by build boundary |

## Build boundary decision

The smallest safe fix was to keep the active production surface in the build
and fence off the experimental / future-integration cluster behind an explicit
build tsconfig.

Current production build input:

- active engine and orchestration files
- adapter scaffold and its exports
- test harness remains separate

Excluded from the production build:

- `src/events/**`
- `src/runtime/**`
- `src/executors/localExecutor.ts`
- `src/routing/taskClassifier.ts`
- `src/routing/types.ts`
- `src/providers/ollamaClient.ts`
- `src/config/modelRegistry.ts`
- `src/memory/ledgerStore.ts`
- `src/memory/replay.ts`

## Outcome

- the adapter scaffold remains exported and tested
- the production build no longer tries to compile the experimental cluster
- no dependencies were added
- no runtime features were added
- no legacy files were deleted

## Notes for later

If the runtime/classifier cluster becomes active again, it should be restored
deliberately and normalized on its own terms, instead of being silently folded
into the current production build.
