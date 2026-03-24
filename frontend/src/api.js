const jsonHeaders = {
  "Content-Type": "application/json",
};

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function parseResponse(response) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Request failed");
  }
  return response.json();
}

export async function fetchDashboard() {
  const response = await fetch(apiUrl("/api/dashboard"));
  return parseResponse(response);
}

export async function startSession(candidateName) {
  const response = await fetch(apiUrl("/api/sessions/start"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ candidate_name: candidateName }),
  });
  return parseResponse(response);
}

export async function fetchSnapshot(sessionId) {
  const response = await fetch(apiUrl(`/api/sessions/${sessionId}/snapshot`));
  return parseResponse(response);
}

export async function updateEnvironment(sessionId, payload) {
  const response = await fetch(apiUrl(`/api/sessions/${sessionId}/environment`), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function endSession(sessionId) {
  const response = await fetch(apiUrl(`/api/sessions/${sessionId}/end`), {
    method: "POST",
  });
  return parseResponse(response);
}
