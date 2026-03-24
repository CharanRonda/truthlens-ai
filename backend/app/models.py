from __future__ import annotations

from typing import List

from pydantic import BaseModel


class Verdict(BaseModel):
    label: str
    cls: str
    color: str
    message: str


class Flag(BaseModel):
    severity: str
    message: str
    time: str


class HistoryPoint(BaseModel):
    score: int
    time: str


class Signals(BaseModel):
    emotionStability: int
    eyeContactRatio: int
    voiceCalmness: int
    speakingPace: int
    microExpression: int


class FacialMetrics(BaseModel):
    confidence: int
    stress: int
    nervousness: int
    dominant: str
    stability_score: int


class VoiceMetrics(BaseModel):
    stress_level: str
    pitch_variation: int
    speech_speed: int
    tremor_index: int
    waveform: List[float]


class BehaviorMetrics(BaseModel):
    eye_contact: int
    looking_away_events: int
    head_turning: int
    movement_stability: int


class EnvironmentMetrics(BaseModel):
    persons_detected: int
    phone_detected: bool
    suspicious_objects: List[str]
    risk_label: str
    detections: List[str]


class SnapshotResponse(BaseModel):
    session_id: str
    candidate_name: str
    elapsed_seconds: int
    score: int
    verdict: Verdict
    signals: Signals
    facial: FacialMetrics
    voice: VoiceMetrics
    behavior: BehaviorMetrics
    environment: EnvironmentMetrics
    flags: List[Flag]
    history: List[HistoryPoint]


class StartSessionRequest(BaseModel):
    candidate_name: str


class EnvironmentUpdateRequest(BaseModel):
    persons_detected: int | None = None
    phone_detected: bool | None = None


class StartSessionResponse(BaseModel):
    session_id: str
    snapshot: SnapshotResponse


class SessionSummary(BaseModel):
    id: str
    name: str
    role: str
    score: int
    initials: str
    color: str
    verdict: Verdict


class WeightRow(BaseModel):
    label: str
    value: str


class StackRow(BaseModel):
    label: str
    value: str


class DashboardMetrics(BaseModel):
    total_sessions: int
    average_score: int
    cleared: int
    suspicious: int
    disqualified: int


class DashboardResponse(BaseModel):
    metrics: DashboardMetrics
    sessions: List[SessionSummary]
    weights: List[WeightRow]
    stack: List[StackRow]


class ReportResponse(BaseModel):
    session_id: str
    candidate_name: str
    generated_at: str
    duration_label: str
    score: int
    verdict: Verdict
    signals: Signals
    facial: FacialMetrics
    voice: VoiceMetrics
    behavior: BehaviorMetrics
    environment: EnvironmentMetrics
    flags: List[Flag]


class EndSessionResponse(BaseModel):
    report: ReportResponse

