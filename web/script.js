document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("config-form");
  const botControlBtn = document.getElementById("bot-control-btn");
  const botControlText = document.getElementById("bot-control-text");
  const botControlIcon = botControlBtn.querySelector("i");
  const webhookSection = document.getElementById("webhook-section");
  const webhookUrlElement = document.getElementById("webhook-url");
  const copyWebhookBtn = document.getElementById("copy-webhook-btn");
  const navItems = document.querySelectorAll(".nav-item, .about-button");
  const testJellyseerrBtn = document.getElementById("test-jellyseerr-btn");
  const testJellyseerrStatus = document.getElementById(
    "test-jellyseerr-status"
  );
  const testJellyfinBtn = document.getElementById("test-jellyfin-btn");
  const testJellyfinStatus = document.getElementById("test-jellyfin-status");
  // Create toast element dynamically
  const toast = document.createElement("div");
  toast.id = "toast";
  toast.className = "toast";
  document.body.appendChild(toast);

  // --- Functions ---

  function showToast(message, duration = 3000) {
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, duration);
  }

  async function fetchConfig() {
    try {
      const response = await fetch("/api/config");
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      const config = await response.json();
      for (const key in config) {
        const input = document.getElementById(key);
        if (!input) continue;
        if (input.type === "checkbox") {
          const val = String(config[key]).trim().toLowerCase();
          input.checked = val === "true" || val === "1" || val === "yes";
        } else {
          input.value = config[key];
        }
      }
      updateWebhookUrl();
    } catch (error) {
      console.error("Error fetching config:", error);
      showToast("Error fetching configuration.");
    }
  }

  async function fetchStatus() {
    try {
      const response = await fetch("/api/status");
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      const status = await response.json();
      updateStatusIndicator(status.isBotRunning, status.botUsername);
    } catch (error) {
      console.error("Error fetching status:", error);
      updateStatusIndicator(false);
    }
  }

  function updateStatusIndicator(isRunning, username = null) {
    botControlBtn.disabled = false;
    if (isRunning) {
      botControlBtn.classList.remove("btn-success");
      botControlBtn.classList.add("btn-danger");
      botControlIcon.className = "bi bi-pause-fill";
      botControlText.textContent = "Stop Bot";
      botControlBtn.dataset.action = "stop";
    } else {
      botControlBtn.classList.remove("btn-danger");
      botControlBtn.classList.add("btn-success");
      botControlIcon.className = "bi bi-play-fill";
      botControlText.textContent = "Start Bot";
      botControlBtn.dataset.action = "start";
    }
  }

  function updateWebhookUrl() {
    const portInput = document.getElementById("WEBHOOK_PORT");
    if (!portInput) return;

    const port = portInput.value || 8282;
    // Use `window.location.hostname` which is more reliable than guessing the host IP.
    // This works well for localhost and for accessing via a local network IP.
    const host = window.location.hostname;
    webhookUrlElement.textContent = `http://${host}:${port}/jellyfin-webhook`;
  }

  // --- Event Listeners ---

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const config = Object.fromEntries(formData.entries());
    // Explicitly capture checkbox values as "true"/"false"
    document.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      config[cb.id] = cb.checked ? "true" : "false";
    });

    try {
      const response = await fetch("/api/save-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const result = await response.json();
      showToast(result.message);
    } catch (error) {
      console.error("Error saving config:", error);
      showToast("Error saving configuration.");
    }
  });

  botControlBtn.addEventListener("click", async () => {
    const action = botControlBtn.dataset.action;
    if (!action) return;

    botControlBtn.disabled = true;
    const originalText = botControlText.textContent;
    botControlText.textContent = "Processing...";

    try {
      const response = await fetch(`/api/${action}-bot`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) {
        showToast(`Error: ${result.message}`);
        botControlText.textContent = originalText; // Restore text on failure
        botControlBtn.disabled = false;
      } else {
        showToast(result.message);
        setTimeout(fetchStatus, 1000); // Fetch status after a short delay to get the new state
      }
    } catch (error) {
      console.error(`Error with ${action} action:`, error);
      showToast(`Failed to ${action} bot.`);
      botControlText.textContent = originalText; // Restore text on failure
      botControlBtn.disabled = false;
    }
  });

  // Handle navigation between config panes
  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();

      // Update active nav item
      navItems.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");

      // Show the correct pane
      const targetId = item.getAttribute("data-target");
      document.querySelectorAll(".config-pane").forEach((pane) => {
        pane.classList.remove("active");
      });
      document
        .getElementById(`config-pane-${targetId}`)
        .classList.add("active");
    });
  });

  // Update webhook URL when port changes
  const portInput = document.getElementById("WEBHOOK_PORT");
  if (portInput) {
    portInput.addEventListener("input", updateWebhookUrl);
  }

  // Copy webhook URL
  copyWebhookBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(webhookUrlElement.textContent);
    showToast("Webhook URL copied to clipboard!");
  });

  // Test Jellyseerr Connection
  if (testJellyseerrBtn) {
    testJellyseerrBtn.addEventListener("click", async () => {
      const url = document.getElementById("JELLYSEERR_URL").value;
      const apiKey = document.getElementById("JELLYSEERR_API_KEY").value;

      testJellyseerrBtn.disabled = true;
      testJellyseerrStatus.textContent = "Testing...";
      testJellyseerrStatus.style.color = "var(--text)";

      try {
        const response = await fetch("/api/test-jellyseerr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, apiKey }),
        });

        const result = await response.json();

        if (response.ok) {
          testJellyseerrStatus.textContent = result.message;
          testJellyseerrStatus.style.color = "var(--green)";
        } else {
          throw new Error(result.message);
        }
      } catch (error) {
        testJellyseerrStatus.textContent =
          error.message || "Connection failed.";
        testJellyseerrStatus.style.color = "#f38ba8"; // Red
      } finally {
        testJellyseerrBtn.disabled = false;
      }
    });
  }

  // Test Jellyfin Endpoint
  if (testJellyfinBtn) {
    testJellyfinBtn.addEventListener("click", async () => {
      const url = document.getElementById("JELLYFIN_BASE_URL").value;
      const apiKey = document.getElementById("JELLYFIN_API_KEY").value;

      testJellyfinBtn.disabled = true;
      testJellyfinStatus.textContent = "Testing...";
      testJellyfinStatus.style.color = "var(--text)";

      try {
        const response = await fetch("/api/test-jellyfin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, apiKey }),
        });

        const result = await response.json();

        if (response.ok) {
          testJellyfinStatus.textContent = result.message;
          testJellyfinStatus.style.color = "var(--green)";
        } else {
          throw new Error(result.message);
        }
      } catch (error) {
        testJellyfinStatus.textContent =
          error.message || "Endpoint test failed.";
        testJellyfinStatus.style.color = "#f38ba8"; // Red
      } finally {
        testJellyfinBtn.disabled = false;
      }
    });
  }

  // Fetch and display Jellyfin libraries for exclusion
  const fetchLibrariesBtn = document.getElementById("fetch-libraries-btn");
  const fetchLibrariesStatus = document.getElementById("fetch-libraries-status");
  const librariesList = document.getElementById("libraries-list");
  const excludedLibrariesInput = document.getElementById("JELLYFIN_EXCLUDED_LIBRARIES");

  if (fetchLibrariesBtn) {
    fetchLibrariesBtn.addEventListener("click", async () => {
      const url = document.getElementById("JELLYFIN_BASE_URL").value;
      const apiKey = document.getElementById("JELLYFIN_API_KEY").value;
      
      if (!url || !url.trim()) {
        showToast("Please enter a Jellyfin URL first.");
        return;
      }

      fetchLibrariesBtn.disabled = true;
      fetchLibrariesStatus.textContent = "Loading...";
      fetchLibrariesStatus.style.color = "var(--text)";

      try {
        const response = await fetch("/api/jellyfin-libraries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, apiKey }),
        });

        const result = await response.json();

        if (response.ok && result.success) {
          const libraries = result.libraries || [];
          
          if (libraries.length === 0) {
            librariesList.innerHTML = '<div class="libraries-empty">No libraries found.</div>';
          } else {
            // Get currently excluded libraries from the hidden input
            const excludedIds = excludedLibrariesInput.value.split(",").map(id => id.trim()).filter(id => id);
            
            // Render the libraries as checkboxes
            librariesList.innerHTML = libraries.map(lib => `
              <div class="library-item">
                <label>
                  <input 
                    type="checkbox" 
                    value="${lib.id}" 
                    class="library-checkbox"
                    ${excludedIds.includes(lib.id) ? 'checked' : ''}
                  />
                  <div class="library-info">
                    <span class="library-name">${lib.name}</span>
                    <span class="library-type">${lib.type}</span>
                  </div>
                </label>
              </div>
            `).join('');
            
            // Add event listeners to checkboxes to update the hidden input
            const checkboxes = librariesList.querySelectorAll('.library-checkbox');
            checkboxes.forEach(checkbox => {
              checkbox.addEventListener('change', () => {
                updateExcludedLibraries();
              });
            });
          }
          
          librariesList.style.display = 'block';
          fetchLibrariesStatus.textContent = `Found ${libraries.length} ${libraries.length === 1 ? 'library' : 'libraries'}`;
          fetchLibrariesStatus.style.color = "var(--green)";
        } else {
          throw new Error(result.message || "Failed to fetch libraries");
        }
      } catch (error) {
        fetchLibrariesStatus.textContent = error.message || "Failed to load libraries.";
        fetchLibrariesStatus.style.color = "#f38ba8"; // Red
        librariesList.style.display = 'none';
      } finally {
        fetchLibrariesBtn.disabled = false;
      }
    });
  }

  // Update the hidden input with selected excluded libraries
  function updateExcludedLibraries() {
    const checkboxes = librariesList.querySelectorAll('.library-checkbox:checked');
    const excludedIds = Array.from(checkboxes).map(cb => cb.value);
    excludedLibrariesInput.value = excludedIds.join(',');
  }

  // --- Initial Load ---
  fetchConfig();
  fetchStatus();
  setInterval(fetchStatus, 10000); // Poll status every 10 seconds
});
