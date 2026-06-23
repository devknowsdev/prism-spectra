# Adapter Contracts

Last-Updated: 2026-06-23

This document describes the adapter scaffold now available under `src/adapters/`.
It is a documentation and test-oriented contract layer, not a production
integration layer.

## Purpose

Adapters are the boundary objects used by prism-spectra to model capability
execution. They help the engine distinguish between:

- local-only operations
- local writes
- external drafts
- external writes
- destructive operations

The scaffold is intentionally conservative:

- no real external APIs are wired
- no publishing or email delivery happens
- no hidden approvals are assumed
- no dependency additions are required

## Core contract shape

An adapter contract carries:

- identity and kind
- execution mode
- approval posture
- declared capabilities
- optional health reporting
- a single `execute()` surface

The shared types live in `src/adapters/types.ts`.

## Approval model

Approval is a first-class part of the contract.

- read-only actions may run without approval
- local writes may be recommended for approval
- external drafts are treated as lower-risk external actions
- external writes and destructive actions require explicit approval

Unknown or ambiguous high-risk behavior is blocked by default.

## Registry model

The registry in `src/adapters/registry.ts` is a lightweight in-memory
registration surface for:

- registering adapters
- listing adapters
- filtering by kind
- checking adapter health

It is meant to support orchestration, tests, and future wiring work.

## Mock adapters

The current mock implementations are intentionally deterministic:

- `createMockLocalModelAdapter()` for local model echoes
- `createMockFilesystemAdapter()` for in-memory file reads and writes
- `createMockGitAdapter()` for commit and push simulation
- `createMockExternalPublishingAdapter()` for draft/publish simulation

These mocks are useful for:

- contract tests
- orchestration prototypes
- approval gating checks
- documentation examples

## Stable decisions

These decisions are now treated as the current architectural stance:

- adapters are capability-first
- approval checks happen before execution
- high-risk behavior is not implicit
- mock adapters are acceptable for local validation
- the registry is intentionally simple and in-memory

## Deferred decisions

The following are intentionally left for later phases:

- persistent adapter registration
- real provider implementations
- adapter-specific persistence schemas
- UI for adapter configuration
- external publishing integrations

## Related files

- [src/adapters/types.ts](../src/adapters/types.ts)
- [src/adapters/approvalGuard.ts](../src/adapters/approvalGuard.ts)
- [src/adapters/registry.ts](../src/adapters/registry.ts)
- [src/adapters/index.ts](../src/adapters/index.ts)
