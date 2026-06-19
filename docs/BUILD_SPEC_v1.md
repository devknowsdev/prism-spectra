# AI-Forge Build Specification v1.0

## Core Architecture

Execution Engine -> Task Classifier -> Router -> Planner (optional) -> Scheduler -> Executor -> Memory

## Core Task Types

- audio.analysis
- audio.transcription
- audio.semantic
- code
- planning
- reasoning
- retrieval
- tooling

## Critical Path

RF-001 Ollama Client
RF-002 Model Registry
RT-001 Task Types
RT-002 Task Classifier
RT-004 Router
EX-001 Executor
EX-003 Scheduler
MEM-001 Ledger
