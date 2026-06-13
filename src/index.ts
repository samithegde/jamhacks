export interface Env {
  GROQ_API_KEY: string;
  ALLOWED_ORIGIN?: string;
}

interface TranscribeJsonBody {
  samples?: number[];
  sampleRate?: number;
  model?: string;
  language?: string;
}

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-large-v3-turbo";

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(
  env: Env,
  body: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(env),
      "Content-Type": "application/json",
    },
  });
}

function encodeWav(samples: number[], sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

async function transcribeWithGroq(
  apiKey: string,
  audio: Blob,
  model: string,
  language?: string
): Promise<{ text?: string }> {
  const form = new FormData();
  form.append("file", audio, "audio.wav");
  form.append("model", model);
  form.append("response_format", "json");
  if (language) {
    form.append("language", language);
  }

  const response = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  const payload = await response.text();
  if (!response.ok) {
    throw new Error(`Groq API error ${response.status}: ${payload}`);
  }

  return JSON.parse(payload) as { text?: string };
}

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  if (!env.GROQ_API_KEY) {
    return jsonResponse(env, { error: "GROQ_API_KEY not configured" }, 500);
  }

  const contentType = request.headers.get("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as TranscribeJsonBody;
    const samples = body.samples;
    const sampleRate = Number(body.sampleRate ?? 16000);
    const model = body.model ?? DEFAULT_MODEL;

    if (!Array.isArray(samples) || samples.length === 0) {
      return jsonResponse(env, { error: "samples array is required" }, 400);
    }

    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      return jsonResponse(env, { error: "sampleRate must be a positive number" }, 400);
    }

    const wav = encodeWav(samples, sampleRate);
    const audio = new Blob([wav], { type: "audio/wav" });
    const result = await transcribeWithGroq(
      env.GROQ_API_KEY,
      audio,
      model,
      body.language
    );

    return jsonResponse(env, { text: (result.text ?? "").trim() });
  }

  if (contentType.includes("multipart/form-data")) {
    const incoming = await request.formData();
    const form = new FormData();

    for (const [key, value] of incoming.entries()) {
      form.append(key, value);
    }

    if (!form.has("model")) {
      form.append("model", DEFAULT_MODEL);
    }
    if (!form.has("response_format")) {
      form.append("response_format", "json");
    }

    const response = await fetch(GROQ_TRANSCRIBE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: form,
    });

    const payload = await response.text();
    return new Response(payload, {
      status: response.status,
      headers: {
        ...corsHeaders(env),
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  return jsonResponse(
    env,
    { error: "Use application/json or multipart/form-data" },
    415
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const headers = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (request.method === "POST" && url.pathname === "/transcribe") {
      try {
        return await handleTranscribe(request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Transcription failed";
        return jsonResponse(env, { error: message }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(env, {
        status: "ok",
        service: "waymond-proxy",
        groqConfigured: Boolean(env.GROQ_API_KEY),
      });
    }

    return new Response("Waymond Proxy Engine Online", {
      status: 200,
      headers,
    });
  },
};
