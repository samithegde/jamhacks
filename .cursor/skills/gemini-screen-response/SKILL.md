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
      "description": "A clean, concise 1-sentence vocal instruction."
    },
    "plan": {
      "type": "ARRAY",
      "description": "A set of sequential actions to execute on the screen.",
      "items": {
        "type": "OBJECT",
        "properties": {
          "x": {
            "type": "INTEGER",
            "description": "The exact absolute X coordinate of the top-left corner of the item."
          },
          "y": {
            "type": "INTEGER",
            "description": "The exact absolute Y coordinate of the top-left corner of the item."
          },
          "w": {
            "type": "INTEGER",
            "description": "The width of the item in pixels."
          },
          "h": {
            "type": "INTEGER",
            "description": "The height of the item in pixels."
          },
          "label": {
            "type": "STRING",
            "description": "The short description or name of the button."
          }
        },
        "required": ["x", "y", "w", "h", "label"]
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

Parse the model text as JSON. Validate `explanation` (string) and `plan` (array). Each plan item must have integer `x`, `y`, `w`, `h` and string `label`.

## Field usage in this app

| Field | Purpose |
|-------|---------|
| `explanation` | Shown in chat and read aloud via desktop TTS (`speechSynthesis`) |
| `plan` | Ordered screen actions executed after the reply |

## Plan execution

For each item in `plan`, in order:

1. `window.aiTools.moveCursor({ x, y, animate: true, duration: 350 })`
2. `window.aiTools.highlightRect({ x, y, width: w, height: h, duration: 5000 })`

Coordinates are absolute display pixels matching the attached screenshot. An empty `plan` array is valid when no on-screen guidance is needed.

## System prompt guidance

Tell the model to:

- Use the attached screenshot to locate UI elements
- Return pixel-accurate bounding boxes for each target
- Keep `explanation` to one spoken sentence
- Order `plan` steps in the sequence the user should follow
