from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import random
from typing import Dict, List
from uuid import uuid4

from .models import (
    BehaviorMetrics,
    DashboardMetrics,
    DashboardResponse,
    EndSessionResponse,
    EnvironmentMetrics,
    FacialMetrics,
    Flag,
    HistoryPoint,
    ReportResponse,
    SessionSummary,
    Signals,
    SnapshotResponse,
    StackRow,
    StartSessionResponse,
    Verdict,
    VoiceMetrics,
    WeightRow,
)


ROLE_ROTATION = [
    "Software Engineer",
    "Backend Engineer",
    "Frontend Engineer",
    "Data Scientist",
    "Product Manager",
]


SEED_CANDIDATES = [
    ("Arjun Sharma", "Software Engineer", 87),
    ("Priya Nair", "Product Manager", 63),
    ("Rohan Mehta", "Data Scientist", 91),
    ("Divya Reddy", "UX Designer", 48),
    ("Karan Singh", "Backend Engineer", 76),
]


def format_time(seconds: int) -> str:
    minutes = str(seconds // 60).zfill(2)
    remainder = str(seconds % 60).zfill(2)
    return f"{minutes}:{remainder}"


def clamp(value: float, minimum: int = 0, maximum: int = 100) -> int:
    return max(minimum, min(maximum, int(round(value))))


def verdict_for_score(score: int) -> Verdict:
    if score >= 80:
        return Verdict(
            label="SAFE",
            cls="safe",
            color="var(--safe)",
            message="Candidate demonstrates strong behavioral integrity. Clear to proceed.",
        )
    if score >= 55:
        return Verdict(
            label="SUSPICIOUS",
            cls="susp",
            color="var(--susp)",
            message="Moderate behavioral inconsistencies detected. Manual review recommended.",
        )
    return Verdict(
        label="DISQUALIFY",
        cls="disq",
        color="var(--disq)",
        message="Significant behavioral red flags detected. Candidate fails the integrity threshold.",
    )


def color_for_score(score: int) -> str:
    if score >= 80:
        return "rgba(34,200,122,0.7)"
    if score >= 55:
        return "rgba(245,166,35,0.7)"
    return "rgba(240,79,79,0.7)"


def environment_penalty(environment: EnvironmentMetrics | None) -> int:
    if environment is None:
        return 0

    penalty = 0
    extra_people = max(0, environment.persons_detected - 1)

    if environment.phone_detected:
        penalty += 20

    if extra_people:
        penalty += 35 + (extra_people - 1) * 10

    penalty += min(10, len(environment.suspicious_objects) * 5)

    if environment.risk_label == "Review":
        penalty += 5
    elif environment.risk_label == "High Risk":
        penalty += 15

    return min(penalty, 45)


def compute_score(signals: Signals, environment: EnvironmentMetrics | None = None) -> int:
    weighted = (
        signals.emotionStability * 0.25
        + signals.eyeContactRatio * 0.20
        + signals.voiceCalmness * 0.25
        + signals.speakingPace * 0.15
        + signals.microExpression * 0.15
    )
    adjusted = weighted - environment_penalty(environment)

    if environment is not None:
        extra_people = max(0, environment.persons_detected - 1)
        if extra_people and environment.phone_detected:
            adjusted = min(adjusted, 34)
        elif extra_people:
            adjusted = min(adjusted, 44)
        elif environment.phone_detected:
            adjusted = min(adjusted, 54)

    return clamp(adjusted)


def initials_for(name: str) -> str:
    return "".join(part[0] for part in name.split()[:2]).upper()


@dataclass
class SessionState:
    session_id: str
    candidate_name: str
    role: str
    rng: random.Random
    tick: int = 0
    signals: Signals = field(
        default_factory=lambda: Signals(
            emotionStability=76,
            eyeContactRatio=73,
            voiceCalmness=71,
            speakingPace=78,
            microExpression=70,
        )
    )
    flags: List[Flag] = field(default_factory=list)
    history: List[HistoryPoint] = field(default_factory=list)
    facial: FacialMetrics = field(
        default_factory=lambda: FacialMetrics(
            confidence=68,
            stress=19,
            nervousness=13,
            dominant="Confidence",
            stability_score=76,
        )
    )
    voice: VoiceMetrics = field(
        default_factory=lambda: VoiceMetrics(
            stress_level="Calm",
            pitch_variation=32,
            speech_speed=74,
            tremor_index=18,
            waveform=[0.3 for _ in range(24)],
        )
    )
    behavior: BehaviorMetrics = field(
        default_factory=lambda: BehaviorMetrics(
            eye_contact=74,
            looking_away_events=1,
            head_turning=18,
            movement_stability=82,
        )
    )
    environment: EnvironmentMetrics = field(
        default_factory=lambda: EnvironmentMetrics(
            persons_detected=1,
            phone_detected=False,
            suspicious_objects=[],
            risk_label="Clear",
            detections=["single candidate"],
        )
    )
    observed_persons: int = 1
    observed_phone: bool = False
    generated_at: datetime = field(default_factory=datetime.utcnow)
    active: bool = True


class SessionEngine:
    def __init__(self) -> None:
        self.sessions: Dict[str, SessionState] = {}
        self.completed_sessions: List[SessionSummary] = [
            self._seed_summary(index, name, role, score)
            for index, (name, role, score) in enumerate(SEED_CANDIDATES, start=1)
        ]

    def _seed_summary(self, index: int, name: str, role: str, score: int) -> SessionSummary:
        verdict = verdict_for_score(score)
        return SessionSummary(
            id=f"seed-{index}",
            name=name,
            role=role,
            score=score,
            initials=initials_for(name),
            color=color_for_score(score),
            verdict=verdict,
        )

    def start_session(self, candidate_name: str) -> StartSessionResponse:
        session_id = uuid4().hex
        role = ROLE_ROTATION[len(self.completed_sessions) % len(ROLE_ROTATION)]
        session = SessionState(
            session_id=session_id,
            candidate_name=candidate_name,
            role=role,
            rng=random.Random(session_id),
        )
        self.sessions[session_id] = session
        snapshot = self._snapshot_for(session, advance=False)
        return StartSessionResponse(session_id=session_id, snapshot=snapshot)

    def get_snapshot(self, session_id: str) -> SnapshotResponse:
        session = self.sessions[session_id]
        return self._snapshot_for(session, advance=True)

    def update_environment(
        self,
        session_id: str,
        *,
        persons_detected: int | None = None,
        phone_detected: bool | None = None,
    ) -> SnapshotResponse:
        session = self.sessions[session_id]

        if persons_detected is not None:
            session.observed_persons = max(1, min(5, int(persons_detected)))
        if phone_detected is not None:
            session.observed_phone = bool(phone_detected)

        session.environment = self._environment_metrics(session)
        self._sync_environment_flags(session)
        return self._snapshot_for(session, advance=False)

    def end_session(self, session_id: str) -> EndSessionResponse:
        session = self.sessions[session_id]
        session.active = False
        snapshot = self._snapshot_for(session, advance=False)
        report = ReportResponse(
            session_id=session.session_id,
            candidate_name=session.candidate_name,
            generated_at=datetime.utcnow().isoformat(),
            duration_label=format_time(snapshot.elapsed_seconds),
            score=snapshot.score,
            verdict=snapshot.verdict,
            signals=snapshot.signals,
            facial=snapshot.facial,
            voice=snapshot.voice,
            behavior=snapshot.behavior,
            environment=snapshot.environment,
            flags=snapshot.flags,
        )
        self.completed_sessions.insert(
            0,
            SessionSummary(
                id=session.session_id,
                name=session.candidate_name,
                role=session.role,
                score=snapshot.score,
                initials=initials_for(session.candidate_name),
                color=color_for_score(snapshot.score),
                verdict=snapshot.verdict,
            ),
        )
        return EndSessionResponse(report=report)

    def dashboard(self) -> DashboardResponse:
        sessions = self.completed_sessions[:8]
        total_sessions = len(sessions)
        average_score = (
            round(sum(session.score for session in sessions) / total_sessions)
            if total_sessions
            else 0
        )
        cleared = len([session for session in sessions if session.score >= 80])
        suspicious = len([session for session in sessions if 55 <= session.score < 80])
        disqualified = len([session for session in sessions if session.score < 55])

        metrics = DashboardMetrics(
            total_sessions=total_sessions,
            average_score=average_score,
            cleared=cleared,
            suspicious=suspicious,
            disqualified=disqualified,
        )

        weights = [
            WeightRow(label="Emotion stability", value="25%"),
            WeightRow(label="Eye contact ratio", value="20%"),
            WeightRow(label="Voice calmness", value="25%"),
            WeightRow(label="Speaking pace", value="15%"),
            WeightRow(label="Micro-expression control", value="15%"),
            WeightRow(label="Environment violations", value="Hard penalty"),
        ]

        stack = [
            StackRow(label="Frontend", value="React.js"),
            StackRow(label="Backend", value="FastAPI"),
            StackRow(label="Vision", value="OpenCV + DeepFace"),
            StackRow(label="Audio", value="Librosa"),
            StackRow(label="Objects", value="YOLO"),
        ]

        return DashboardResponse(metrics=metrics, sessions=sessions, weights=weights, stack=stack)

    def _snapshot_for(self, session: SessionState, advance: bool) -> SnapshotResponse:
        if advance and session.active:
            self._advance_state(session)

        score = compute_score(session.signals, session.environment)
        verdict = verdict_for_score(score)
        return SnapshotResponse(
            session_id=session.session_id,
            candidate_name=session.candidate_name,
            elapsed_seconds=session.tick,
            score=score,
            verdict=verdict,
            signals=session.signals,
            facial=session.facial,
            voice=session.voice,
            behavior=session.behavior,
            environment=session.environment,
            flags=session.flags[-5:],
            history=session.history[-30:],
        )

    def _advance_state(self, session: SessionState) -> None:
        session.tick += 1

        def bump(value: int, spread: int) -> int:
            return clamp(value + session.rng.randint(-spread, spread))

        next_signals = Signals(
            emotionStability=bump(session.signals.emotionStability, 5),
            eyeContactRatio=bump(session.signals.eyeContactRatio, 6),
            voiceCalmness=bump(session.signals.voiceCalmness, 5),
            speakingPace=bump(session.signals.speakingPace, 4),
            microExpression=bump(session.signals.microExpression, 7),
        )

        if session.tick == 8:
            next_signals.voiceCalmness = clamp(next_signals.voiceCalmness - 18)
            next_signals.emotionStability = clamp(next_signals.emotionStability - 12)
            self._push_flag(session, "high", "Voice stress spike detected")

        if session.tick == 12:
            next_signals.eyeContactRatio = clamp(next_signals.eyeContactRatio - 20)
            self._push_flag(session, "medium", "Candidate looked away frequently")

        if session.tick == 16:
            next_signals.microExpression = clamp(next_signals.microExpression - 16)
            self._push_flag(session, "medium", "Fear micro-expression pattern detected")

        session.signals = next_signals
        session.facial = self._facial_metrics(session)
        session.voice = self._voice_metrics(session)
        session.behavior = self._behavior_metrics(session)
        session.environment = self._environment_metrics(session)
        self._sync_environment_flags(session)

        score = compute_score(session.signals, session.environment)
        session.history.append(HistoryPoint(score=score, time=format_time(session.tick)))

    def _push_flag(self, session: SessionState, severity: str, message: str) -> None:
        if any(flag.message == message for flag in session.flags):
            return
        session.flags.append(Flag(severity=severity, message=message, time=format_time(session.tick)))

    def _facial_metrics(self, session: SessionState) -> FacialMetrics:
        confidence = clamp(100 - session.signals.voiceCalmness * 0.2 + session.signals.emotionStability * 0.5)
        stress = clamp(100 - session.signals.voiceCalmness + session.rng.randint(8, 18))
        nervousness = clamp(100 - session.signals.microExpression + session.rng.randint(5, 15))

        dominant = "Confidence"
        dominant_value = confidence
        if stress > dominant_value:
            dominant = "Stress"
            dominant_value = stress
        if nervousness > dominant_value:
            dominant = "Nervousness"

        return FacialMetrics(
            confidence=confidence,
            stress=stress,
            nervousness=nervousness,
            dominant=dominant,
            stability_score=session.signals.emotionStability,
        )

    def _voice_metrics(self, session: SessionState) -> VoiceMetrics:
        voice_calmness = session.signals.voiceCalmness
        stress_level = "Calm"
        if voice_calmness < 55:
            stress_level = "Elevated"
        if voice_calmness < 40:
            stress_level = "High Stress"

        waveform = [round(session.rng.uniform(0.25, 0.95), 2) for _ in range(24)]

        return VoiceMetrics(
            stress_level=stress_level,
            pitch_variation=clamp(100 - voice_calmness + session.rng.randint(8, 16)),
            speech_speed=session.signals.speakingPace,
            tremor_index=clamp(100 - voice_calmness + session.rng.randint(4, 12)),
            waveform=waveform,
        )

    def _behavior_metrics(self, session: SessionState) -> BehaviorMetrics:
        looking_away = max(0, (100 - session.signals.eyeContactRatio) // 10)
        return BehaviorMetrics(
            eye_contact=session.signals.eyeContactRatio,
            looking_away_events=looking_away,
            head_turning=clamp(100 - session.signals.eyeContactRatio + session.rng.randint(0, 12)),
            movement_stability=clamp(session.signals.microExpression + session.rng.randint(-6, 8)),
        )

    def _sync_environment_flags(self, session: SessionState) -> None:
        if session.environment.persons_detected > 1:
            self._push_flag(session, "high", "Multiple persons detected in frame")
        if session.environment.phone_detected:
            self._push_flag(session, "high", "Mobile phone detected in frame")

    def _environment_metrics(self, session: SessionState) -> EnvironmentMetrics:
        persons_detected = max(1, session.observed_persons)
        phone_detected = session.observed_phone
        suspicious_objects: List[str] = []
        detections: List[str] = []
        risk_label = "Clear"

        if persons_detected > 1:
            suspicious_objects.append("multiple persons")
            detections.append("multiple persons")
            risk_label = "High Risk"
        else:
            detections.append("single candidate")

        if phone_detected:
            suspicious_objects.append("mobile phone")
            detections.append("mobile phone")
            if risk_label != "High Risk":
                risk_label = "Review"

        return EnvironmentMetrics(
            persons_detected=persons_detected,
            phone_detected=phone_detected,
            suspicious_objects=suspicious_objects,
            risk_label=risk_label,
            detections=detections,
        )

