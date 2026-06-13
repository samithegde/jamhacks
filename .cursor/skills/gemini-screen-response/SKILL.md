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
          "markId": {
            "type": "INTEGER",
            "description": "The numbered Set-of-Mark box that best matches the target."
          },
          "x": {
            "type": "INTEGER",
            "description": "Legacy fallback absolute X coordinate when no mark catalog is available."
          },
          "y": {
            "type": "INTEGER",
            "description": "Legacy fallback absolute Y coordinate when no mark catalog is available."
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

Parse the model text as JSON. Validate `explanation` (string) and `plan` (array). Each plan item must include `action`, `description` (or legacy `label`), and either a Set-of-Mark `markId` or legacy integer `x` and `y`. For legacy `highlight`, also require integer `w` and `h`.

## Field usage in this app

| Field | Purpose |
|-------|---------|
| `explanation` | Shown in chat and read aloud via desktop TTS (`speechSynthesis`) |
| `plan` | Ordered screen actions executed after the reply |
| `markId` | Preferred coarse localization target, resolved against the mark catalog before refine |

## Plan execution

For each item in `plan`, execute by `action`:

- `cursor`: resolve `markId` to the mark center, then call `window.aiTools.moveCursor({ x, y, description, stepIndex, stepTotal, animate: true, duration: 350 })`.
- `highlight`: resolve `markId` to the mark bbox, move the cursor to its center, then call `window.aiTools.highlightRect({ x, y, width: w, height: h })`.

When a mark catalog is present, `markId` is preferred and legacy coordinates are only a rollout fallback. An empty `plan` array is valid when no on-screen guidance is needed.

## System prompt guidance

Tell the model to:

- Default to `plan: []`; only add actions when the user needs on-screen pointer/highlight guidance.
- Use `plan: []` for greetings, general Q&A, definitions, summaries, confirmations, and any reply fully understandable from speech alone.
- When `plan` is non-empty and the screenshot is annotated, pick the numbered `markId` whose box best matches the target. Do not invent coordinates.
- Keep `explanation` concise; one sentence for guided steps, slightly longer allowed when `plan` is empty.
- Order `plan` steps in the sequence the user should follow.
- Use `cursor` for guidance movement and `highlight` for box emphasis.
- Treat `description` as the primary field for what the pointer is targeting.
