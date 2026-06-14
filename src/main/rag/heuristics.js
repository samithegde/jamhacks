const UI_ACTION_PATTERN =
  /^(click|tap|press|select|highlight|open|go to|navigate to|scroll to|find the|show me where|move to)\b/i;

const HOW_TO_UI_PATTERN =
  /\b(how do i|how to|walk me through|show me how|guide me through)\b/i;

const DOC_KEYWORD_PATTERN =
  /\b(policy|policies|document|documents|wiki|handbook|manual|according to|form using|knowledge base|procedure|guidelines|reference doc|from the doc|company|hr|benefits|vacation|compliance)\b/i;

const LIBRARY_KEYWORD_PATTERN =
  /\b(react|vue|angular|next\.?js|nuxt|svelte|typescript|javascript|npm|node\.?js|api|sdk|tailwind|figma|supabase|mongodb|prisma|electron|gemini|openai|library|framework|package|documentation)\b/i;

function inferLibraryName(text) {
  const match = text.match(
    /\b(react|vue|angular|next\.?js|nuxt|svelte|typescript|tailwind|figma|supabase|mongodb|prisma|electron|gemini|vscode|google docs)\b/i,
  );
  return match ? match[1] : undefined;
}

function inferRetrievalSource(text) {
  if (LIBRARY_KEYWORD_PATTERN.test(text) && !DOC_KEYWORD_PATTERN.test(text)) {
    return "context7";
  }
  return "web";
}

/**
 * Fast-path intent routing without an LLM call.
 * @returns {{ skip: boolean, plan?: object }}
 */
function routeIntentHeuristic(userText) {
  const text = String(userText || "").trim();
  if (!text) {
    return { skip: false };
  }

  if (DOC_KEYWORD_PATTERN.test(text) || LIBRARY_KEYWORD_PATTERN.test(text)) {
    const retrievalSource = inferRetrievalSource(text);
    return {
      skip: true,
      plan: {
        requiresRag: true,
        query: text,
        ragQuery: text,
        intent: text,
        needsOnScreenGuidance: true,
        retrievalSource,
        libraryName: retrievalSource === "context7" ? inferLibraryName(text) : undefined,
      },
    };
  }

  if (UI_ACTION_PATTERN.test(text) && !DOC_KEYWORD_PATTERN.test(text)) {
    return {
      skip: true,
      plan: {
        requiresRag: false,
        query: "",
        ragQuery: "",
        intent: text,
        needsOnScreenGuidance: true,
      },
    };
  }

  if (
    HOW_TO_UI_PATTERN.test(text) &&
    !DOC_KEYWORD_PATTERN.test(text) &&
    !LIBRARY_KEYWORD_PATTERN.test(text)
  ) {
    return {
      skip: true,
      plan: {
        requiresRag: true,
        query: text,
        ragQuery: text,
        intent: text,
        needsOnScreenGuidance: true,
        retrievalSource: "web",
      },
    };
  }

  return { skip: false };
}

module.exports = {
  routeIntentHeuristic,
  UI_ACTION_PATTERN,
  DOC_KEYWORD_PATTERN,
  LIBRARY_KEYWORD_PATTERN,
  inferRetrievalSource,
  inferLibraryName,
};
