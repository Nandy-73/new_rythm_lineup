import { useGaze } from "./hooks/useGaze.js";
import { GameCanvas } from "./components/GameCanvas.jsx";

export default function App() {
  const { gaze, status, blinkCount } = useGaze();
  return <GameCanvas gaze={gaze} status={status} blinkCount={blinkCount} />;
}
