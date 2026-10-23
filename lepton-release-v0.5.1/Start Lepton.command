#!/bin/bash
# Double-click to start Lepton; your browser opens when it is ready.
# If macOS will not open this file: right-click it and choose Open (once), or run this in Terminal from the Lepton folder:
#   chmod +x "Start Lepton.command"
cd "$(dirname "$0")" || exit 1
# Find Node.js even when the Terminal window that opens here has a minimal PATH (installer, Homebrew, nvm, Volta).
for d in /usr/local/bin /opt/homebrew/bin "$HOME/.volta/bin" "$HOME"/.nvm/versions/node/*/bin; do [ -x "$d/node" ] && PATH="$d:$PATH"; done
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed. Get the LTS version from https://nodejs.org, then double-click this file again."
  echo
  read -r -p "  Press Return to close. "
  exit 1
fi
export LEPTON_OPEN=1
node server.js
status=$?
if [ $status -ne 0 ]; then echo; read -r -p "  Lepton stopped with an error (see above). Press Return to close. "; fi
