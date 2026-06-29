#!/usr/bin/env bash
set -euo pipefail

CODER_MODEL="${OLLAMA_CODER_MODEL:-qwen2.5-coder:7b}"
GENERAL_MODEL="${OLLAMA_GENERAL_MODEL:-qwen3.5:9b}"
CLASSIFIER_MODEL="${OLLAMA_MODEL_CLASSIFIER:-qwen3:1.7b}"
OLLAMA_ENDPOINT="${OLLAMA_HOST:-http://127.0.0.1:11434}"
CONFIRM_WORD="PULL"

cat <<'BANNER'
Prism Spectra local AI bootstrap

This command checks Ollama and offers to pull the local models Spectra will use.
It does not read API keys, create tokens, call cloud APIs, scan folders, or start watchers.
BANNER

printf '\nOllama endpoint:  %s\n' "$OLLAMA_ENDPOINT"
printf 'Coder model:      %s\n' "$CODER_MODEL"
printf 'General model:    %s\n' "$GENERAL_MODEL"
printf 'Classifier model: %s\n\n' "$CLASSIFIER_MODEL"

if ! command -v ollama >/dev/null 2>&1; then
  cat <<'EOF'
Ollama CLI was not found.
Install Ollama from https://ollama.com/download, then re-run this command.
EOF
  exit 1
fi

if ! ollama list >/dev/null 2>&1; then
  cat <<'EOF'
Ollama is installed, but the local daemon is not reachable.
Start Ollama first, then re-run this command.
EOF
  exit 1
fi

if [[ "$GENERAL_MODEL" == "qwen3:9b" ]]; then
  cat <<'EOF'
The qwen3:9b tag does not exist in the Ollama Qwen3 family.
Use qwen3.5:9b for the recommended general/planner/reasoner model, or set an explicit verified override.

No model download was attempted.
EOF
  exit 1
fi

models=()
for model in "$CODER_MODEL" "$GENERAL_MODEL" "$CLASSIFIER_MODEL"; do
  if [[ ! " ${models[*]} " =~ " ${model} " ]]; then
    models+=("$model")
  fi
done

model_size_hint() {
  case "$1" in
    qwen2.5-coder:7b) printf 'roughly 4.7GB' ;;
    qwen3.5:9b) printf 'roughly 6.6GB' ;;
    qwen3:1.7b) printf 'roughly 1.4GB' ;;
    qwen3:8b) printf 'roughly 5.2GB' ;;
    *) printf 'size unknown; check Ollama before pulling' ;;
  esac
}

missing=()
for model in "${models[@]}"; do
  if ollama show "$model" >/dev/null 2>&1; then
    printf 'Already available: %s\n' "$model"
  else
    missing+=("$model")
    printf 'Will need pull: %s (%s)\n' "$model" "$(model_size_hint "$model")"
  fi
done

if [[ ${#missing[@]} -eq 0 ]]; then
  printf '\nAll selected models are already available locally.\n'
  ollama ls
  exit 0
fi

cat <<EOF

This will run ollama pull for the missing model(s) listed above.
Type ${CONFIRM_WORD} to continue. Anything else cancels.
EOF

read -r confirmation
if [[ "$confirmation" != "$CONFIRM_WORD" ]]; then
  printf 'Cancelled. No model download was attempted.\n'
  exit 0
fi

for model in "${missing[@]}"; do
  printf '\nPulling %s...\n' "$model"
  ollama pull "$model"
done

printf '\nLocal Ollama models after bootstrap:\n'
ollama ls
