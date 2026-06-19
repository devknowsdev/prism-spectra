# Reference Architecture: Local AI Orchestration System

## Core Principle

Everything runs locally unless explicitly delegated.

## Components

- Orchestrator (event loop)
- Tool Router
- Local Tools (file/audio/code)
- Online Tools (optional LLM/API)
- Lightweight Memory (SQLite/JSONL)

## Audio Layer
- Ableton integration
- MIDI handling
- RC-600 support

## Coding Layer
- repo editing tools
- script execution

## Constraints
- M1 optimized
- low memory footprint
- minimal background processes
