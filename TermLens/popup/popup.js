// TermLens - Popup Script

let fetchedModels = [];

document.addEventListener("DOMContentLoaded", async () => {
  // ── Version ──────────────────────────────────────────────────────────────
  const manifest = chrome.runtime.getManifest();
  document.getElementById("version").textContent = `v${manifest.version}`;

  // ── Element refs ─────────────────────────────────────────────────────────
  const apiKeyInput = document.getElementById("api-key");
  const modelSelect = document.getElementById("model-select");
  const toggleKeyBtn = document.getElementById("toggle-key");
  const statusIndicator = document.getElementById("status-indicator");
  const statusText = document.getElementById("status-text");
  const toast = document.getElementById("toast");
  const toastMessage = document.getElementById("toast-message");
  const scrollWithPageToggle = document.getElementById("scroll-with-page");
  const customInstructionsInput = document.getElementById(
    "custom-instructions",
  );
  const charCounter = document.getElementById("char-counter");
  const autoModeToggle = document.getElementById("auto-mode-toggle");
  const manualKeyPanel = document.getElementById("manual-key-panel");

  // Theme
  const modeBtns = Array.from(document.querySelectorAll(".mode-btn"));
  const colorBtns = Array.from(document.querySelectorAll(".color-btn"));

  // Add model
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
  const customModelsList = document.getElementById("custom-models-list");
  const customModelsItems = document.getElementById("custom-models-items");

  let customModels = [];

  // ── Load settings ─────────────────────────────────────────────────────────
  await loadSettings();

  // =========================================================================
  // Collapsible sections — identical logic to How to Use
  // =========================================================================

  function initCollapsibleSection(contentId, btnId) {
    const content = document.getElementById(contentId);
    const btn = document.getElementById(btnId);
    if (!content || !btn) return;

    // Both start collapsed (classes already set in HTML)
    btn.addEventListener("click", () => {
      const wasCollapsed = content.classList.contains("collapsed");
      if (wasCollapsed) {
        content.classList.remove("collapsed");
        btn.classList.remove("collapsed");
        content.closest(".how-to-use").classList.remove("collapsed");
      } else {
        content.classList.add("collapsed");
        btn.classList.add("collapsed");
        content.closest(".how-to-use").classList.add("collapsed");
      }
    });
  }

  initCollapsibleSection("api-config-content", "toggle-api-config-btn");
  initCollapsibleSection("model-config-content", "toggle-model-config-btn");

  // =========================================================================
  // How to Use toggle (existing behaviour)
  // =========================================================================

  const toggleStepsBtn = document.getElementById("toggle-steps-btn");
  const howToUseContent = document.getElementById("how-to-use-content");

  if (toggleStepsBtn && howToUseContent) {
    const isCollapsed = howToUseContent.classList.contains("collapsed");
    if (isCollapsed) toggleStepsBtn.classList.add("collapsed");

    toggleStepsBtn.addEventListener("click", () => {
      const wasCollapsed = howToUseContent.classList.contains("collapsed");
      if (wasCollapsed) {
        howToUseContent.classList.remove("collapsed");
        toggleStepsBtn.classList.remove("collapsed");
        howToUseContent.closest(".how-to-use").classList.remove("collapsed");
      } else {
        howToUseContent.classList.add("collapsed");
        toggleStepsBtn.classList.add("collapsed");
        howToUseContent.closest(".how-to-use").classList.add("collapsed");
      }
    });

    if (isCollapsed) {
      howToUseContent.closest(".how-to-use").classList.add("collapsed");
    }
  }

  // =========================================================================
  // Auto-mode toggle (Automatic ↔ Manual API key)
  // =========================================================================

  function applyAutoMode(isAuto) {
    if (isAuto) {
      manualKeyPanel.classList.add("hidden");
      updateStatus(null, true); // auto mode
    } else {
      manualKeyPanel.classList.remove("hidden");
      updateStatus(apiKeyInput.value.trim(), false);
    }
  }

  autoModeToggle.addEventListener("change", async () => {
    const isAuto = autoModeToggle.checked;
    await chrome.storage.sync.set({ autoMode: isAuto });
    applyAutoMode(isAuto);
    showToast(
      isAuto ? "Using TermLens Cloud" : "Using your API key",
      "success",
    );
  });

  // =========================================================================
  // API key visibility toggle
  // =========================================================================

  let keyVisible = false;
  toggleKeyBtn.addEventListener("click", () => {
    keyVisible = !keyVisible;
    apiKeyInput.type = keyVisible ? "text" : "password";
    toggleKeyBtn.querySelector("svg").style.opacity = keyVisible ? "1" : "0.5";
  });

  // Auto-save API key (debounced)
  let apiKeySaveTimeout = null;
  apiKeyInput.addEventListener("input", () => {
    if (apiKeySaveTimeout) clearTimeout(apiKeySaveTimeout);
    apiKeySaveTimeout = setTimeout(async () => {
      const apiKey = apiKeyInput.value.trim();
      await chrome.storage.sync.set({ apiKey });
      updateStatus(apiKey, autoModeToggle.checked);
      showToast(apiKey ? "API key saved" : "API key cleared", "success");
    }, 500);
  });

  // =========================================================================
  // Scroll with page
  // =========================================================================

  scrollWithPageToggle.addEventListener("change", async () => {
    const scrollWithPage = scrollWithPageToggle.checked;
    await chrome.storage.sync.set({ scrollWithPage });
    showToast(
      scrollWithPage ? "Chat scrolls with page" : "Chat stays fixed",
      "success",
    );

    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs
          .sendMessage(tab.id, {
            action: "updateScrollWithPage",
            scrollWithPage,
          })
          .catch(() => {});
      });
    });
  });

  // =========================================================================
  // Custom Instructions
  // =========================================================================

  let customInstructionsSaveTimeout = null;

  function updateCharCounter() {
    const length = customInstructionsInput.value.length;
    charCounter.textContent = `${length}/300`;
    charCounter.classList.remove("warning", "limit");
    if (length >= 300) charCounter.classList.add("limit");
    else if (length >= 250) charCounter.classList.add("warning");
  }

  customInstructionsInput.addEventListener("input", () => {
    updateCharCounter();
    if (customInstructionsSaveTimeout)
      clearTimeout(customInstructionsSaveTimeout);
    customInstructionsSaveTimeout = setTimeout(async () => {
      const customInstructions = customInstructionsInput.value.trim();
      await chrome.storage.sync.set({ customInstructions });
      showToast("Custom instructions saved", "success");
    }, 500);
  });

  // =========================================================================
  // Theme
  // =========================================================================

  function setActiveTheme(themeStr) {
    if (!themeStr) themeStr = "default";
    let mode = "dark",
      color = "purple";

    if (themeStr === "default") {
      mode = "dark";
      color = "purple";
    } else if (themeStr === "light") {
      mode = "light";
      color = "purple";
    } else if (themeStr === "dark") {
      mode = "dark";
      color = "purple";
    } else if (themeStr.startsWith("light-")) {
      mode = "light";
      color = themeStr.replace("light-", "");
    } else if (themeStr.startsWith("dark-")) {
      mode = "dark";
      color = themeStr.replace("dark-", "");
    } else {
      mode = "dark";
      color = themeStr;
    }

    modeBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    colorBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.color === color);
    });
    return { mode, color };
  }

  function getSelectedTheme() {
    const activeModeBtn = modeBtns.find((b) => b.classList.contains("active"));
    const activeColorBtn = colorBtns.find((b) =>
      b.classList.contains("active"),
    );
    const mode = activeModeBtn ? activeModeBtn.dataset.mode : "dark";
    const color = activeColorBtn ? activeColorBtn.dataset.color : "purple";
    return `${mode}-${color}`;
  }

  modeBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      modeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      await updateThemeFromUI();
    });
  });

  colorBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      colorBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      await updateThemeFromUI();
    });
  });

  async function updateThemeFromUI() {
    const theme = getSelectedTheme();
    await chrome.storage.sync.set({ theme });
    applyTheme(theme);
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs
          .sendMessage(tab.id, { action: "updateTheme", theme })
          .catch(() => {});
      });
    });
  }

  function applyTheme(theme) {
    document.body.className = "";
    const [mode, color] = theme.split("-");
    document.body.classList.add(`mode-${mode}`);
    document.body.classList.add(`color-${color}`);
    if (mode === "light" && color === "purple")
      document.body.classList.add("theme-light");
    if (mode === "dark" && color === "purple")
      document.body.classList.add("theme-default");
  }

  // =========================================================================
  // Add custom model
  // =========================================================================

  addModelBtn.addEventListener("click", () => {
    addModelBtn.classList.add("hidden");
    addModelInputWrapper.classList.remove("hidden");
    customModelInput.focus();
    hideValidationResult();
  });

  cancelAddBtn.addEventListener("click", () => {
    addModelInputWrapper.classList.add("hidden");
    addModelBtn.classList.remove("hidden");
    customModelInput.value = "";
    customLabelInput.value = "";
    hideValidationResult();
  });

  validateBtn.addEventListener("click", () => validateAndAddModel());

  customModelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      customLabelInput.focus();
    }
    if (e.key === "Escape") cancelAddBtn.click();
  });

  customLabelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      validateAndAddModel();
    }
    if (e.key === "Escape") cancelAddBtn.click();
  });

  async function validateAndAddModel() {
    const modelName = customModelInput.value.trim();
    const modelLabel = customLabelInput.value.trim() || modelName;

    if (!modelName) {
      showValidationResult("Please enter a model name", "error");
      return;
    }

    const allModels = [...fetchedModels, ...customModels];
    if (allModels.some((m) => m.value === modelName)) {
      showValidationResult("This model is already in your list", "error");
      return;
    }
    if (
      allModels.some((m) => m.label?.toLowerCase() === modelLabel.toLowerCase())
    ) {
      showValidationResult(
        "This label is already used by another model",
        "error",
      );
      return;
    }

    // Need an API key to validate custom models
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showValidationResult(
        "Please add your API key to validate custom models",
        "error",
      );
      return;
    }

    validationStatus.classList.remove("hidden");
    hideValidationResult();
    validateBtn.disabled = true;

    try {
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
        const newModel = { value: modelName, label: modelLabel };
        customModels.push(newModel);
        await chrome.storage.sync.set({ customModels });

        populateModelSelect(modelName);
        renderCustomModelsList();
        await chrome.storage.sync.set({ model: modelName });

        customModelInput.value = "";
        customLabelInput.value = "";
        addModelInputWrapper.classList.add("hidden");
        addModelBtn.classList.remove("hidden");

        showValidationResult("✓ Model added successfully!", "success");
        showToast("Model added: " + modelLabel, "success");
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg =
          errorData.error?.message || `Model not found (${response.status})`;
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

  // =========================================================================
  // Model select helpers
  // =========================================================================

  function populateModelSelect(selectedValue = null) {
    modelSelect.innerHTML = "";
    const allModels = [...fetchedModels, ...customModels];

    if (allModels.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Loading models...";
      modelSelect.appendChild(option);
      return;
    }

    allModels.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.value;
      option.textContent = model.label;
      if (selectedValue && model.value === selectedValue)
        option.selected = true;
      modelSelect.appendChild(option);
    });

    if (
      selectedValue &&
      !allModels.some((m) => m.value === selectedValue) &&
      selectedValue !== ""
    ) {
      const option = document.createElement("option");
      option.value = selectedValue;
      option.textContent = selectedValue.split("/").pop() || selectedValue;
      option.selected = true;
      modelSelect.appendChild(option);
    }
  }

  function renderCustomModelsList() {
    if (!customModels || customModels.length === 0) {
      customModelsList.classList.add("hidden");
      return;
    }

    customModelsList.classList.remove("hidden");
    customModelsItems.innerHTML = "";

    customModels.forEach((model, index) => {
      const item = document.createElement("div");
      item.className = "custom-model-item";

      const info = document.createElement("div");
      info.className = "custom-model-info";

      const label = document.createElement("span");
      label.className = "custom-model-label";
      label.textContent = model.label;

      const value = document.createElement("span");
      value.className = "custom-model-value";
      value.textContent = model.value;

      info.appendChild(label);
      info.appendChild(value);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-model-btn";
      deleteBtn.title = "Delete model";
      deleteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
        </svg>
      `;

      deleteBtn.addEventListener("click", async () => {
        if (confirm(`Delete model "${model.label}"?`)) {
          const isDeletedModelSelected = modelSelect.value === model.value;
          customModels.splice(index, 1);
          await chrome.storage.sync.set({ customModels });

          if (isDeletedModelSelected) {
            const nextModel =
              customModels.length > 0
                ? customModels[0].value
                : fetchedModels.length > 0
                  ? fetchedModels[0].value
                  : "";
            await chrome.storage.sync.set({ model: nextModel });
            populateModelSelect(nextModel);
          } else {
            populateModelSelect(modelSelect.value);
          }

          renderCustomModelsList();
          showToast("Model deleted", "success");
        }
      });

      item.appendChild(info);
      item.appendChild(deleteBtn);
      customModelsItems.appendChild(item);
    });
  }

  modelSelect.addEventListener("change", async () => {
    const model = modelSelect.value;
    await chrome.storage.sync.set({ model });
    const allModels = [...fetchedModels, ...customModels];
    const modelData = allModels.find((m) => m.value === model);
    showToast("Model: " + (modelData ? modelData.label : model), "success");
  });

  // =========================================================================
  // Load settings
  // =========================================================================

  async function loadSettings() {
    const [settings, localData] = await Promise.all([
      chrome.storage.sync.get([
        "apiKey",
        "model",
        "customModels",
        "scrollWithPage",
        "theme",
        "customInstructions",
        "autoMode",
      ]),
      chrome.storage.local.get(["fetchedModels"]),
    ]);

    // API key — must be set BEFORE applyAutoMode so updateStatus reads the correct value
    if (settings.apiKey) {
      apiKeyInput.value = settings.apiKey;
    }

    // Auto-mode (default: true)
    const isAuto = settings.autoMode !== false;
    autoModeToggle.checked = isAuto;
    applyAutoMode(isAuto);

    // Custom instructions
    if (settings.customInstructions) {
      customInstructionsInput.value = settings.customInstructions;
      updateCharCounter();
    }

    // Models
    customModels = settings.customModels || [];
    fetchedModels = localData.fetchedModels || [];

    if (fetchedModels.length === 0) {
      chrome.runtime.sendMessage({ action: "refreshModels" }, (response) => {
        if (response && response.success) {
          chrome.storage.local.get(["fetchedModels"]).then((data) => {
            if (data.fetchedModels && data.fetchedModels.length > 0) {
              fetchedModels = data.fetchedModels;
              populateModelSelect(settings.model);
            }
          });
        }
      });
    }

    populateModelSelect(settings.model);
    renderCustomModelsList();

    if (settings.model) modelSelect.value = settings.model;

    // Scroll with page
    scrollWithPageToggle.checked = settings.scrollWithPage !== false;

    // Theme
    if (settings.theme) {
      setActiveTheme(settings.theme);
      applyTheme(getSelectedTheme());
    } else {
      setActiveTheme("dark-purple");
      applyTheme("dark-purple");
    }
  }

  // =========================================================================
  // Status bar
  // =========================================================================

  function updateStatus(apiKey, isAuto) {
    statusIndicator.className = "status-indicator connected";
    if (isAuto) {
      statusText.textContent = "Ready — TermLens Cloud";
    } else if (apiKey && apiKey.trim()) {
      statusText.textContent = "Ready — using your API key";
    } else {
      statusIndicator.className = "status-indicator error";
      statusText.textContent = "Add an API key to continue";
    }
  }

  // =========================================================================
  // Toast
  // =========================================================================

  function showToast(message, type = "success") {
    toastMessage.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
      toast.className = "toast";
    }, 3000);
  }
});
