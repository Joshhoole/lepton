#!/bin/bash
# Double-click to start Lepton and open it in your browser.
cd "$(dirname "$0")"
PORT_TO_OPEN=${LEPTON_PORT:-3141}
( sleep 1.5; open "http://localhost:$PORT_TO_OPEN" ) &
node server.js
