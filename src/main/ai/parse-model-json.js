function extractJsonCandidate(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  const tryParse = (candidate) => {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    const fenced = tryParse(fenceMatch[1].trim());
    if (fenced) return fenced;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const slice = trimmed.slice(start, end + 1);
    const sliced = tryParse(slice);
    if (sliced) return sliced;

    const withoutTrailingCommas = slice.replace(/,\s*([}\]])/g, "$1");
    const repaired = tryParse(withoutTrailingCommas);
    if (repaired) return repaired;
  }

  return null;
}

function parseJsonFromModelText(text, { label = "Model" } = {}) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    const preview = String(text || "").trim().slice(0, 280);
    throw new Error(
      `${label} returned invalid JSON${preview ? `: ${preview}` : "."}`,
    );
  }

  return {
    parsed: JSON.parse(candidate),
    text: candidate,
  };
}

module.exports = {
  extractJsonCandidate,
  parseJsonFromModelText,
};
