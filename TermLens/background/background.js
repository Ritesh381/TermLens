// Background service worker for TermLens extension

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKEND_URL = "https://termlens-backend.vercel.app/";
const SUPABASE_KEY = "sb_publishable_zWRBSm9ANHsVQvtcdAg3yg_dydoKGMy";
const SUPABASE_URL = "https://muzxmpphoqprtxobxdrw.supabase.co";
const SUPABASE_MODELS_URL = `${SUPABASE_URL}/rest/v1/models?select=name,slug`;

// Default settings
const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "",
  theme: "dark-purple",
  fetchedModels: [],
  lastFetchTime: 0,
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// Initialize settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const existingSettings = await chrome.storage.sync.get([
    "apiKey",
    "model",
    "theme",
    "customModels",
  ]);

  const settings = {
    apiKey: existingSettings.apiKey || DEFAULT_SETTINGS.apiKey,
    model: existingSettings.model || DEFAULT_SETTINGS.model,
    theme: existingSettings.theme || DEFAULT_SETTINGS.theme,
    customModels: existingSettings.customModels || [],
  };

  await chrome.storage.sync.set(settings);

  // Models in local storage
  const existingLocal = await chrome.storage.local.get([
    "fetchedModels",
    "lastFetchTime",
  ]);

  if (!existingLocal.fetchedModels) {
    await chrome.storage.local.set({
      fetchedModels: DEFAULT_SETTINGS.fetchedModels,
      lastFetchTime: DEFAULT_SETTINGS.lastFetchTime,
    });
  }

  await fetchFreeModels();
});

// Check if we need to fetch models on startup
chrome.runtime.onStartup.addListener(async () => {
  await checkAndFetchModels();
});

// ---------------------------------------------------------------------------
// Model fetching
// ---------------------------------------------------------------------------

async function checkAndFetchModels() {
  const { lastFetchTime, fetchedModels } = await chrome.storage.local.get([
    "lastFetchTime",
    "fetchedModels",
  ]);
  const twoDaysInMs = 2 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  if (
    !lastFetchTime ||
    !fetchedModels ||
    fetchedModels.length === 0 ||
    now - lastFetchTime > twoDaysInMs
  ) {
    await fetchFreeModels();
  }
}

async function fetchFreeModels() {
  try {
    const response = await fetch(SUPABASE_MODELS_URL, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!response.ok) throw new Error(`Supabase error ${response.status}`);

    const rows = await response.json(); // [{ name, slug }, ...]
    const processedModels = rows
      .filter((r) => r.slug)
      .map((r) => ({ value: r.slug, label: r.name || r.slug }));

    if (processedModels.length > 0) {
      await _saveModels(processedModels);
      return;
    }
  } catch (error) {
    console.error("TermLens: Error fetching models from Supabase:", error);
  }

  // Supabase unreachable — keep whatever is already cached
  console.warn("TermLens: Could not refresh model list; using cached models.");
}

async function _saveModels(processedModels) {
  await chrome.storage.local.set({
    fetchedModels: processedModels,
    lastFetchTime: Date.now(),
  });

  const { model, customModels } = await chrome.storage.sync.get([
    "model",
    "customModels",
  ]);

  const isCustomModel = (customModels || []).some((m) => m.value === model);
  const isStillInFreeList = processedModels.some((m) => m.value === model);

  if (!model || (!isCustomModel && !isStillInFreeList)) {
    await chrome.storage.sync.set({ model: processedModels[0].value });
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getExplanation") {
    handleStreamingExplanation(
      request.popupId,
      request.text,
      request.context,
      request.nearestHeading,
      request.pageTitle,
      request.pageDomain,
      sender.tab.id,
    );
    sendResponse({ success: true, streaming: true });
    return true;
  }

  if (request.action === "chat") {
    handleStreamingChat(
      request.popupId,
      request.messages,
      request.selectedText,
      request.contextText,
      request.nearestHeading,
      request.pageTitle,
      request.pageDomain,
      sender.tab.id,
    );
    sendResponse({ success: true, streaming: true });
    return true;
  }

  if (request.action === "getSettings") {
    Promise.all([
      chrome.storage.sync.get([
        "apiKey",
        "model",
        "theme",
        "customModels",
        "scrollWithPage",
      ]),
      chrome.storage.local.get(["fetchedModels", "lastFetchTime"]),
    ])
      .then(([syncData, localData]) => {
        sendResponse({ success: true, data: { ...syncData, ...localData } });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "refreshModels") {
    fetchFreeModels()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Run check on script load as well
checkAndFetchModels();

// ---------------------------------------------------------------------------
// Routing helper — decides whether to use backend proxy or direct OpenRouter
// ---------------------------------------------------------------------------

/**
 * Returns { mode: "backend" | "direct", apiKey }
 * - autoMode true (default) → always use the TermLens backend proxy
 * - autoMode false + user has a key → call OpenRouter directly
 * - autoMode false + no key → error (handled in handlers below)
 */
function resolveRoute(settings) {
  const isAuto = settings.autoMode !== false; // default true
  if (isAuto) {
    return { mode: "backend", apiKey: null };
  }
  const key = (settings.apiKey || "").trim();
  return key
    ? { mode: "direct", apiKey: key }
    : { mode: "no-key", apiKey: null };
}

// ---------------------------------------------------------------------------
// Explanation handler
// ---------------------------------------------------------------------------

async function handleStreamingExplanation(
  popupId,
  text,
  context,
  nearestHeading,
  pageTitle,
  pageDomain,
  tabId,
) {
  const settings = await chrome.storage.sync.get([
    "apiKey",
    "model",
    "customInstructions",
    "autoMode",
  ]);

  const route = resolveRoute(settings);

  // Build system prompt
  let systemPrompt = `You are a helpful research assistant. When given a term or phrase, provide a clear, concise explanation in 2-3 sentences. Focus on the most essential information.

Use the provided context to give a more relevant, domain-specific explanation. The context includes:
- The webpage title and domain (helps identify the topic/field)
- The section heading (helps understand the specific subtopic)
- Surrounding paragraph text (provides immediate context)

Format your response as:
- Start with a brief definition relevant to the context
- Add one key insight or important detail
- Keep it under 80 words`;

  if (settings.customInstructions && settings.customInstructions.trim()) {
    systemPrompt += `\n\n**User's Custom Instructions:**\n${settings.customInstructions.trim()}`;
  }

  let userPrompt = `Explain this term/phrase: "${text}"`;

  if (pageTitle || pageDomain) {
    userPrompt += `\n\n**Page Context:**`;
    if (pageTitle) userPrompt += `\n- Page Title: "${pageTitle}"`;
    if (pageDomain) userPrompt += `\n- Domain: ${pageDomain}`;
  }

  if (nearestHeading) {
    userPrompt += `\n- Section: "${nearestHeading}"`;
  }

  if (context && context !== text) {
    userPrompt += `\n\n**Surrounding Text:**\n"${context}"`;
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  chrome.tabs
    .sendMessage(tabId, {
      action: "debugPrompt",
      type: "explanation",
      model: settings.model,
      messages,
    })
    .catch(() => {});

  await streamRequest(
    route,
    settings.model,
    messages,
    tabId,
    popupId,
    "explanation",
  );
}

// ---------------------------------------------------------------------------
// Chat handler
// ---------------------------------------------------------------------------

async function handleStreamingChat(
  popupId,
  messages,
  selectedText,
  contextText,
  nearestHeading,
  pageTitle,
  pageDomain,
  tabId,
) {
  const settings = await chrome.storage.sync.get([
    "apiKey",
    "model",
    "customInstructions",
    "autoMode",
  ]);

  const route = resolveRoute(settings);

  let systemPrompt = `You are a knowledgeable research assistant helping someone understand a specific topic.

**Original Query Context:**
- Selected Text: "${selectedText}"`;

  if (pageTitle || pageDomain) {
    if (pageTitle) systemPrompt += `\n- Page Title: "${pageTitle}"`;
    if (pageDomain) systemPrompt += `\n- Domain: ${pageDomain}`;
  }

  if (nearestHeading) {
    systemPrompt += `\n- Section: "${nearestHeading}"`;
  }

  if (contextText && contextText !== selectedText) {
    systemPrompt += `\n- Surrounding Text: "${contextText}"`;
  }

  systemPrompt += `

Your role:
- Answer questions thoroughly but concisely
- Use examples when helpful
- If asked to elaborate, provide more detail
- Stay focused on helping them understand the topic
- Be conversational and helpful`;

  if (settings.customInstructions && settings.customInstructions.trim()) {
    systemPrompt += `\n\n**User's Custom Instructions:**\n${settings.customInstructions.trim()}`;
  }

  const formattedMessages = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  chrome.tabs
    .sendMessage(tabId, {
      action: "debugPrompt",
      type: "chat",
      model: settings.model,
      messages: formattedMessages,
    })
    .catch(() => {});

  await streamRequest(
    route,
    settings.model,
    formattedMessages,
    tabId,
    popupId,
    "chat",
  );
}

// ---------------------------------------------------------------------------
// Core streaming function — routes to backend or OpenRouter directly
// ---------------------------------------------------------------------------

async function streamRequest(
  route,
  model,
  messages,
  tabId,
  popupId,
  messageType,
) {
  try {
    sendStreamUpdate(tabId, popupId, { type: "start", messageType });

    // Guard: manual mode but no API key configured
    if (route.mode === "no-key") {
      sendStreamUpdate(tabId, popupId, {
        type: "error",
        error:
          "No API key configured. Open the extension popup, disable Automatic mode, and enter your OpenRouter API key.",
        messageType,
      });
      return;
    }

    let response;

    if (route.mode === "backend") {
      // ── Use TermLens backend proxy ──────────────────────────────────────
      response = await fetch(`${BACKEND_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: messageType === "chat" ? 2000 : 500,
          temperature: 0.7,
          stream: true,
        }),
      });
    } else {
      // ── Use user's own OpenRouter API key ───────────────────────────────
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${route.apiKey}`,
          "HTTP-Referer": "chrome-extension://termlens",
          "X-Title": "TermLens",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: messageType === "chat" ? 2000 : 500,
          temperature: 0.7,
          stream: true,
        }),
      });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || `API request failed: ${response.status}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        sendStreamUpdate(tabId, popupId, {
          type: "done",
          content: fullContent.trim(),
          messageType,
        });
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine || !trimmedLine.startsWith("data: ")) continue;

        const data = trimmedLine.slice(6);

        if (data === "[DONE]") {
          sendStreamUpdate(tabId, popupId, {
            type: "done",
            content: fullContent.trim(),
            messageType,
          });
          return;
        }

        try {
          const parsed = JSON.parse(data);

          // Handle error events forwarded from the backend
          if (parsed.error) {
            throw new Error(parsed.error);
          }

          const delta = parsed.choices?.[0]?.delta?.content;

          if (delta) {
            if (fullContent === "") {
              fullContent += delta.trimStart();
            } else {
              fullContent += delta;
            }

            if (fullContent !== "") {
              sendStreamUpdate(tabId, popupId, {
                type: "chunk",
                chunk: delta,
                content: fullContent,
                messageType,
              });
            }
          }
        } catch (e) {
          if (e.message && !e.message.includes("JSON")) {
            throw e; // Re-throw real errors, not JSON parse errors
          }
        }
      }
    }
  } catch (error) {
    console.error("TermLens streaming error:", error);
    sendStreamUpdate(tabId, popupId, {
      type: "error",
      error: error.message,
      messageType,
    });
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sendStreamUpdate(tabId, popupId, data) {
  chrome.tabs
    .sendMessage(tabId, { action: "streamUpdate", popupId, ...data })
    .catch(() => {
      // Tab might be closed, ignore error
    });
}
