# AI-Forge Handover Document

## Current State Summary

The system has undergone an exploratory architectural expansion that significantly diverged from the original intent.

We now have two competing interpretations:

### 1. Original Vision (Target State)
A local-first AI orchestration system for:
- coding workflows
- file automation
- audio processing (Ableton / MIDI / RC-600)
- reasoning and tool usage
- optional online LLM integration

Optimized for:
- M1 Mac performance
- low CPU + low token usage
- simple runtime model
- developer productivity

---

### 2. Drifted State (Current Exploration Output)
A distributed systems architecture including:
- ledger-based execution truth
- consensus layers
- Kubernetes + Terraform deployment
- Kafka event streaming
- multi-region orchestration
- formal verification models

This is significantly over-scoped for the intended environment.

---

## Key Insight

The system evolved from:

> "local AI orchestration tool"

into:

> "hyperscaler distributed execution platform"

---

## Decision

We retain:
- execution routing abstraction
- tool modularization
- event-based thinking
- separation of compute vs persistence

We discard:
- distributed consensus layers
- Kubernetes orchestration
- ledger-based global truth model
- multi-region assumptions
