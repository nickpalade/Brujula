#!/usr/bin/env bash
# Brujula bootstrap (macOS / Linux). Installs Ollama, pulls the model, starts
# and verifies the server. Needs internet ONCE (install + model pull); after
# that everything runs offline.
#
# Run:  bash bootstrap.sh
set -u

# ── TWEAK: model + endpoint ─────────────────────────────────────────────
MODEL="gemma3:4b"
OLLAMA_URL="http://localhost:11434"

server_up() {
    curl -s --max-time 3 "$OLLAMA_URL/api/version" > /dev/null 2>&1
}

echo "[1/4] Checking Ollama installation..."
if ! command -v ollama > /dev/null 2>&1; then
    OS="$(uname -s)"
    case "$OS" in
        Darwin)
            if command -v brew > /dev/null 2>&1; then
                echo "  Ollama not found. Installing via Homebrew..."
                brew install ollama || { echo "FAILURE: brew install ollama failed."; exit 1; }
            else
                echo "FAILURE: Ollama is not installed. Install it, then re-run:"
                echo "    brew install ollama"
                echo "    (or download from https://ollama.com/download/mac)"
                exit 1
            fi
            ;;
        Linux)
            echo "  Ollama not found. Installing via the official script..."
            curl -fsSL https://ollama.com/install.sh | sh \
                || { echo "FAILURE: official install script failed."; exit 1; }
            ;;
        *)
            echo "FAILURE: unsupported OS '$OS'. On Windows use bootstrap.ps1."
            exit 1
            ;;
    esac
fi
echo "  Found: $(command -v ollama)"

echo "[2/4] Checking Ollama server on $OLLAMA_URL ..."
if ! server_up; then
    echo "  Not running. Starting 'ollama serve' in the background..."
    nohup ollama serve > /dev/null 2>&1 &
    up=0
    for _ in $(seq 1 30); do
        sleep 1
        if server_up; then up=1; break; fi
    done
    if [ "$up" -ne 1 ]; then
        echo "FAILURE: Ollama server did not respond on $OLLAMA_URL after 30s."
        exit 1
    fi
fi
echo "  Server responding."

echo "[3/4] Checking model '$MODEL' ..."
if curl -s "$OLLAMA_URL/api/tags" | grep -q "\"$MODEL\""; then
    echo "  Already pulled."
else
    echo "  Not present. Pulling (several GB, needs internet, one time only)..."
    ollama pull "$MODEL" || { echo "FAILURE: 'ollama pull $MODEL' failed."; exit 1; }
fi

echo "[4/4] Final verification..."
if server_up && curl -s "$OLLAMA_URL/api/tags" | grep -q "\"$MODEL\""; then
    echo ""
    echo "SUCCESS: Ollama running on $OLLAMA_URL with model $MODEL. Fully offline from here."
    echo "Next:  npm install && npm start"
    exit 0
else
    echo ""
    echo "FAILURE: server or model check failed."
    exit 1
fi
