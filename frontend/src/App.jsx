import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { endSession, fetchDashboard, fetchSnapshot, startSession, updateEnvironment } from "./api";
import { generateReportPdf } from "./report";

function formatTime(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function signalColor(value) {
  if (value >= 75) {
    return "var(--safe)";
  }
  if (value >= 55) {
    return "var(--susp)";
  }
  return "var(--disq)";
}

function pixelLuma(r, g, b) {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function detectPhoneInFrame(video, canvas) {
  if (!video || !canvas) {
    return false;
  }

  const width = 160;
  const height = 120;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return false;
  }

  ctx.drawImage(video, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const mask = new Uint8Array(width * height);

  for (let pixel = 0, offset = 0; pixel < mask.length; pixel += 1, offset += 4) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luma = pixelLuma(r, g, b);
    const saturation = max - min;
    const darkRectanglePixel = luma > 16 && luma < 125 && saturation < 70;
    mask[pixel] = darkRectanglePixel ? 1 : 0;
  }

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let bestScore = 0;

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) {
      continue;
    }

    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    visited[start] = 1;

    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (head < tail) {
      const current = queue[head];
      head += 1;

      const y = Math.floor(current / width);
      const x = current - y * width;
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [current - 1, current + 1, current - width, current + width];
      neighbors.forEach((neighbor) => {
        if (neighbor < 0 || neighbor >= mask.length || visited[neighbor] || !mask[neighbor]) {
          return;
        }

        const neighborY = Math.floor(neighbor / width);
        const neighborX = neighbor - neighborY * width;
        if (Math.abs(neighborX - x) + Math.abs(neighborY - y) !== 1) {
          return;
        }

        visited[neighbor] = 1;
        queue[tail] = neighbor;
        tail += 1;
      });
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const fillRatio = area / (boxWidth * boxHeight);
    const aspectRatio = boxWidth / boxHeight;
    const centerX = (minX + maxX) / 2 / width;
    const centerY = (minY + maxY) / 2 / height;

    if (area < 180 || boxWidth < 16 || boxHeight < 28) {
      continue;
    }
    if (aspectRatio < 0.22 || aspectRatio > 1.05) {
      continue;
    }
    if (fillRatio < 0.58) {
      continue;
    }
    if (centerX < 0.14 || centerX > 0.86) {
      continue;
    }
    if (centerY < 0.08 || centerY > 0.95) {
      continue;
    }

    const score = area * fillRatio;
    if (score > bestScore) {
      bestScore = score;
    }
  }

  return bestScore > 250;
}

function createRollingDetectionState() {
  return {
    personCounts: [],
    phoneHits: [],
  };
}

function smoothPersonCount(state, nextCount) {
  state.personCounts = [...state.personCounts.slice(-3), Math.max(1, nextCount)];
  return Math.max(1, ...state.personCounts);
}

function smoothPhoneDetected(state, nextValue) {
  state.phoneHits = [...state.phoneHits.slice(-4), nextValue ? 1 : 0];
  return state.phoneHits.reduce((sum, value) => sum + value, 0) >= 2;
}

async function loadCocoSsdModel() {
  if (window.__thruthlensCocoModel) {
    return window.__thruthlensCocoModel;
  }

  const startedAt = Date.now();
  while (!(window.tf && window.cocoSsd)) {
    if (Date.now() - startedAt > 12000) {
      throw new Error("Object detection scripts did not load.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }

  if (typeof window.tf.ready === "function") {
    await window.tf.ready();
  }

  window.__thruthlensCocoModel = await window.cocoSsd.load({
    base: "lite_mobilenet_v2",
  });
  return window.__thruthlensCocoModel;
}

function cocoPhoneDetected(predictions, video) {
  const videoArea = Math.max(1, (video.videoWidth || 1) * (video.videoHeight || 1));
  return predictions.some((prediction) => {
    if (prediction.class !== "cell phone" || prediction.score < 0.18) {
      return false;
    }

    const bbox = prediction.bbox || [0, 0, 0, 0];
    const area = bbox[2] * bbox[3];
    return area >= videoArea * 0.008;
  });
}

function ScoreRing({ score, size = 100, color }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="8"
      />
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
        style={{ transition: "stroke-dashoffset .5s ease, stroke .4s" }}
      />
      <text
        x="50"
        y="47"
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "20px",
          fontWeight: 700,
          fill: "var(--text)",
        }}
      >
        {score}
      </text>
      <text
        x="50"
        y="63"
        textAnchor="middle"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "8px",
          fill: "var(--muted)",
        }}
      >
        / 100
      </text>
    </svg>
  );
}

function Waveform({ amps }) {
  return (
    <div className="waveform">
      {amps.map((amp, index) => (
        <div
          key={`${amp}-${index}`}
          className="wave-bar"
          style={{
            height: `${amp * 100}%`,
            animationDelay: `${index * 0.04}s`,
            animationDuration: `${0.6 + amp * 0.6}s`,
          }}
        />
      ))}
    </div>
  );
}

function SignalBars({ signals }) {
  const rows = [
    { key: "emotionStability", label: "Emotion stability" },
    { key: "eyeContactRatio", label: "Eye contact" },
    { key: "voiceCalmness", label: "Voice calmness" },
    { key: "speakingPace", label: "Speaking pace" },
    { key: "microExpression", label: "Micro-expression" },
  ];

  return (
    <div>
      {rows.map(({ key, label }) => {
        const value = signals[key];
        return (
          <div className="signal-row" key={key}>
            <span className="signal-name">{label}</span>
            <div className="signal-bar-track">
              <div
                className="signal-bar-fill"
                style={{
                  width: `${value}%`,
                  background: signalColor(value),
                }}
              />
            </div>
            <span className="signal-val" style={{ color: signalColor(value) }}>
              {value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FlagsPanel({ flags }) {
  if (!flags.length) {
    return <div className="no-flags">No flags detected</div>;
  }

  return (
    <div>
      {[...flags].reverse().map((flag, index) => (
        <div className="flag-item" key={`${flag.message}-${index}`}>
          <div className={`flag-sev ${flag.severity}`} />
          <span className="flag-text">{flag.message}</span>
          <span className="flag-time">{flag.time}</span>
        </div>
      ))}
    </div>
  );
}

function TimelineChart({ history, canvasRef }) {
  useEffect(() => {
    if (!canvasRef.current || history.length < 2) {
      return;
    }

    const existing = Chart.getChart(canvasRef.current);
    if (existing) {
      existing.destroy();
    }

    const ctx = canvasRef.current.getContext("2d");

    new Chart(ctx, {
      type: "line",
      data: {
        labels: history.map((point) => point.time),
        datasets: [
          {
            data: history.map((point) => point.score),
            borderColor: "#7b61ff",
            backgroundColor: "rgba(123,97,255,0.08)",
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#111118",
            borderColor: "rgba(255,255,255,0.1)",
            borderWidth: 1,
            titleColor: "#f0f0f4",
            bodyColor: "#7a7a8c",
            callbacks: {
              label: (context) => `Score: ${context.raw}`,
            },
          },
        },
        scales: {
          x: {
            display: false,
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: {
              color: "#7a7a8c",
              font: { size: 10 },
              stepSize: 25,
            },
            border: { display: false },
          },
        },
      },
    });

    return () => {
      const chart = Chart.getChart(canvasRef.current);
      if (chart) {
        chart.destroy();
      }
    };
  }, [canvasRef, history]);

  return (
    <div className="timeline-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}

function ReportModal({ report, onClose }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Session Complete</h2>
        <p>
          The interview has ended. Final integrity score:{" "}
          <strong style={{ color: report.verdict.color }}>
            {report.score}/100 - {report.verdict.label}
          </strong>
        </p>

        <div className="report-preview">
          <div className="rp-row">
            <span>Candidate</span>
            <span>{report.candidate_name}</span>
          </div>
          <div className="rp-row">
            <span>Duration</span>
            <span>{report.duration_label}</span>
          </div>
          <div className="rp-row">
            <span>Final score</span>
            <span style={{ color: report.verdict.color }}>{report.score}/100</span>
          </div>
          <div className="rp-row">
            <span>Verdict</span>
            <span>{report.verdict.label}</span>
          </div>
          <div className="rp-row">
            <span>Flags raised</span>
            <span>{report.flags.length}</span>
          </div>
          <div className="rp-row">
            <span>Dominant emotion</span>
            <span>{report.facial.dominant}</span>
          </div>
          <div className="rp-row">
            <span>Voice stress level</span>
            <span>{report.voice.stress_level}</span>
          </div>
          <div className="rp-row">
            <span>Environment risk</span>
            <span>{report.environment.risk_label}</span>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Back to Dashboard
          </button>
          <button className="btn-primary" onClick={() => generateReportPdf(report)}>
            Download PDF Report
          </button>
        </div>
      </div>
    </div>
  );
}

function CandidateView({ candidateName, onEnd }) {
  const [sessionId, setSessionId] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [camActive, setCamActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const chartRef = useRef(null);
  const faceDetectorRef = useRef(null);
  const objectDetectorRef = useRef(null);
  const phoneCanvasRef = useRef(null);
  const detectionStateRef = useRef(createRollingDetectionState());
  const detectionBusyRef = useRef(false);
  const lastEnvironmentRef = useRef({ persons_detected: 1, phone_detected: false });

  useEffect(() => {
    if (!running || !sessionId) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const nextSnapshot = await fetchSnapshot(sessionId);
        setSnapshot(nextSnapshot);
      } catch (requestError) {
        setError(requestError.message || "Unable to refresh session data.");
      }
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [running, sessionId]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!camActive || !videoRef.current || !streamRef.current) {
      return;
    }

    videoRef.current.srcObject = streamRef.current;
    const playAttempt = videoRef.current.play();
    if (playAttempt && typeof playAttempt.catch === 'function') {
      playAttempt.catch(() => {});
    }
  }, [camActive]);

  useEffect(() => {
    if (!running || !sessionId || !camActive || !videoRef.current) {
      return;
    }

    detectionStateRef.current = createRollingDetectionState();

    if ("FaceDetector" in window && !faceDetectorRef.current) {
      try {
        faceDetectorRef.current = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
      } catch {
        faceDetectorRef.current = null;
      }
    }

    if (!phoneCanvasRef.current) {
      phoneCanvasRef.current = document.createElement("canvas");
    }

    let cancelled = false;

    const prepareDetector = async () => {
      try {
        objectDetectorRef.current = await loadCocoSsdModel();
      } catch {
        if (!cancelled) {
          setError("Live object detector could not load.");
        }
      }
    };
    prepareDetector();

    const intervalId = window.setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || detectionBusyRef.current) {
        return;
      }

      detectionBusyRef.current = true;
      try {
        let predictions = [];
        if (objectDetectorRef.current) {
          predictions = await objectDetectorRef.current.detect(video, 12, 0.18);
          if (cancelled) {
            return;
          }
        }

        let faceCount = 0;
        if (faceDetectorRef.current) {
          try {
            const faces = await faceDetectorRef.current.detect(video);
            faceCount = faces.length || 0;
          } catch {
            faceCount = 0;
          }
        }

        const personPredictions = predictions.filter(
          (prediction) => prediction.class === "person" && prediction.score >= 0.28,
        );
        const rawPersons = Math.max(1, personPredictions.length, faceCount);
        const rawPhoneDetected =
          cocoPhoneDetected(predictions, video)
          || detectPhoneInFrame(video, phoneCanvasRef.current);

        const detectedPersons = smoothPersonCount(detectionStateRef.current, rawPersons);
        const phoneDetected = smoothPhoneDetected(detectionStateRef.current, rawPhoneDetected);

        const previous = lastEnvironmentRef.current;
        if (
          previous.persons_detected === detectedPersons
          && previous.phone_detected === phoneDetected
        ) {
          return;
        }

        lastEnvironmentRef.current = {
          persons_detected: detectedPersons,
          phone_detected: phoneDetected,
        };

        setSnapshot((current) => {
          if (!current) {
            return current;
          }

          const detections = [];
          const suspiciousObjects = [];
          let riskLabel = "Clear";

          if (detectedPersons > 1) {
            detections.push("multiple persons");
            suspiciousObjects.push("multiple persons");
            riskLabel = "High Risk";
          } else {
            detections.push("single candidate");
          }

          if (phoneDetected) {
            detections.push("mobile phone");
            suspiciousObjects.push("mobile phone");
            if (riskLabel !== "High Risk") {
              riskLabel = "Review";
            }
          }

          return {
            ...current,
            environment: {
              ...current.environment,
              persons_detected: detectedPersons,
              phone_detected: phoneDetected,
              suspicious_objects: suspiciousObjects,
              risk_label: riskLabel,
              detections,
            },
          };
        });

        try {
          const updatedSnapshot = await updateEnvironment(sessionId, {
            persons_detected: detectedPersons,
            phone_detected: phoneDetected,
          });

          if (!cancelled) {
            setSnapshot(updatedSnapshot);
          }
        } catch {
          // Keep optimistic UI state even if backend sync is temporarily unavailable.
        }
      } catch {
        // Ignore detector frame failures and continue polling.
      } finally {
        detectionBusyRef.current = false;
      }
    }, 550);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      detectionBusyRef.current = false;
    };
  }, [camActive, running, sessionId]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCamActive(true);
    } catch {
      setCamActive(false);
    }
  }

  async function handleStart() {
    setLoading(true);
    setError("");

    try {
      await startCamera();
      const startedSession = await startSession(candidateName);
      lastEnvironmentRef.current = {
        persons_detected: startedSession.snapshot.environment.persons_detected,
        phone_detected: startedSession.snapshot.environment.phone_detected,
      };
      detectionStateRef.current = createRollingDetectionState();
      setSessionId(startedSession.session_id);
      setSnapshot(startedSession.snapshot);
      setRunning(true);
    } catch (requestError) {
      setError(requestError.message || "Unable to start interview session.");
    } finally {
      setLoading(false);
    }
  }

  async function handleEnd() {
    if (!sessionId) {
      return;
    }

    setLoading(true);
    setRunning(false);

    try {
      const result = await endSession(sessionId);
      setReport(result.report);
    } catch (requestError) {
      setError(requestError.message || "Unable to finish the interview session.");
    } finally {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setCamActive(false);
      setLoading(false);
    }
  }

  const score = snapshot?.score ?? 0;
  const verdict = snapshot?.verdict ?? {
    label: "IDLE",
    cls: "susp",
    color: "var(--muted)",
  };
  const emotionEntries = snapshot
    ? [
        ["confidence", snapshot.facial.confidence],
        ["stress", snapshot.facial.stress],
        ["nervousness", snapshot.facial.nervousness],
      ]
    : [];
  const dominantEmotion = snapshot?.facial.dominant?.toLowerCase();

  return (
    <>
      <div className="app-header">
        <span className="wordmark">ThruthLens AI</span>
        <div className="header-right">
          {running && (
            <>
              <div className="live-dot" />
              <span style={{ fontSize: 12, color: "var(--safe)" }}>LIVE</span>
            </>
          )}
          <span className="chip">{candidateName}</span>
          {snapshot && <span className="chip">{formatTime(snapshot.elapsed_seconds)}</span>}
          <span
            className={`chip ${
              verdict.cls === "safe"
                ? "chip-safe"
                : verdict.cls === "susp"
                  ? "chip-susp"
                  : "chip-disq"
            }`}
          >
            {score} - {verdict.label}
          </span>
          {running ? (
            <button
              className="btn-primary"
              onClick={handleEnd}
              style={{ padding: "6px 16px", background: "var(--disq)" }}
              disabled={loading}
            >
              End Session
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={handleStart}
              style={{ padding: "6px 16px" }}
              disabled={loading}
            >
              {loading ? "Starting..." : "Start Session"}
            </button>
          )}
        </div>
      </div>

      <div className="candidate-layout">
        <div className="video-section">
          {camActive ? (
            <video ref={videoRef} autoPlay playsInline muted />
          ) : (
            <div className="no-cam">
              <div className="cam-icon">AI</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Camera access required</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Click "Start Session" to begin live monitoring
              </div>
            </div>
          )}

          {running && snapshot && (
            <div className="video-overlay">
              <div className="scan-line" />
              <div className="corner-bracket tl" />
              <div className="corner-bracket tr" />
              <div className="corner-bracket bl" />
              <div className="corner-bracket br" />
              <div className="video-status-card">
                <div className="section-label">Environment monitoring</div>
                <div className="status-grid">
                  <div className="status-block">
                    <span>Persons</span>
                    <strong>{snapshot.environment.persons_detected}</strong>
                  </div>
                  <div className="status-block">
                    <span>Phone</span>
                    <strong>{snapshot.environment.phone_detected ? "Yes" : "No"}</strong>
                  </div>
                  <div className="status-block">
                    <span>Risk</span>
                    <strong>{snapshot.environment.risk_label}</strong>
                  </div>
                </div>
              </div>
              <div className="emotion-overlay">
                {emotionEntries.map(([emotion, value]) => (
                  <div
                    key={emotion}
                    className={`emo-pill ${dominantEmotion === emotion ? "dominant" : ""}`}
                  >
                    {emotion} {value}%
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sidebar">
          {error && <div className="sidebar-alert">{error}</div>}

          <div className="sidebar-section">
            <div className="section-label">Integrity score</div>
            <div className="score-ring-wrap">
              <ScoreRing score={score} size={100} color={verdict.color} />
              <div className="score-ring-info">
                <div className="score-number-big" style={{ color: verdict.color }}>
                  {score}
                </div>
                <div className="score-label-small">out of 100</div>
              </div>
            </div>
            <div className={`verdict-banner verdict-${verdict.cls}`}>{verdict.label}</div>
          </div>

          {snapshot && (
            <>
              <div className="sidebar-section">
                <div className="section-label">Signal breakdown</div>
                <SignalBars signals={snapshot.signals} />
              </div>

              <div className="sidebar-section">
                <div className="section-label">Facial emotion detection</div>
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>Confidence</span>
                    <strong>{snapshot.facial.confidence}%</strong>
                  </div>
                  <div className="mini-card">
                    <span>Stress</span>
                    <strong>{snapshot.facial.stress}%</strong>
                  </div>
                  <div className="mini-card">
                    <span>Nervousness</span>
                    <strong>{snapshot.facial.nervousness}%</strong>
                  </div>
                  <div className="mini-card">
                    <span>Stability</span>
                    <strong>{snapshot.facial.stability_score}/100</strong>
                  </div>
                </div>
              </div>

              <div className="sidebar-section">
                <div className="section-label">Voice stress analysis</div>
                <Waveform amps={snapshot.voice.waveform} />
                <div className="detail-list">
                  <div className="detail-row">
                    <span>Stress level</span>
                    <strong>{snapshot.voice.stress_level}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Pitch variation</span>
                    <strong>{snapshot.voice.pitch_variation}/100</strong>
                  </div>
                  <div className="detail-row">
                    <span>Speech speed</span>
                    <strong>{snapshot.voice.speech_speed}/100</strong>
                  </div>
                  <div className="detail-row">
                    <span>Voice tremors</span>
                    <strong>{snapshot.voice.tremor_index}/100</strong>
                  </div>
                </div>
              </div>

              <div className="sidebar-section">
                <div className="section-label">Behavior tracking</div>
                <div className="detail-list">
                  <div className="detail-row">
                    <span>Eye contact</span>
                    <strong>{snapshot.behavior.eye_contact}/100</strong>
                  </div>
                  <div className="detail-row">
                    <span>Looking away events</span>
                    <strong>{snapshot.behavior.looking_away_events}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Head turning</span>
                    <strong>{snapshot.behavior.head_turning}/100</strong>
                  </div>
                  <div className="detail-row">
                    <span>Movement stability</span>
                    <strong>{snapshot.behavior.movement_stability}/100</strong>
                  </div>
                </div>
              </div>

              <div className="sidebar-section">
                <div className="section-label">Environment monitoring</div>
                <div className="detection-list">
                  {snapshot.environment.detections.length ? (
                    snapshot.environment.detections.map((detection) => (
                      <span className="badge detection-badge" key={detection}>
                        {detection}
                      </span>
                    ))
                  ) : (
                    <span className="no-flags">No suspicious objects detected</span>
                  )}
                </div>
              </div>

              <div className="sidebar-section">
                <div className="section-label">Score timeline</div>
                {snapshot.history.length > 1 ? (
                  <TimelineChart history={snapshot.history} canvasRef={chartRef} />
                ) : (
                  <div className="empty-chart">Awaiting analysis frames...</div>
                )}
              </div>

              <div className="sidebar-section" style={{ flex: 1 }}>
                <div className="section-label">Active flags ({snapshot.flags.length})</div>
                <FlagsPanel flags={snapshot.flags} />
              </div>
            </>
          )}
        </div>
      </div>

      {report && <ReportModal report={report} onClose={onEnd} />}
    </>
  );
}

function RecruiterDashboard({ onStartNew, refreshKey }) {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  const chartRef = useRef(null);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const response = await fetchDashboard();
        setDashboard(response);
        setError("");
      } catch (requestError) {
        setError(requestError.message || "Unable to load dashboard.");
      }
    }

    loadDashboard();
  }, [refreshKey]);

  useEffect(() => {
    if (!dashboard || !chartRef.current) {
      return;
    }

    const existing = Chart.getChart(chartRef.current);
    if (existing) {
      existing.destroy();
    }

    new Chart(chartRef.current, {
      type: "bar",
      data: {
        labels: dashboard.sessions.map((session) => session.name.split(" ")[0]),
        datasets: [
          {
            data: dashboard.sessions.map((session) => session.score),
            backgroundColor: dashboard.sessions.map((session) => session.color),
            borderRadius: 6,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#111118",
            borderColor: "rgba(255,255,255,0.1)",
            borderWidth: 1,
            titleColor: "#f0f0f4",
            bodyColor: "#7a7a8c",
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: "#7a7a8c", font: { size: 11 } },
            border: { display: false },
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: { color: "#7a7a8c", font: { size: 10 }, stepSize: 25 },
            border: { display: false },
          },
        },
      },
    });

    return () => {
      const chart = Chart.getChart(chartRef.current);
      if (chart) {
        chart.destroy();
      }
    };
  }, [dashboard]);

  const metrics = dashboard?.metrics ?? {
    total_sessions: 0,
    average_score: 0,
    cleared: 0,
    suspicious: 0,
    disqualified: 0,
  };

  return (
    <>
      <div className="app-header">
        <span className="wordmark">ThruthLens AI</span>
        <div className="header-right">
          <div className="nav-tabs">
            <button className="nav-tab active">Dashboard</button>
            <button className="nav-tab" onClick={onStartNew}>
              New session
            </button>
          </div>
        </div>
      </div>

      <div className="dashboard-layout">
        {error && <div className="dashboard-error">{error}</div>}

        <div className="dash-grid">
          <div className="metric-card">
            <div className="mc-label">Total sessions</div>
            <div className="mc-value">{metrics.total_sessions}</div>
            <div className="mc-sub">Monitored interviews</div>
          </div>
          <div className="metric-card">
            <div className="mc-label">Average score</div>
            <div
              className="mc-value"
              style={{ color: signalColor(metrics.average_score) }}
            >
              {metrics.average_score}
            </div>
            <div className="mc-sub">Data-driven average</div>
          </div>
          <div className="metric-card">
            <div className="mc-label">Cleared</div>
            <div className="mc-value" style={{ color: "var(--safe)" }}>
              {metrics.cleared}
            </div>
            <div className="mc-sub">Safe verdict</div>
          </div>
          <div className="metric-card">
            <div className="mc-label">Disqualified</div>
            <div className="mc-value" style={{ color: "var(--disq)" }}>
              {metrics.disqualified}
            </div>
            <div className="mc-sub">Integrity risk</div>
          </div>
        </div>

        <div className="chart-grid">
          <div className="chart-card">
            <div className="chart-title">Candidate score comparison</div>
            <div style={{ height: 180 }}>
              <canvas ref={chartRef} />
            </div>
          </div>
          <div className="chart-card">
            <div className="chart-title">Verdict distribution</div>
            <div className="tier-breakdown">
              <div className="tier-seg">
                <div className="ts-num" style={{ color: "var(--disq)" }}>
                  {metrics.disqualified}
                </div>
                <div className="ts-lbl">Disqualify</div>
              </div>
              <div className="tier-seg">
                <div className="ts-num" style={{ color: "var(--susp)" }}>
                  {metrics.suspicious}
                </div>
                <div className="ts-lbl">Suspicious</div>
              </div>
              <div className="tier-seg">
                <div className="ts-num" style={{ color: "var(--safe)" }}>
                  {metrics.cleared}
                </div>
                <div className="ts-lbl">Safe</div>
              </div>
            </div>
            <div className="ratio-list">
              <div className="detail-row">
                <span>Safe rate</span>
                <strong style={{ color: "var(--safe)" }}>
                  {metrics.total_sessions
                    ? Math.round((metrics.cleared / metrics.total_sessions) * 100)
                    : 0}
                  %
                </strong>
              </div>
              <div className="detail-row">
                <span>Disqualification rate</span>
                <strong style={{ color: "var(--disq)" }}>
                  {metrics.total_sessions
                    ? Math.round(
                        (metrics.disqualified / metrics.total_sessions) * 100,
                      )
                    : 0}
                  %
                </strong>
              </div>
            </div>
          </div>
        </div>

        <div className="dash-bottom">
          <div className="chart-card">
            <div className="chart-title">Session history</div>
            <div className="history-list">
              {(dashboard?.sessions ?? []).map((session) => (
                <div className="session-card" key={session.id}>
                  <div
                    className="session-avatar"
                    style={{
                      background: `${session.color}22`,
                      color: session.color,
                    }}
                  >
                    {session.initials}
                  </div>
                  <div>
                    <div className="sc-name">{session.name}</div>
                    <div className="sc-role">{session.role}</div>
                  </div>
                  <div className="session-meta">
                    <span className={`chip chip-${session.verdict.cls}`}>
                      {session.verdict.label}
                    </span>
                    <span
                      className="sc-score"
                      style={{ color: session.verdict.color }}
                    >
                      {session.score}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-title">System stack</div>
            <div className="stack-list">
              {(dashboard?.stack ?? []).map((item) => (
                <div className="detail-row stack-row" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
            <div className="chart-title" style={{ marginTop: 18 }}>
              Scoring weights
            </div>
            {(dashboard?.weights ?? []).map((weight) => (
              <div className="detail-row weight-row" key={weight.label}>
                <span>{weight.label}</span>
                <strong style={{ color: "var(--accent)" }}>{weight.value}</strong>
              </div>
            ))}
            <button
              className="btn-primary"
              onClick={onStartNew}
              style={{ width: "100%", marginTop: 16, fontSize: 13, padding: "10px" }}
            >
              Start new session
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Landing({ onCandidate, onRecruiter }) {
  const [name, setName] = useState("");

  return (
    <div className="landing">
      <div className="logo">ThruthLens AI · Remote Interview Intelligence</div>
      <h1>
        Interview
        <br />
        Intelligence,
        <br />
        Objectified.
      </h1>
      <p>
        A real-time platform for recruiters to analyze facial expressions, voice
        patterns, behavior cues, and interview environments during virtual hiring.
      </p>

      <div className="hero-card">
        <div className="hero-copy">
          <span className="hero-kicker">Problem statement</span>
          <h3>Reduce subjective interview bias with multimodal AI insight.</h3>
          <p>
            ThruthLens AI combines facial analysis, voice stress detection, eye and
            head tracking, and YOLO-based environment monitoring into one recruiter
            friendly experience.
          </p>
        </div>
        <div className="hero-features">
          <div className="feature-pill">Stress</div>
          <div className="feature-pill">Confidence</div>
          <div className="feature-pill">Nervousness</div>
          <div className="feature-pill">Eye tracking</div>
          <div className="feature-pill">Voice tremors</div>
          <div className="feature-pill">Phone detection</div>
        </div>
      </div>

      <div className="landing-form">
        <input
          type="text"
          placeholder="Enter candidate name..."
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) {
              onCandidate(name.trim());
            }
          }}
        />
        <div className="btn-group" style={{ width: "100%" }}>
          <button
            className="btn-primary"
            style={{ flex: 1 }}
            onClick={() => name.trim() && onCandidate(name.trim())}
          >
            Start as Candidate
          </button>
          <button className="btn-secondary" onClick={onRecruiter}>
            Recruiter View
          </button>
        </div>
      </div>

      <div className="badge-row">
        <div className="badge">React.js</div>
        <div className="badge">FastAPI</div>
        <div className="badge">DeepFace</div>
        <div className="badge">Librosa</div>
        <div className="badge">OpenCV</div>
        <div className="badge">YOLO</div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("landing");
  const [candidateName, setCandidateName] = useState("");
  const [dashboardRefresh, setDashboardRefresh] = useState(0);

  return (
    <div>
      {view === "landing" && (
        <Landing
          onCandidate={(name) => {
            setCandidateName(name);
            setView("candidate");
          }}
          onRecruiter={() => {
            setDashboardRefresh((value) => value + 1);
            setView("recruiter");
          }}
        />
      )}

      {view === "candidate" && (
        <CandidateView
          candidateName={candidateName}
          onEnd={() => {
            setDashboardRefresh((value) => value + 1);
            setView("recruiter");
          }}
        />
      )}

      {view === "recruiter" && (
        <RecruiterDashboard
          refreshKey={dashboardRefresh}
          onStartNew={() => setView("landing")}
        />
      )}
    </div>
  );
}

