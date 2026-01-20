// TermLens - Popup Script

// Default models list (minimal - user adds their own)

const DEFAULT_MODELS = [
  { value: "xiaomi/mimo-v2-flash:free", label: "Xiaomi MiMo V2 Flash (Free)" },
  {
    value: "mistralai/devstral-2512:free",
    label: "Mistral AI DevStral (Free)",
  },
  {
    value: "nex-agi/deepseek-v3.1-nex-n1:free",
    label: "DeepSeek V3.1 Nex N1 (Free)",
  },
  {
    value: "nvidia/nemotron-3-nano-30b-a3b:free",
    label: "Nvidia Nemotron 3 Nano 30B A3B (Free)",
  },
  {
    value: "nvidia/nemotron-nano-12b-v2-vl:free",
    label: "Nvidia Nemotron Nano 12B V2 VL (Free)",
  },
  {
    value: "tngtech/deepseek-r1t2-chimera:free",
    label: "DeepSeek R1T2 Chimera (Free)",
  },
  {
    value: "tngtech/deepseek-r1t-chimera:free",
    label: "DeepSeek R1T Chimera (Free)",
  },
  { value: "tngtech/tng-r1t-chimera:free", label: "TNG R1T Chimera (Free)" },
  { value: "deepseek/deepseek-r1-0528:free", label: "DeepSeek R1 0528 (Free)" },
  {
    value: "meta-llama/llama-3.3-70b-instruct:free",
    label: "Meta Llama 3.3 70B Instruct (Free)",
  },
  {
    value: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
    label: "Mistral 24B Venice Edition (Free)",
  },
  {
    value: "google/gemma-3-27b-it:free",
    label: "Google Gemma 3 27B IT (Free)",
  },
  {
    value: "google/gemini-2.0-flash-exp:free",
    label: "Google Gemini 2.0 Flash Exp (Free)",
  },
  {
    value: "google/gemma-3n-e2b-it:free",
    label: "Google Gemma 3N E2B IT (Free)",
  },
  { value: "openai/gpt-oss-120b:free", label: "OpenAI GPT OSS 120B (Free)" },
  { value: "openai/gpt-oss-20b:free", label: "OpenAI GPT OSS 20B (Free)" },
];

document.addEventListener("DOMContentLoaded", async () => {
  // Load version from manifest.json
  const manifest = chrome.runtime.getManifest();
  document.getElementById("version").textContent = `v${manifest.version}`;

  const apiKeyInput = document.getElementById("api-key");
  const modelSelect = document.getElementById("model-select");
  const toggleKeyBtn = document.getElementById("toggle-key");
  const statusIndicator = document.getElementById("status-indicator");
  const statusText = document.getElementById("status-text");
  const toast = document.getElementById("toast");
  const toastMessage = document.getElementById("toast-message");
  const scrollWithPageToggle = document.getElementById("scroll-with-page");
  // Theme Selection Elements
  const modeBtns = Array.from(document.querySelectorAll(".mode-btn"));
  const colorBtns = Array.from(document.querySelectorAll(".color-btn"));

  // Add model elements
  const addModelBtn = document.getElementById("add-model-btn");
  const addModelInputWrapper = document.getElementById(
    "add-model-input-wrapper",
  );
  const customModelInput = document.getElementById("custom-model-input");
  const customLabelInput = document.getElementById("custom-label-input");
  const validateBtn = document.getElementById("validate-btn");
  const cancelAddBtn = document.getElementById("cancel-add-btn");
  const validationStatus = document.getElementById("validation-status");
  const validationResult = document.getElementById("validation-result");

  // Custom models (stored in sync storage)
  let customModels = [];

  // Load saved settings
  await loadSettings();

  // Toggle API key visibility
  let keyVisible = false;
  toggleKeyBtn.addEventListener("click", () => {
    keyVisible = !keyVisible;
    apiKeyInput.type = keyVisible ? "text" : "password";
    toggleKeyBtn.querySelector("svg").style.opacity = keyVisible ? "1" : "0.5";
  });

  // Auto-save API key when typing stops (debounced)
  let apiKeySaveTimeout = null;
  apiKeyInput.addEventListener("input", () => {
    // Clear previous timeout
    if (apiKeySaveTimeout) {
      clearTimeout(apiKeySaveTimeout);
    }

    // Save after 500ms of no typing
    apiKeySaveTimeout = setTimeout(async () => {
      const apiKey = apiKeyInput.value.trim();
      if (apiKey) {
        await chrome.storage.sync.set({ apiKey });
        updateStatus(apiKey);
        showToast("API key saved", "success");
      } else {
        updateStatus("");
      }
    }, 500);
  });

  // Scroll with page toggle change
  scrollWithPageToggle.addEventListener("change", async () => {
    const scrollWithPage = scrollWithPageToggle.checked;
    await chrome.storage.sync.set({ scrollWithPage });
    showToast(
      scrollWithPage ? "Chat scrolls with page" : "Chat stays fixed",
      "success",
    );

    // Notify all tabs about the setting change
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs
          .sendMessage(tab.id, {
            action: "updateScrollWithPage",
            scrollWithPage: scrollWithPage,
          })
          .catch(() => {
            // Tab might not have content script loaded
          });
      });
    });
  });

  // Theme Selection Logic
  // Functions for theme selection logic

  // Load saved theme and set active states
  function setActiveTheme(themeStr) {
    if (!themeStr) themeStr = "default";

    // Parse theme string: 'light', 'dark', 'light-green', 'dark-green', etc.
    // 'default' implies 'dark-purple' (or whatever default is)
    // Actually, 'default' was purple. 'theme-light' was light base + purple.
    // Let's standardise:
    // Format: "mode-color" (e.g., "dark-purple", "light-green")
    // "default" maps to "dark-purple" to keep consistency if needed, or we just migrate to new format.

    let mode = "dark";
    let color = "purple";

    if (themeStr === "default") {
      mode = "dark";
      color = "purple";
    } else if (themeStr === "light") {
      mode = "light";
      color = "purple";
    } else if (themeStr === "dark") {
      mode = "dark";
      color = "purple";
    } else {
      // e.g., "green", "light-green", "dark-blue"
      // If it starts with light- or dark-, parse it
      if (themeStr.startsWith("light-")) {
        mode = "light";
        color = themeStr.replace("light-", "");
      } else if (themeStr.startsWith("dark-")) {
        mode = "dark";
        color = themeStr.replace("dark-", "");
      } else {
        // "green" -> implied dark green? or just color?
        // In previous step, "green" implied dark green (theme-green class).
        // Let's assume dark if not specified for colored themes from previous step
        mode = "dark";
        color = themeStr;
      }
    }

    // Update UI
    modeBtns.forEach((btn) => {
      if (btn.dataset.mode === mode) btn.classList.add("active");
      else btn.classList.remove("active");
    });

    colorBtns.forEach((btn) => {
      if (btn.dataset.color === color) btn.classList.add("active");
      else btn.classList.remove("active");
    });

    return { mode, color };
  }

  function getSelectedTheme() {
    // Find active element manually if querySelector fails or is stale
    const activeModeBtn = modeBtns.find((b) => b.classList.contains("active"));
    const activeColorBtn = colorBtns.find((b) =>
      b.classList.contains("active"),
    );

    const mode = activeModeBtn ? activeModeBtn.dataset.mode : "dark";
    const color = activeColorBtn ? activeColorBtn.dataset.color : "purple";

    // Construct theme string
    // logic:
    // dark + purple -> 'default' (or 'dark-purple')
    // light + purple -> 'light'
    // dark + color -> 'color' (e.g. 'green') - to match previous CSS classes like .theme-green
    // light + color -> 'light-color' (e.g. 'light-green') - NEED TO ADD CSS FOR THIS

    // Actually, let's simplify and make the CSS handle generic classes.
    // We will save valid theme strings that our CSS understands.
    // Our CSS currently has: .theme-light, .theme-dark (neutral), .theme-green, etc. (dark colored).
    // It does NOT have .theme-light-green.

    // To support the matrix (2 modes * 8 colors), we should update CSS.
    // BUT for now, let's map to existing classes where possible or simple combinations.

    // If we want FULL support as per UI, we need to pass both independently or standardise keys.
    // Let's standardise the SAVED value to be "mode-color" and update CSS to handle it.
    // OR, we keep it simple:
    // "theme-light" (light purple)
    // "theme-dark" (dark neutral? No, user wants dark purple as default)

    // Let's construct a cleaner ID: `${mode}-${color}`
    return `${mode}-${color}`;
  }

  // Event Listeners for Mode
  modeBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      // Toggle off others
      modeBtns.forEach((b) => b.classList.remove("active"));
      // Toggle on this one
      btn.classList.add("active");

      await updateThemeFromUI();
    });
  });

  // Event Listeners for Color
  colorBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      // Toggle off others
      colorBtns.forEach((b) => b.classList.remove("active"));
      // Toggle on this one
      btn.classList.add("active");

      await updateThemeFromUI();
    });
  });

  async function updateThemeFromUI() {
    const theme = getSelectedTheme();
    await chrome.storage.sync.set({ theme });
    applyTheme(theme);
    // showToast("Theme updated", "success"); // Optional, maybe too noisy

    // Notify info
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs
          .sendMessage(tab.id, { action: "updateTheme", theme })
          .catch(() => {});
      });
    });
  }

  function applyTheme(theme) {
    document.body.className = ""; // Clear

    const [mode, color] = theme.split("-");

    // We add two classes: one for mode, one for color
    // This requires CSS refactoring to separate concerns, or we map to specific class names
    // Let's iterate on CSS next. For now, let's add specific classes.
    document.body.classList.add(`mode-${mode}`);
    document.body.classList.add(`color-${color}`);

    // Fallback/Legacy support for the "defaults"
    if (mode === "light" && color === "purple")
      document.body.classList.add("theme-light");
    if (mode === "dark" && color === "purple")
      document.body.classList.add("theme-default");
  }

  // Add model button click
  addModelBtn.addEventListener("click", () => {
    addModelBtn.classList.add("hidden");
    addModelInputWrapper.classList.remove("hidden");
    customModelInput.focus();
    hideValidationResult();
  });

  // Cancel add model
  cancelAddBtn.addEventListener("click", () => {
    addModelInputWrapper.classList.add("hidden");
    addModelBtn.classList.remove("hidden");
    customModelInput.value = "";
    customLabelInput.value = "";
    hideValidationResult();
  });

  // Validate and add model
  validateBtn.addEventListener("click", () => validateAndAddModel());
  customModelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      customLabelInput.focus();
    }
    if (e.key === "Escape") {
      cancelAddBtn.click();
    }
  });
  customLabelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      validateAndAddModel();
    }
    if (e.key === "Escape") {
      cancelAddBtn.click();
    }
  });

  async function validateAndAddModel() {
    const modelName = customModelInput.value.trim();
    const modelLabel = customLabelInput.value.trim() || modelName;

    if (!modelName) {
      showValidationResult("Please enter a model name", "error");
      return;
    }

    // Check if model name already exists
    const allModels = [...DEFAULT_MODELS, ...customModels];
    if (allModels.some((m) => m.value === modelName)) {
      showValidationResult("This model is already in your list", "error");
      return;
    }

    // Check if label already exists
    if (
      allModels.some((m) => m.label.toLowerCase() === modelLabel.toLowerCase())
    ) {
      showValidationResult(
        "This label is already used by another model",
        "error",
      );
      return;
    }

    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showValidationResult("Please add your API key first", "error");
      return;
    }

    // Show validating status
    validationStatus.classList.remove("hidden");
    hideValidationResult();
    validateBtn.disabled = true;

    try {
      // Test the model with a minimal request
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
            model: modelName,
            messages: [{ role: "user", content: "Hi" }],
            max_tokens: 1,
          }),
        },
      );

      validationStatus.classList.add("hidden");
      validateBtn.disabled = false;

      if (response.ok) {
        // Model is valid - add it
        const newModel = {
          value: modelName,
          label: modelLabel,
        };

        customModels.push(newModel);
        await chrome.storage.sync.set({ customModels });

        // Rebuild the select and select the new model
        populateModelSelect(modelName);

        // Auto-save the new model selection
        await chrome.storage.sync.set({ model: modelName });

        // Reset UI
        customModelInput.value = "";
        customLabelInput.value = "";
        addModelInputWrapper.classList.add("hidden");
        addModelBtn.classList.remove("hidden");

        showValidationResult("✓ Model added successfully!", "success");
        showToast("Model added: " + modelLabel, "success");
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg =
          errorData.error?.message ||
          `Model not found or invalid (${response.status})`;
        showValidationResult("✗ " + errorMsg, "error");
      }
    } catch (error) {
      validationStatus.classList.add("hidden");
      validateBtn.disabled = false;
      showValidationResult("✗ Failed to validate: " + error.message, "error");
    }
  }

  function showValidationResult(message, type) {
    validationResult.textContent = message;
    validationResult.className = `validation-result ${type}`;
    validationResult.classList.remove("hidden");
  }

  function hideValidationResult() {
    validationResult.classList.add("hidden");
  }

  function populateModelSelect(selectedValue = null) {
    modelSelect.innerHTML = "";

    // Combine default and custom models (no categories, just flat list)
    const allModels = [...DEFAULT_MODELS, ...customModels];

    allModels.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.value;
      option.textContent = model.label;
      if (selectedValue && model.value === selectedValue) {
        option.selected = true;
      }
      modelSelect.appendChild(option);
    });
  }

  // Auto-save when model is changed
  modelSelect.addEventListener("change", async () => {
    const model = modelSelect.value;
    await chrome.storage.sync.set({ model });

    // Find the label for this model
    const allModels = [...DEFAULT_MODELS, ...customModels];
    const modelData = allModels.find((m) => m.value === model);
    const label = modelData ? modelData.label : model;

    showToast("Model: " + label, "success");
  });

  async function loadSettings() {
    const settings = await chrome.storage.sync.get([
      "apiKey",
      "model",
      "customModels",
      "scrollWithPage",
      "theme",
    ]);

    if (settings.apiKey) {
      apiKeyInput.value = settings.apiKey;
    }

    // Load custom models
    customModels = settings.customModels || [];

    // Populate model select
    populateModelSelect(settings.model);

    // If a model was saved, select it
    if (settings.model) {
      modelSelect.value = settings.model;
    }

    // Load scroll with page preference (default: true - scrolls with page)
    scrollWithPageToggle.checked = settings.scrollWithPage !== false;

    // Load theme
    if (settings.theme) {
      setActiveTheme(settings.theme);
      applyTheme(getSelectedTheme());
    } else {
      // Default
      setActiveTheme("dark-purple");
      applyTheme("dark-purple");
    }

    updateStatus(settings.apiKey);
  }

  function updateStatus(apiKey) {
    if (apiKey) {
      statusIndicator.className = "status-indicator connected";
      statusText.textContent = "Ready to use";
    } else {
      statusIndicator.className = "status-indicator";
      statusText.textContent = "API key required";
    }
  }

  function showToast(message, type = "success") {
    toastMessage.textContent = message;
    toast.className = `toast show ${type}`;

    setTimeout(() => {
      toast.className = "toast";
    }, 3000);
  }
});
