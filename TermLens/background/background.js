// Background service worker for TermLens extension

// Default settings (pre-configured from .env)
const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "",
  theme: "dark",
  fetchedModels: [],
  lastFetchTime: 0,
};

const OPENROUTER_FREE_MODELS_URL =
  "https://openrouter.ai/api/frontend/models/find?order=latency-low-to-high&q=free";

// Initialize settings on install
chrome.runtime.onInstalled.addListener(async () => {
  // Settings in sync storage
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

  // Initial fetch
  await fetchFreeModels();
});

// Check if we need to fetch models on startup
chrome.runtime.onStartup.addListener(async () => {
  await checkAndFetchModels();
});

// Helper to check 2-day threshold
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

// Function to fetch free models from OpenRouter
async function fetchFreeModels() {
  try {
    const response = await fetch(OPENROUTER_FREE_MODELS_URL);
    if (!response.ok) throw new Error("Failed to fetch models");

    const result = await response.json();
    const models = result.data?.models || [];

    const processedModels = models.map((m) => ({
      value: m?.endpoint?.model_variant_slug || m.slug,
      label: m.short_name || m.name,
    }));

    if (processedModels.length > 0) {
      await chrome.storage.local.set({
        fetchedModels: processedModels,
        lastFetchTime: Date.now(),
      });

      // If no model is selected, set it to the first fetched model
      // Or if current model is not custom and NOT in the new fetched list, reset to first fetched
      const { model, customModels } = await chrome.storage.sync.get([
        "model",
        "customModels",
      ]);

      const isCustomModel = (customModels || []).some((m) => m.value === model);
      const isStillInFreeList = processedModels.some((m) => m.value === model);

      if (!model || (!isCustomModel && !isStillInFreeList)) {
        await chrome.storage.sync.set({ model: processedModels[0].value });
        // console.log("TermLens: Model reset to", processedModels[0].value);
      }
      // console.log("TermLens: Models updated", processedModels.length);
    }
  } catch (error) {
    console.error("TermLens: Error fetching models:", error);
  }
}

// Handle messages from content script
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

// Stream explanation for selected text
async function handleStreamingExplanation(
  popupId,
  text,
  context,
  nearestHeading,
  pageTitle,
  pageDomain,
  tabId,
) {
  const settings = await chrome.storage.sync.get(["apiKey", "model"]);

  if (!settings.apiKey) {
    sendStreamUpdate(tabId, popupId, {
      type: "error",
      error:
        "API key not configured. Click the extension icon to add your OpenRouter API key.",
    });
    return;
  }

  // Build context-aware system prompt
  const systemPrompt = `You are a helpful research assistant. When given a term or phrase, provide a clear, concise explanation in 2-3 sentences. Focus on the most essential information.

Use the provided context to give a more relevant, domain-specific explanation. The context includes:
- The webpage title and domain (helps identify the topic/field)
- The section heading (helps understand the specific subtopic)
- Surrounding paragraph text (provides immediate context)

Format your response as:
- Start with a brief definition relevant to the context
- Add one key insight or important detail
- Keep it under 80 words`;

  // Build user prompt with all context
  let userPrompt = `Explain this term/phrase: "${text}"`;

  // Add page context
  if (pageTitle || pageDomain) {
    userPrompt += `\n\n**Page Context:**`;
    if (pageTitle) userPrompt += `\n- Page Title: "${pageTitle}"`;
    if (pageDomain) userPrompt += `\n- Domain: ${pageDomain}`;
  }

  // Add section heading
  if (nearestHeading) {
    userPrompt += `\n- Section: "${nearestHeading}"`;
  }

  // Add surrounding text context
  if (context && context !== text) {
    userPrompt += `\n\n**Surrounding Text:**\n"${context}"`;
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  // Log to service worker console
  // console.log('=== OpenRouter API Request (Explanation) ===');
  // console.log('Model:', settings.model);
  // console.log('Messages:', JSON.stringify(messages, null, 2));

  // Send to content script for website console
  chrome.tabs
    .sendMessage(tabId, {
      action: "debugPrompt",
      type: "explanation",
      model: settings.model,
      messages: messages,
    })
    .catch(() => {});

  await streamOpenRouter(
    settings.apiKey,
    settings.model,
    messages,
    tabId,
    popupId,
    "explanation",
  );
}

// Stream chat conversation
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
  const settings = await chrome.storage.sync.get(["apiKey", "model"]);

  if (!settings.apiKey) {
    sendStreamUpdate(tabId, popupId, {
      type: "error",
      error: "API key not configured.",
    });
    return;
  }

  // Build comprehensive system prompt with all context (never gets trimmed)
  let systemPrompt = `You are a knowledgeable research assistant helping someone understand a specific topic.

**Original Query Context:**
- Selected Text: "${selectedText}"`;

  // Add page context
  if (pageTitle || pageDomain) {
    if (pageTitle) systemPrompt += `\n- Page Title: "${pageTitle}"`;
    if (pageDomain) systemPrompt += `\n- Domain: ${pageDomain}`;
  }

  // Add section heading
  if (nearestHeading) {
    systemPrompt += `\n- Section: "${nearestHeading}"`;
  }

  // Add surrounding text context
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

  const formattedMessages = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  // Log to service worker console
  // console.log('=== OpenRouter API Request (Chat) ===');
  // console.log('Model:', settings.model);
  // console.log('Messages:', JSON.stringify(formattedMessages, null, 2));

  // Send to content script for website console
  chrome.tabs
    .sendMessage(tabId, {
      action: "debugPrompt",
      type: "chat",
      model: settings.model,
      messages: formattedMessages,
    })
    .catch(() => {});

  await streamOpenRouter(
    settings.apiKey,
    settings.model,
    formattedMessages,
    tabId,
    popupId,
    "chat",
  );
}

// Stream from OpenRouter API
async function streamOpenRouter(
  apiKey,
  model,
  messages,
  tabId,
  popupId,
  messageType,
) {
  try {
    sendStreamUpdate(tabId, popupId, { type: "start", messageType });

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "chrome-extension://termlens",
          "X-Title": "TermLens",
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          // Use 500 for quick explanation, 2000 for deep dive chat (allow longer responses)
          max_tokens: messageType === "chat" ? 2000 : 500,
          temperature: 0.7,
          stream: true, // Enable streaming!
        }),
      },
    );

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

      // Process complete SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine || !trimmedLine.startsWith("data: ")) continue;

        const data = trimmedLine.slice(6); // Remove 'data: ' prefix

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
          const delta = parsed.choices?.[0]?.delta?.content;

          if (delta) {
            // Trim leading whitespace only if fullContent is still empty
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
          // Skip malformed JSON chunks
          // console.log('Skipping malformed chunk:', data);
        }
      }
    }
  } catch (error) {
    console.error("Streaming error:", error);
    sendStreamUpdate(tabId, popupId, {
      type: "error",
      error: error.message,
      messageType,
    });
  }
}

// Send stream update to content script (with popupId for targeting)
function sendStreamUpdate(tabId, popupId, data) {
  chrome.tabs
    .sendMessage(tabId, { action: "streamUpdate", popupId, ...data })
    .catch(() => {
      // Tab might be closed, ignore error
    });
}
