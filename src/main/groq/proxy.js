const DEFAULT_MODEL = "whisper-large-v3-turbo";

function getProxyUrl() {
  const url = process.env.WAYMOND_PROXY_URL?.trim();
  return url || null;
}

async function transcribeViaProxy(samples, sampleRate) {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    return null;
  }

  const endpoint = `${proxyUrl.replace(/\/$/, "")}/transcribe`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      samples,
      sampleRate,
      model: DEFAULT_MODEL,
      language: "en",
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Proxy request failed (${response.status})`);
  }

  return (payload.text ?? "").trim();
}

module.exports = {
  getProxyUrl,
  transcribeViaProxy,
};
