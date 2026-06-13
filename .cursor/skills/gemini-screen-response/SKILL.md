---
name: gemini-screen-response
description: Defines the structured JSON schema for Gemini screen-assistant responses in Jamhacks26. Use when configuring Gemini generateContent, parsing AI replies, wiring TTS for explanation, or executing plan actions (cursor move + highlight) from screen context.
---

# Gemini Screen Response Schema

Jamhacks26 expects every Gemini reply to be structured JSON — not free-form text. Apply this schema when editing `src/main/gemini/service.js`, chat response handling, or overlay action execution.

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
          "x": {
            "type": "INTEGER",
            "description": "The exact absolute X coordinate in display pixels."
          },
          "y": {
            "type": "INTEGER",
            "description": "The exact absolute Y coordinate in display pixels."
          },
          "w": {
            "type": "INTEGER",
            "description": "The width in pixels (required when action='highlight')."
          },
          "h": {
            "type": "INTEGER",
            "description": "The height in pixels (required when action='highlight')."
          },
          "description": {
            "type": "STRING",
            "description": "What the cursor is pointing at — shown in the widget beside the pointer."
          },
          "label": {
            "type": "STRING",
            "description": "Legacy alias for description."
          }
        },
        "required": ["action", "x", "y", "description"]
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
  responseSchema: RESPONSE_SCHEMA, // object above
}
```

Parse the model text as JSON. Validate `explanation` (string) and `plan` (array). Each plan item must include `action`, integer `x` and `y`, and string `description` (or legacy `label`). For `highlight`, also require integer `w` and `h`.

## Field usage in this app

| Field | Purpose |
|-------|---------|
| `explanation` | Shown in chat and read aloud via desktop TTS (`speechSynthesis`) |
| `plan` | Ordered screen actions executed after the reply |

## Plan execution

For each item in `plan`, in order:

For each item in `plan`, execute by `action`:

- `cursor`: `window.aiTools.moveCursor({ x, y, description, stepIndex, stepTotal, animate: true, duration: 350 })` — shows a widget beside the cursor with the target description.
- `highlight`: move cursor to the target center with `description`, then `window.aiTools.highlightRect({ x, y, width: w, height: h, duration: 5000 })`

Coordinates are absolute display pixels matching the attached screenshot. An empty `plan` array is valid when no on-screen guidance is needed.

## System prompt guidance

Tell the model to:

- **Default to `plan: []`** — only add actions when the user needs on-screen pointer/highlight guidance (navigation, "show me where", click/find/highlight requests, step-by-step UI walkthroughs)
- Use `plan: []` for greetings, general Q&A, definitions, summaries, confirmations, and any reply fully understandable from speech alone
- When `plan` is non-empty, use the attached screenshot to locate UI elements and return pixel-accurate coordinates
- Keep `explanation` concise; one sentence for guided steps, slightly longer allowed when `plan` is empty
- Order `plan` steps in the sequence the user should follow
- Use `cursor` for guidance movement and `highlight` for box emphasis
- `label` fields may use markdown (`**bold**`, lists, `` `code` ``, links) for the on-screen widget
- `description` is the primary field for what the pointer is targeting
