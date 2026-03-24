import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";

// ✅ FIXED: removed updateEnvironment
import { endSession, fetchDashboard, fetchSnapshot, startSession } from "./api";

import { generateReportPdf } from "./report";

function formatTime(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function App() {
  const [sessionId, setSessionId] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [running, setRunning] = useState(false);
  const [candidateName, setCandidateName] = useState("");
  const intervalRef = useRef(null);

  // 🔄 Fetch snapshot every second
  useEffect(() => {
    if (!running || !sessionId) return;

    intervalRef.current = setInterval(async () => {
      try {
        const data = await fetchSnapshot(sessionId);
        setSnapshot(data);
      } catch (err) {
        console.error(err);
      }
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [running, sessionId]);

  // ▶️ Start session
  async function handleStart() {
    if (!candidateName) return alert("Enter candidate name");

    const res = await startSession(candidateName);
    setSessionId(res.session_id);
    setSnapshot(res.snapshot);
    setRunning(true);
  }

  // ⏹️ End session
  async function handleEnd() {
    if (!sessionId) return;

    const res = await endSession(sessionId);
    generateReportPdf(res.report);

    setRunning(false);
    setSessionId("");
    setSnapshot(null);
  }

  return (
    <div style={{ padding: "20px", color: "white" }}>
      <h1>IntellView</h1>

      {!running && (
        <>
          <input
            placeholder="Enter candidate name"
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
          />
          <button onClick={handleStart}>Start Session</button>
        </>
      )}

      {running && snapshot && (
        <>
          <h2>Session Running</h2>
          <p>Score: {snapshot.score}</p>
          <p>Verdict: {snapshot.verdict.label}</p>

          <button onClick={handleEnd}>End Session</button>
        </>
      )}
    </div>
  );
}

export default App;
