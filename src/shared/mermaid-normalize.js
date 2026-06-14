const MERMAID_HEADER_RE =
  /^((?:graph|flowchart)\s+(?:TD|TB|BT|RL|LR))\b/i;

const MERMAID_FENCE_RE = /```\s*mermaid\b\s*([\s\S]*?)```/gi;

function normalizeDiagramCode(raw) {
  let code = String(raw ?? "").trim();
  if (!code) return "";

  code = code.replace(/^```(?:\s*mermaid)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  code = code.replace(/^mermaid(?=(?:graph|flowchart)\b)/i, "");
  code = code.replace(/^mermaid\s+/i, "");

  if (!MERMAID_HEADER_RE.test(code)) {
    if (/^[A-Za-z_\[]/.test(code) && /(-->|---)/.test(code)) {
      code = `graph TD\n${code}`;
    } else {
      return code;
    }
  }

  const headerMatch = code.match(/^((?:graph|flowchart)\s+(?:TD|TB|BT|RL|LR))\b/i);
  if (!headerMatch) return code.trim();

  const header = headerMatch[1];
  let body = code.slice(headerMatch[0].length);
  body = body.replace(/^[ \t]*\r?\n/, "").replace(/\s+$/, "");
  if (!body) return header;

  if (!body.includes("\n") && body.includes(";")) {
    body = body
      .split(/\s*;\s*/)
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n");
  }

  if (/^[A-Za-z_\[]/.test(body)) {
    body = sanitizeMermaidLabelSyntax(body);
    return `${header}\n${body}`.trim();
  }

  body = sanitizeMermaidLabelSyntax(body);
  return `${header}\n${body}`.trim();
}

function sanitizeMermaidLabelSyntax(body) {
  let result = String(body ?? "");

  result = result.replace(
    /(^|[\n\s])([A-Za-z][\w]*)\(([^()"']+)\)/gm,
    (match, prefix, id, label) => {
      const trimmed = label.trim();
      if (trimmed && /[,&]/.test(trimmed)) {
        const escaped = trimmed.replace(/"/g, "#quot;");
        return `${prefix}${id}("${escaped}")`;
      }
      return match;
    },
  );

  result = result.replace(
    /(^|[\n\s])([A-Za-z][\w]*)\[([^\]"]+)\]/gm,
    (match, prefix, id, label) => {
      if (/[,&]/.test(label)) {
        const escaped = label.replace(/"/g, "#quot;");
        return `${prefix}${id}["${escaped}"]`;
      }
      return match;
    },
  );

  return result;
}

function extractMermaidFromText(text) {
  const source = String(text ?? "").trim();
  if (!source) {
    return { diagramCode: "", explanation: "" };
  }

  let working = source.replace(
    MERMAID_FENCE_RE,
    (_match, diagram) => `\`\`\`mermaid\n${normalizeDiagramCode(diagram)}\n\`\`\``,
  );

  const fencedMatch = /```\s*mermaid\b\s*([\s\S]*?)```/i.exec(working);
  if (fencedMatch) {
    const diagramCode = normalizeDiagramCode(fencedMatch[1]);
    const explanation = working
      .replace(/```\s*mermaid\b\s*[\s\S]*?```/i, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { diagramCode, explanation };
  }

  const inline = working.match(
    /(?:^|\n)\s*mermaid\s*((?:graph|flowchart)\s+(?:TD|TB|BT|RL|LR)\b[\s\S]*?)(?=\n*$)/i,
  );
  if (inline) {
    const diagramCode = normalizeDiagramCode(inline[1]);
    const explanation = working.replace(inline[0], "").replace(/\n{3,}/g, "\n\n").trim();
    return { diagramCode, explanation };
  }

  const bare = working.match(
    /(?:^|\n)\s*((?:graph|flowchart)\s+(?:TD|TB|BT|RL|LR)\b[\s\S]*?)(?=\n*$)/i,
  );
  if (bare && /(-->|---)/.test(bare[1])) {
    const diagramCode = normalizeDiagramCode(bare[1]);
    const explanation = working.replace(bare[0], "").replace(/\n{3,}/g, "\n\n").trim();
    return { diagramCode, explanation };
  }

  return { diagramCode: "", explanation: source };
}

module.exports = {
  MERMAID_FENCE_RE,
  normalizeDiagramCode,
  extractMermaidFromText,
};
