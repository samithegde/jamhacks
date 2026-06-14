---
name: gemini-screen-response
description: Defines the structured JSON schema for Gemini screen-assistant responses in Jamhacks26. Use when configuring Gemini generateContent, parsing AI replies, wiring TTS for explanation, or executing plan actions from screen context.
---

# Gemini Screen Response Schema

Jamhacks26 expects every Gemini reply to be structured JSON, not free-form text. Apply this schema when editing `src/main/gemini/service.js`, chat response handling, or overlay action execution.

## Response schema

Use this as `generationConfig.responseSchema` with `generationConfig.responseMimeType: "application/json"`:

```json
{
  "type": "OBJECT",
  "properties": {
    "explanation": {
      "type": "STRING",
      "description": "A clean, concise vocal instruction/description."
    },
    "plan": {
      "type": "ARRAY",
      "description": "Ordered on-screen actions. Return [] when no pointer or highlight is needed.",
      "items": {
        "type": "OBJECT",
        "properties": {
          "action": {
            "type": "STRING",
            "description": "Either 'cursor' (guidance pointer) or 'highlight' (rectangular emphasis)."
          },
          "bbox": {
            "type": "ARRAY",
            "description": "Normalized bounding box [ymin, xmin, ymax, xmax] on 0-1000 scale."
          },
          "x": {
            "type": "INTEGER",
            "description": "Legacy fallback absolute X coordinate."
          },
          "y": {
            "type": "INTEGER",
            "description": "Legacy fallback absolute Y coordinate."
          },
          "w": {
            "type": "INTEGER",
            "description": "Legacy fallback width for action='highlight'."
          },
          "h": {
            "type": "INTEGER",
            "description": "Legacy fallback height for action='highlight'."
          },
          "description": {
            "type": "STRING",
            "description": "What the cursor is pointing at, shown in the widget beside the pointer."
          },
          "label": {
            "type": "STRING",
            "description": "Legacy alias for description."
          },
          "isFinal": {
            "type": "BOOLEAN",
            "description": "True when this is the last on-screen action for the user's goal."
          }
        },
        "required": ["action", "description"]
      }
    }
  },
  "required": ["explanation", "plan"]
}
```

## Gemini API wiring

In `src/main/gemini/service.js`, pass the schema via `generationConfig`:

```javascript
generationConfig: {
  responseMimeType: "application/json",
  responseSchema: RESPONSE_SCHEMA,
}
```

Parse the model text as JSON. Validate `explanation` (string) and `plan` (array). Each plan item must include `action`, `description` (or legacy `label`), and either a `bbox` array `[ymin, xmin, ymax, xmax]` on 0–1000 scale or legacy integer `x` and `y`. For legacy `highlight`, also require integer `w` and `h`.

## Field usage in this app

| Field | Purpose |
|-------|---------|
| `explanation` | Shown in chat and read aloud via desktop TTS (`speechSynthesis`) |
| `plan` | Ordered screen actions executed after the reply |
| `bbox` | Coarse target region from Gemini; converted to CSS pixels before Moondream/OCR refine |

## Plan execution

Pipeline: **Text → Gemini (bbox %) → crop → OCR (text) / Moondream → Cursor**

For each item in `plan`, execute by `action`:

- `cursor`: resolve `bbox` to a CSS box, crop with padding, refine with OCR (text targets) or Moondream, then call `window.aiTools.moveCursor({ x, y, description, stepIndex, stepTotal, animate: true, duration: 350 })`.
- `highlight`: resolve `bbox` to a CSS rectangle, refine center, move cursor there, then call `window.aiTools.highlightRect({ x, y, width: w, height: h })`.

An empty `plan` array is valid when no on-screen guidance is needed.

## System prompt guidance

Tell the model to:

- Default to `plan: []`; only add actions when the user needs on-screen pointer/highlight guidance.
- Use `plan: []` for greetings, general Q&A, definitions, summaries, confirmations, and any reply fully understandable from speech alone.
- When `plan` is non-empty, return `bbox` as `[ymin, xmin, ymax, xmax]` on a 0–1000 scale tightly framing the target element.
- Keep `explanation` concise; one sentence for guided steps, slightly longer allowed when `plan` is empty.
- Order `plan` steps in the sequence the user should follow.
- Use `cursor` for guidance movement and `highlight` for box emphasis.
- Treat `description` as the primary field for what the pointer is targeting.

## Tutor mode (`mode: "tutor"`)

When tutor mode is active via the chat header toggle:

- Use `TUTOR_SYSTEM_PROMPT` in `src/main/gemini/service.js` instead of the navigation prompt.
- `explanation` may include a markdown ` ```mermaid ` fenced block for concept diagrams (rendered in chat, stripped before TTS).
- Prefer `action: "highlight"` over `cursor` for on-screen study emphasis.
- Default `plan: []` for abstract concept questions with no on-screen referent.
- RAG retrieval prefers the `study` collection under `docs/study/`.
- Renderer executes highlights via `executeTutorVisuals()` (no Next/Complete loop); annotations persist until the next tutor answer or `/clear`.

## Tutor learning widget (`mode: "tutor"`)

Tutor mode also returns a first-class `widget` object on `chat:send` (see `src/main/ai/learning-widget-schema.js`):

```json
{
  "explanation": "Spoken and chat-visible explanation (no mermaid fences when diagramCode is set).",
  "diagramCode": "Raw Mermaid syntax for the overlay learning panel.",
  "highlights": [
    {
      "id": "h0",
      "bbox": [ymin, xmin, ymax, xmax],
      "label": "Short label for the highlighted UI element"
    }
  ]
}
```

Provider behavior:

- **Gemini**: existing `{ explanation, plan }` reply is adapted via `adaptGeminiToLearningWidget()` (mermaid extracted from explanation; highlight plan items mapped to `highlights`).
- **Ollama**: `generateObject` + Zod in `src/main/ai/tutor.js` produces the widget directly.

Renderer behavior:

- Overlay panel: `window.aiTools.showLearningWidget(widget)` → `ai:learning-widget:show` on overlay windows (`src/renderer/modules/learning-widget.js`).
- Chat bubble shows `widget.explanation` only when `widget.diagramCode` is present (diagram renders in overlay, not duplicated in chat).
- `highlightsToPlan(widget.highlights)` feeds `executeTutorVisuals()` for indigo tutor annotations.
- `/clear` and tutor toggle off call `hideLearningWidget()` and clear annotations.
