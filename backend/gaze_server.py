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

# Connected WebSocket clients
_clients: set = set()

# Last validated gaze sample (used when current sample is invalid)
_last_valid: dict | None = None


def _is_valid(value: float) -> bool:
    return isinstance(value, float) and not math.isnan(value) and not math.isinf(value)


def _build_payload(left, right, timestamp: float) -> dict | None:
    """Average valid eye positions; return None if both eyes are unusable."""
    xs, ys = [], []

    if left.validity == tr.VALIDITY_VALID:
        lx, ly = left.position_on_display_area
        if _is_valid(lx) and _is_valid(ly):
            xs.append(lx)
            ys.append(ly)

    if right.validity == tr.VALIDITY_VALID:
        rx, ry = right.position_on_display_area
        if _is_valid(rx) and _is_valid(ry):
            xs.append(rx)
            ys.append(ry)

    if not xs:
        return None

    return {
        "x": round(sum(xs) / len(xs), 6),
        "y": round(sum(ys) / len(ys), 6),
        "timestamp": timestamp,
        "valid": True,
    }


def _on_gaze(gaze_data):
    """Tobii callback — runs in the tracker's internal thread."""
    global _last_valid

    ts = gaze_data["system_time_stamp"] / 1_000_000  # µs → s
    payload = _build_payload(
        gaze_data["left_gaze_point_on_display_area"],
        gaze_data["right_gaze_point_on_display_area"],
        ts,
    )

    if payload is None:
        # Both eyes lost — reuse last known position but flag it
        if _last_valid:
            payload = {**_last_valid, "valid": False, "timestamp": ts}
        else:
            return  # Nothing to send yet

    _last_valid = payload if payload["valid"] else _last_valid

    message = json.dumps(payload)
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

    # Find tracker
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
