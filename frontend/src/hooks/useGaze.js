import { useEffect, useRef, useState } from "react";

const WS_URL = "ws://localhost:8765";
const RECONNECT_MS  = 2000;
const BLINK_MIN_MS  = 80;
const BLINK_MAX_MS  = 450;

export function useGaze() {
  const [gaze, setGaze]         = useState(null);
  const [status, setStatus]     = useState("connecting");
  const [blinkCount, setBlink]  = useState(0);
  const wsRef       = useRef(null);
  const retryRef    = useRef(null);
  const wasValidRef = useRef(true);
  const closedAtRef = useRef(null);

  useEffect(() => {
    let destroyed = false;
    function connect() {
      if (destroyed) return;
      setStatus("connecting");
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => { if (!destroyed) setStatus("connected"); };
      ws.onmessage = (e) => {
        if (destroyed) return;
        try {
          const d = JSON.parse(e.data);
          const x = Number(d.x), y = Number(d.y);
          if (!isFinite(x) || !isFinite(y)) return;
          const nowValid = Boolean(d.valid);
          if (wasValidRef.current && !nowValid) {
            closedAtRef.current = Date.now();
          } else if (!wasValidRef.current && nowValid && closedAtRef.current) {
            const dur = Date.now() - closedAtRef.current;
            if (dur >= BLINK_MIN_MS && dur <= BLINK_MAX_MS)
              setBlink(c => c + 1);
            closedAtRef.current = null;
          }
          wasValidRef.current = nowValid;
          setGaze({ x, y, valid: nowValid });
        } catch { }
      };
      ws.onclose = () => {
        if (destroyed) return;
        setStatus("disconnected");
        retryRef.current = setTimeout(connect, RECONNECT_MS);
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      destroyed = true;
      clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { gaze, status, blinkCount };
}
