// 🔗 UPDATED: backend URL
const BASE_URL = "https://truthlens-backend.onrender.com/api";

// Helper function (unchanged)
async function request(endpoint, options = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "API request failed");
  }

  return response.json();
}

// Start session (unchanged)
export async function startSession(candidateName) {
  return request("/sessions/start", {
    method: "POST",
    body: JSON.stringify({
      candidate_name: candidateName,
    }),
  });
}

// Get snapshot (unchanged)
export async function fetchSnapshot(sessionId) {
  return request(`/sessions/${sessionId}/snapshot`);
}

// End session (unchanged)
export async function endSession(sessionId) {
  return request(`/sessions/${sessionId}/end`, {
    method: "POST",
  });
}

// Dashboard (unchanged)
export async function fetchDashboard() {
  return request("/dashboard");
}
