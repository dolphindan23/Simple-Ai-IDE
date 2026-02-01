#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE=".simpleaide/server.pid"
LOG_FILE=".simpleaide/server.log"

mkdir -p .simpleaide

if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "SimpleAide is already running (PID: $OLD_PID)"
        echo "Use ./stop_all.sh to stop it first"
        exit 1
    else
        rm -f "$PID_FILE"
    fi
fi

if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    if ! npm install; then
        echo "Error: npm install failed"
        exit 1
    fi
fi

echo "Starting SimpleAide..."

nohup npm run dev > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

echo $SERVER_PID > "$PID_FILE"

sleep 2

if kill -0 "$SERVER_PID" 2>/dev/null; then
    PORT="${PORT:-5000}"
    echo "SimpleAide started successfully (PID: $SERVER_PID)"
    echo "Server running at http://localhost:$PORT"
    echo "Logs: $LOG_FILE"
else
    echo "Failed to start SimpleAide. Check $LOG_FILE for errors."
    rm -f "$PID_FILE"
    exit 1
fi
