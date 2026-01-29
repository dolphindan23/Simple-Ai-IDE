#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE=".simpleaide/server.pid"

stopped=0

kill_process_tree() {
    local pid=$1
    local children=$(pgrep -P "$pid" 2>/dev/null)
    for child in $children; do
        kill_process_tree "$child"
    done
    kill "$pid" 2>/dev/null
}

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Stopping SimpleAide (PID: $PID) and child processes..."
        
        kill_process_tree "$PID"
        
        for i in {1..10}; do
            if ! kill -0 "$PID" 2>/dev/null; then
                break
            fi
            sleep 0.5
        done
        
        if kill -0 "$PID" 2>/dev/null; then
            echo "Force killing process tree..."
            pkill -9 -P "$PID" 2>/dev/null
            kill -9 "$PID" 2>/dev/null
        fi
        
        stopped=1
    else
        echo "Process $PID not running (stale PID file)"
    fi
    rm -f "$PID_FILE"
else
    echo "No PID file found at $PID_FILE"
fi

if [ $stopped -eq 1 ]; then
    echo "SimpleAide stopped successfully"
else
    echo "No SimpleAide processes to stop"
    echo "Hint: If processes are still running, find them with:"
    echo "  ps aux | grep -E 'tsx.*server|vite'"
fi
