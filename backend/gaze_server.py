"""
Rhythm Trace - Tobii Eye Tracker 4C backend
Connects to the tracker, validates gaze data, and streams (x, y) over WebSocket.
"""

import asyncio
import json
import logging
import math
import time

import tobii_research as tr
import websockets

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

HOST = "localhost"
PORT = 8765

_clients: set = set()
_last_valid: dict | None = None
_loop: asyncio.AbstractEventLoop | None = None


def _is_valid(value: float) -> bool:
    return isinstance(value, (int, float)) and not math.isnan(value) and not math.isinf(value)


def _on_gaze(gaze_data):
    """Tobii callback — runs in the tracker's internal thread."""
    global _last_valid

    ts = gaze_data["system_time_stamp"] / 1_000_000  # µs → s

    # as_dictionary=True gives flat keys, NOT objects with .validity attributes
    left_valid  = gaze_data.get("left_gaze_point_validity",  0) == 1
    right_valid = gaze_data.get("right_gaze_point_validity", 0) == 1

    xs, ys = [], []

    if left_valid:
        lx, ly = gaze_data["left_gaze_point_on_display_area"]
        if _is_valid(lx) and _is_valid(ly):
            xs.append(lx)
            ys.append(ly)

    if right_valid:
        rx, ry = gaze_data["right_gaze_point_on_display_area"]
        if _is_valid(rx) and _is_valid(ry):
            xs.append(rx)
            ys.append(ry)

    if xs:
        payload = {
            "x":         round(sum(xs) / len(xs), 6),
            "y":         round(sum(ys) / len(ys), 6),
            "timestamp": round(ts, 4),
            "valid":     True,
        }
        _last_valid = payload
    else:
        # Both eyes lost — reuse last known position but flag invalid
        if _last_valid is None:
            return
        payload = {**_last_valid, "valid": False, "timestamp": round(ts, 4)}

    message = json.dumps(payload)
    if _loop is not None:
        asyncio.run_coroutine_threadsafe(_broadcast(message), _loop)


async def _broadcast(message: str):
    dead = set()
    for ws in _clients:
        try:
            await ws.send(message)
        except websockets.ConnectionClosed:
            dead.add(ws)
    _clients.difference_update(dead)


async def _handler(websocket):
    log.info("Client connected: %s", websocket.remote_address)
    _clients.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        _clients.discard(websocket)
        log.info("Client disconnected: %s", websocket.remote_address)


async def _main():
    global _loop
    _loop = asyncio.get_running_loop()

    trackers = tr.find_all_eyetrackers()
    if not trackers:
        raise RuntimeError("No Tobii eye tracker found. Check USB connection.")
    tracker = trackers[0]
    log.info("Using tracker: %s (serial %s)", tracker.model, tracker.serial_number)

    tracker.subscribe_to(tr.EYETRACKER_GAZE_DATA, _on_gaze, as_dictionary=True)
    log.info("Gaze subscription active.")

    async with websockets.serve(_handler, HOST, PORT):
        log.info("WebSocket server listening on ws://%s:%d", HOST, PORT)
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(_main())