document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("config-form");
  const botControlBtn = document.getElementById("bot-control-btn");
  const botControlText = document.getElementById("bot-control-text");
  const botControlIcon = botControlBtn.querySelector("i");
  const webhookSection = document.getElementById("webhook-section");
  const webhookUrlElement = document.getElementById("webhook-url");
  const copyWebhookBtn = document.getElementById("copy-webhook-btn");
  const navItems = document.querySelectorAll(".nav-item, .about-button, .about-link");
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
          // For select elements, save the value to restore later (after options are loaded)
          if (input.tagName === "SELECT") {
            input.dataset.savedValue = config[key];
            // Don't set value yet - will be set after options are populated
          } else {
            input.value = config[key];
          }
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

  function updateWebhookUrl(port = null) {
    // If no port provided, use the current window port (which is the actual server port)
    const actualPort = port || window.location.port || 8282;
    // Use `window.location.hostname` which is more reliable than guessing the host IP.
    // This works well for localhost and for accessing via a local network IP.
    const host = window.location.hostname;
    webhookUrlElement.textContent = `http://${host}:${actualPort}/jellyfin-webhook`;
  }

  // --- Event Listeners ---

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const config = Object.fromEntries(formData.entries());
    
    // Explicitly capture checkbox values as "true"/"false" (except role checkboxes)
    document.querySelectorAll('input[type="checkbox"]:not([name="ROLE_ALLOWLIST"]):not([name="ROLE_BLOCKLIST"])').forEach((cb) => {
      config[cb.id] = cb.checked ? "true" : "false";
    });
    
    // Handle role allowlist/blocklist as arrays
    const allowlistRoles = Array.from(document.querySelectorAll('input[name="ROLE_ALLOWLIST"]:checked')).map(cb => cb.value);
    const blocklistRoles = Array.from(document.querySelectorAll('input[name="ROLE_BLOCKLIST"]:checked')).map(cb => cb.value);

    config.ROLE_ALLOWLIST = allowlistRoles;
    config.ROLE_BLOCKLIST = blocklistRoles;

    // Handle Jellyfin notification libraries as array
    try {
      config.JELLYFIN_NOTIFICATION_LIBRARIES = config.JELLYFIN_NOTIFICATION_LIBRARIES
        ? JSON.parse(config.JELLYFIN_NOTIFICATION_LIBRARIES)
        : [];
    } catch (e) {
      config.JELLYFIN_NOTIFICATION_LIBRARIES = [];
    }

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

      const targetId = item.getAttribute("data-target");

      // Handle About page separately
      if (targetId === "about") {
        // Hide dashboard layout
        document.querySelector(".dashboard-layout").style.display = "none";
        // Show about page
        document.getElementById("about-page").style.display = "block";
        // Update dashboard title to "Back to Configuration"
        const dashboardTitle = document.getElementById("dashboard-title");
        dashboardTitle.innerHTML = '<i class="bi bi-arrow-left"></i> Back to Configuration';
        dashboardTitle.style.cursor = "pointer";
        dashboardTitle.classList.add("back-link");
        return;
      }

      // Update active nav item
      navItems.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");

      // Show the correct pane
      document.querySelectorAll(".config-pane").forEach((pane) => {
        pane.classList.remove("active");
      });
      document
        .getElementById(`config-pane-${targetId}`)
        .classList.add("active");

      // Load data when mappings tab is opened
      if (targetId === "mappings") {
        // Only load mappings (with saved metadata), not members/users yet
        loadMappings();
      }
      
      // Load roles when role mapping tab is opened
      if (targetId === "roles") {
        loadRoles();
      }
    });
  });

  // Handle "Back to Configuration" click
  document.getElementById("dashboard-title").addEventListener("click", () => {
    const dashboardTitle = document.getElementById("dashboard-title");

    // Only handle if it's in "back" mode
    if (dashboardTitle.classList.contains("back-link")) {
      // Show dashboard layout
      document.querySelector(".dashboard-layout").style.display = "grid";
      // Hide about page
      document.getElementById("about-page").style.display = "none";
      // Reset dashboard title
      dashboardTitle.innerHTML = "Configuration";
      dashboardTitle.style.cursor = "default";
      dashboardTitle.classList.remove("back-link");

      // Reactivate the first nav item (Discord)
      navItems.forEach((i) => i.classList.remove("active"));
      document.querySelector('.nav-item[data-target="discord"]').classList.add("active");

      // Show the Discord pane
      document.querySelectorAll(".config-pane").forEach((pane) => {
        pane.classList.remove("active");
      });
      document.getElementById("config-pane-discord").classList.add("active");
    }
  });

  // Initialize webhook URL on page load with actual server port
  updateWebhookUrl();

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

  // Fetch and display Jellyfin libraries for notifications
  const fetchLibrariesBtn = document.getElementById("fetch-libraries-btn");
  const fetchLibrariesStatus = document.getElementById("fetch-libraries-status");
  const librariesList = document.getElementById("libraries-list");
  const notificationLibrariesInput = document.getElementById("JELLYFIN_NOTIFICATION_LIBRARIES");

  if (fetchLibrariesBtn) {
    fetchLibrariesBtn.addEventListener("click", async () => {
      const url = document.getElementById("JELLYFIN_BASE_URL").value;
      const apiKey = document.getElementById("JELLYFIN_API_KEY").value;

      if (!url || !url.trim()) {
        showToast("Please enter Jellyfin URL first.");
        return;
      }

      if (!apiKey || !apiKey.trim()) {
        showToast("Please enter Jellyfin API Key first.");
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
            // Get currently enabled libraries (or all by default)
            let enabledIds = [];
            try {
              const currentValue = notificationLibrariesInput.value;
              enabledIds = currentValue ? JSON.parse(currentValue) : [];
            } catch (e) {
              enabledIds = [];
            }

            // If no libraries selected yet, enable all by default
            const allChecked = enabledIds.length === 0;

            librariesList.innerHTML = libraries.map(lib => `
              <div class="library-item">
                <label>
                  <input
                    type="checkbox"
                    value="${lib.id}"
                    class="library-checkbox"
                    ${allChecked || enabledIds.includes(lib.id) ? 'checked' : ''}
                  />
                  <div class="library-info">
                    <span class="library-name">${lib.name}</span>
                    <span class="library-type">${lib.type}</span>
                  </div>
                </label>
              </div>
            `).join('');

            // Add change listeners to all checkboxes
            librariesList.querySelectorAll('.library-checkbox').forEach(cb => {
              cb.addEventListener('change', updateNotificationLibraries);
            });

            // Initial update to populate hidden input
            updateNotificationLibraries();
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

  // Update the hidden input with selected notification libraries
  function updateNotificationLibraries() {
    const checkboxes = librariesList.querySelectorAll('.library-checkbox:checked');
    const enabledIds = Array.from(checkboxes).map(cb => cb.value);
    notificationLibrariesInput.value = JSON.stringify(enabledIds);
  }

  // --- Initial Load ---
  fetchConfig().then(() => {
    // After config loads, populate guild and channel dropdowns if token exists
    loadDiscordGuilds();
    
    // Check if mappings tab is active on page load
    checkAndLoadMappingsTab();
  });
  fetchStatus();
  setInterval(fetchStatus, 10000); // Poll status every 10 seconds
  
  // Helper function to check and load mappings tab
  function checkAndLoadMappingsTab() {
    const activePane = document.querySelector('.config-pane.active');
    if (activePane && activePane.id === 'config-pane-mappings') {
      loadMappings();
    }
  }

  // --- Discord Guild & Channel Selection ---
  async function loadDiscordGuilds() {
    const tokenInput = document.getElementById("DISCORD_TOKEN");
    const botIdInput = document.getElementById("BOT_ID");
    const guildSelect = document.getElementById("GUILD_ID");
    
    if (!guildSelect) return;
    
    // Reset to default state if no token
    if (!tokenInput?.value || !botIdInput?.value) {
      guildSelect.innerHTML = '<option value="">Enter Discord Token and Bot ID first...</option>';
      return;
    }

    guildSelect.innerHTML = '<option value="">Loading servers...</option>';

    try {
      const response = await fetch("/api/discord/guilds");
      const data = await response.json();

      if (data.success && data.guilds) {
        guildSelect.innerHTML = '<option value="">Select a server...</option>';
        data.guilds.forEach(guild => {
          const option = document.createElement("option");
          option.value = guild.id;
          option.textContent = guild.name;
          guildSelect.appendChild(option);
        });
        
        // Restore saved value if exists
        const currentValue = guildSelect.dataset.savedValue;
        if (currentValue) {
          guildSelect.value = currentValue;
          // If value was successfully set, load channels for that guild
          if (guildSelect.value === currentValue) {
            loadDiscordChannels(currentValue);
          } else {
            console.warn(`Saved guild ID ${currentValue} not found in available servers`);
          }
        }
      } else {
        guildSelect.innerHTML = '<option value="">Error loading servers. Check token.</option>';
      }
    } catch (error) {
      console.error("Error loading Discord guilds:", error);
      guildSelect.innerHTML = '<option value="">Error loading servers</option>';
    }
  }

  async function loadDiscordChannels(guildId) {
    const channelSelect = document.getElementById("JELLYFIN_CHANNEL_ID");
    
    if (!channelSelect || !guildId) {
      if (channelSelect) {
        channelSelect.innerHTML = '<option value="">Select a server first...</option>';
      }
      return;
    }

    channelSelect.innerHTML = '<option value="">Loading channels...</option>';

    try {
      const response = await fetch(`/api/discord/channels/${guildId}`);
      const data = await response.json();

      if (data.success && data.channels) {
        channelSelect.innerHTML = '<option value="">Select a channel...</option>';
        data.channels.forEach(channel => {
          const option = document.createElement("option");
          option.value = channel.id;
          option.textContent = `#${channel.name}${channel.type === 'announcement' ? ' 📢' : ''}`;
          channelSelect.appendChild(option);
        });
        
        // Restore saved value if exists
        const currentValue = channelSelect.dataset.savedValue;
        if (currentValue) {
          channelSelect.value = currentValue;
          // Verify if the value was successfully set
          if (channelSelect.value !== currentValue) {
            console.warn(`Saved channel ID ${currentValue} not found in available channels`);
          }
        }
      } else {
        channelSelect.innerHTML = '<option value="">Error loading channels</option>';
      }
    } catch (error) {
      console.error("Error loading Discord channels:", error);
      channelSelect.innerHTML = '<option value="">Error loading channels</option>';
    }
  }

  // Listen for guild selection changes
  const guildSelect = document.getElementById("GUILD_ID");
  if (guildSelect) {
    guildSelect.addEventListener("change", (e) => {
      if (e.target.value) {
        loadDiscordChannels(e.target.value);
      } else {
        const channelSelect = document.getElementById("JELLYFIN_CHANNEL_ID");
        if (channelSelect) {
          channelSelect.innerHTML = '<option value="">Select a server first...</option>';
        }
      }
    });
  }

  // Listen for token/bot ID changes to reload guilds
  const tokenInput = document.getElementById("DISCORD_TOKEN");
  const botIdInput = document.getElementById("BOT_ID");
  
  if (tokenInput) {
    tokenInput.addEventListener("blur", () => {
      if (tokenInput.value && botIdInput?.value) {
        loadDiscordGuilds();
      }
    });
  }
  
  if (botIdInput) {
    botIdInput.addEventListener("blur", () => {
      if (botIdInput.value && tokenInput?.value) {
        loadDiscordGuilds();
      }
    });
  }

  // --- User Mappings ---
  let jellyseerrUsers = [];
  let discordMembers = [];
  let currentMappings = []; // Will be array of enriched objects with metadata
  let membersLoaded = false; // Track if we've loaded members for the dropdown
  let usersLoaded = false; // Track if we've loaded jellyseerr users

  async function loadDiscordMembers() {
    if (membersLoaded && discordMembers.length > 0) {
      return;
    }
    
    try {
      const response = await fetch("/api/discord-members");
      const data = await response.json();
      
      if (data.success && data.members) {
        discordMembers = data.members;
        membersLoaded = true;
        populateDiscordMemberSelect();
      } else {
        const customSelect = document.getElementById("discord-user-select");
        if (customSelect) {
          const trigger = customSelect.querySelector(".custom-select-trigger");
          if (trigger) {
            trigger.placeholder = "Error loading members. Is bot running?";
          }
        }
        console.error("Failed to load Discord members:", data.message);
      }
    } catch (error) {
      console.error("Exception loading Discord members:", error);
      const customSelect = document.getElementById("discord-user-select");
      if (customSelect) {
        const trigger = customSelect.querySelector(".custom-select-trigger");
        if (trigger) {
          trigger.placeholder = "Error loading members";
        }
      }
    }
  }

  function populateDiscordMemberSelect() {
    const customSelect = document.getElementById("discord-user-select");
    if (!customSelect) return;

    const optionsContainer = customSelect.querySelector(".custom-select-options");
    if (!optionsContainer) return;

    optionsContainer.innerHTML = '';
    
    discordMembers.forEach(member => {
      const option = document.createElement("div");
      option.className = "custom-select-option";
      option.dataset.value = member.id;
      option.dataset.displayName = member.displayName;
      option.dataset.username = member.username;
      
      // Check if this member is already in active mappings
      const isInMapping = currentMappings.some(mapping => mapping.discordUserId === member.id);
      const checkmarkHtml = isInMapping 
        ? `<i class="bi bi-check-circle-fill" style="color: var(--green); margin-left: auto; font-size: 1.1rem;"></i>`
        : '';
      
      option.innerHTML = `
        <img src="${member.avatar}" alt="${member.displayName}">
        <div class="custom-select-option-text">
          <div class="custom-select-option-name">${member.displayName}</div>
          <div class="custom-select-option-username">@${member.username}</div>
        </div>
        ${checkmarkHtml}
      `;
      
      option.addEventListener("click", () => {
        selectDiscordUser(member);
      });
      
      optionsContainer.appendChild(option);
    });
  }

  function selectDiscordUser(member) {
    const customSelect = document.getElementById("discord-user-select");
    const trigger = customSelect.querySelector(".custom-select-trigger");
    
    // Store selected value
    customSelect.dataset.value = member.id;
    customSelect.dataset.displayName = member.displayName;
    customSelect.dataset.username = member.username;
    
    // Add has-selection class to hide input
    customSelect.classList.add("has-selection");
    
    // Create or update display element
    let display = customSelect.querySelector(".custom-select-display");
    if (!display) {
      display = document.createElement("div");
      display.className = "custom-select-display";
      customSelect.insertBefore(display, customSelect.querySelector(".custom-select-dropdown"));
    }
    
    display.innerHTML = `
      <img src="${member.avatar}" alt="${member.displayName}">
      <span>${member.displayName} (@${member.username})</span>
    `;
    
    // Force display to be visible immediately
    display.style.display = "flex";
    trigger.style.display = "none";
    
    // Mark as selected in options
    const options = customSelect.querySelectorAll(".custom-select-option");
    options.forEach(opt => {
      if (opt.dataset.value === member.id) {
        opt.classList.add("selected");
      } else {
        opt.classList.remove("selected");
      }
    });
    
    // Close dropdown and reset input
    customSelect.classList.remove("active");
    trigger.value = "";
    trigger.setAttribute("readonly", "");
  }

  async function loadJellyseerrUsers() {
    if (usersLoaded && jellyseerrUsers.length > 0) {
      return;
    }
    
    try {
      const response = await fetch("/api/jellyseerr-users");
      const data = await response.json();
      
      if (data.success && data.users) {
        jellyseerrUsers = data.users;
        usersLoaded = true;
        populateJellyseerrUserSelect();
      } else {
        console.error("Failed to load Jellyseerr users:", data.message);
      }
    } catch (error) {
      console.error("Error loading Jellyseerr users:", error);
    }
  }

  function populateJellyseerrUserSelect() {
    const customSelect = document.getElementById("jellyseerr-user-select");
    if (!customSelect) return;

    const optionsContainer = customSelect.querySelector(".custom-select-options");
    if (!optionsContainer) return;

    optionsContainer.innerHTML = '';
    
    jellyseerrUsers.forEach(user => {
      const option = document.createElement("div");
      option.className = "custom-select-option";
      option.dataset.value = user.id;
      option.dataset.displayName = user.displayName;
      option.dataset.email = user.email || '';
      option.dataset.avatar = user.avatar || '';
      
      const avatarHtml = user.avatar 
        ? `<img src="${user.avatar}" alt="${user.displayName}">`
        : `<div style="width: 36px; height: 36px; border-radius: 50%; background: var(--surface1); display: flex; align-items: center; justify-content: center; font-weight: 600; color: var(--mauve);">${user.displayName.charAt(0).toUpperCase()}</div>`;
      
      // Check if this user is already in active mappings
      const isInMapping = currentMappings.some(mapping => String(mapping.jellyseerrUserId) === String(user.id));
      const checkmarkHtml = isInMapping 
        ? `<i class="bi bi-check-circle-fill" style="color: var(--green); margin-left: auto; font-size: 1.1rem;"></i>`
        : '';
      
      option.innerHTML = `
        ${avatarHtml}
        <div class="custom-select-option-text">
          <div class="custom-select-option-name">${user.displayName}</div>
          ${user.email ? `<div class="custom-select-option-username">${user.email}</div>` : ''}
        </div>
        ${checkmarkHtml}
      `;
      
      option.addEventListener("click", () => {
        selectJellyseerrUser(user);
      });
      
      optionsContainer.appendChild(option);
    });
  }

  function selectJellyseerrUser(user) {
    const customSelect = document.getElementById("jellyseerr-user-select");
    const trigger = customSelect.querySelector(".custom-select-trigger");
    
    // Store selected value
    customSelect.dataset.value = user.id;
    customSelect.dataset.displayName = user.displayName;
    customSelect.dataset.email = user.email || '';
    customSelect.dataset.avatar = user.avatar || '';
    
    // Add has-selection class to hide input
    customSelect.classList.add("has-selection");
    
    // Create or update display element
    let display = customSelect.querySelector(".custom-select-display");
    if (!display) {
      display = document.createElement("div");
      display.className = "custom-select-display";
      customSelect.insertBefore(display, customSelect.querySelector(".custom-select-dropdown"));
    }
    
    const avatarHtml = user.avatar 
      ? `<img src="${user.avatar}" alt="${user.displayName}">`
      : `<div style="width: 32px; height: 32px; border-radius: 50%; background: var(--surface1); display: flex; align-items: center; justify-content: center; font-weight: 600; color: var(--mauve); flex-shrink: 0;">${user.displayName.charAt(0).toUpperCase()}</div>`;
    
    display.innerHTML = `
      ${avatarHtml}
      <span>${user.displayName}${user.email ? ` (${user.email})` : ''}</span>
    `;
    
    // Force display to be visible immediately
    display.style.display = "flex";
    trigger.style.display = "none";
    
    // Mark as selected in options
    const options = customSelect.querySelectorAll(".custom-select-option");
    options.forEach(opt => {
      if (opt.dataset.value === String(user.id)) {
        opt.classList.add("selected");
      } else {
        opt.classList.remove("selected");
      }
    });
    
    // Close dropdown and reset input
    customSelect.classList.remove("active");
    trigger.value = "";
    trigger.setAttribute("readonly", "");
  }

  async function loadMappings() {
    try {
      const response = await fetch("/api/user-mappings");
      currentMappings = await response.json(); // Array with metadata
      
      // Display mappings first (without avatars if members not loaded)
      displayMappings();
      
      // Then try to load Discord members for avatars
      if (!membersLoaded && currentMappings.length > 0) {
        try {
          await loadDiscordMembers();
          // Re-display with avatars
          displayMappings();
        } catch (error) {
          console.error("Error loading Discord members for avatars:", error);
          // Keep the display without avatars
        }
      }
    } catch (error) {
      console.error("Error loading mappings:", error);
    }
  }

  function displayMappings() {
    const container = document.getElementById("mappings-list");
    if (!container) return;

    if (!Array.isArray(currentMappings) || currentMappings.length === 0) {
      container.innerHTML = '<p style="opacity: 0.7; font-style: italic;">No user mappings configured yet.</p>';
      return;
    }

    container.innerHTML = currentMappings.map(mapping => {
      // Use saved metadata first, fallback to live data if available
      const discordName = mapping.discordDisplayName 
        ? `${mapping.discordDisplayName}${mapping.discordUsername ? ` (@${mapping.discordUsername})` : ''}`
        : `Discord ID: ${mapping.discordUserId}`;
      
      const jellyseerrName = mapping.jellyseerrDisplayName || `User ID: ${mapping.jellyseerrUserId}`;
      
      // Avatar for Discord user - try to find from loaded members
      const discordMember = discordMembers.find(m => m.id === mapping.discordUserId);
      const avatarHtml = discordMember?.avatar 
        ? `<img src="${discordMember.avatar}" style="width: 42px; height: 42px; border-radius: 50%; margin-right: 0.75rem; flex-shrink: 0;" alt="${discordName}">`
        : '';
      
      return `
        <div class="mapping-item">
          <div style="display: flex; align-items: center;">
            ${avatarHtml}
            <div>
              <div style="font-weight: 600; color: var(--blue);">${discordName}</div>
              <div style="opacity: 0.8; font-size: 0.9rem;">→ Jellyseerr: ${jellyseerrName}</div>
            </div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="deleteMapping('${mapping.discordUserId}')" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">
            <i class="bi bi-trash"></i> Remove
          </button>
        </div>
      `;
    }).join('');
  }

  window.deleteMapping = async function(discordUserId) {
    if (!confirm(`Remove mapping for Discord user ${discordUserId}?`)) return;

    try {
      const response = await fetch(`/api/user-mappings/${discordUserId}`, {
        method: "DELETE",
      });
      const result = await response.json();
      
      if (result.success) {
        showToast("Mapping removed successfully!");
        await loadMappings();
      } else {
        showToast(`Error: ${result.message}`);
      }
    } catch (error) {
      console.error("Error deleting mapping:", error);
      showToast("Failed to remove mapping.");
    }
  };

  const addMappingBtn = document.getElementById("add-mapping-btn");
  if (addMappingBtn) {
    addMappingBtn.addEventListener("click", async () => {
      const discordSelect = document.getElementById("discord-user-select");
      const jellyseerrSelect = document.getElementById("jellyseerr-user-select");
      const discordUserId = discordSelect.dataset.value;
      const jellyseerrUserId = jellyseerrSelect.dataset.value;

      if (!discordUserId || !jellyseerrUserId) {
        showToast("Please select both a Discord user and a Jellyseerr user.");
        return;
      }

      // Extract display names from the selected options
      const discordMember = discordMembers.find(m => m.id === discordUserId);
      const jellyseerrUser = jellyseerrUsers.find(u => String(u.id) === String(jellyseerrUserId));

      try {
        const response = await fetch("/api/user-mappings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            discordUserId, 
            jellyseerrUserId,
            discordUsername: discordMember?.username || null,
            discordDisplayName: discordMember?.displayName || null,
            jellyseerrDisplayName: jellyseerrUser?.displayName || null
          }),
        });
        const result = await response.json();

        if (result.success) {
          showToast("Mapping added successfully!");
          
          // Reset Discord custom select
          delete discordSelect.dataset.value;
          delete discordSelect.dataset.displayName;
          delete discordSelect.dataset.username;
          discordSelect.classList.remove("has-selection");
          const discordDisplay = discordSelect.querySelector(".custom-select-display");
          if (discordDisplay) discordDisplay.remove();
          const discordTrigger = discordSelect.querySelector(".custom-select-trigger");
          discordTrigger.value = "";
          discordTrigger.style.display = "block";
          
          // Reset Jellyseerr custom select
          delete jellyseerrSelect.dataset.value;
          delete jellyseerrSelect.dataset.displayName;
          delete jellyseerrSelect.dataset.email;
          jellyseerrSelect.classList.remove("has-selection");
          const jellyseerrDisplay = jellyseerrSelect.querySelector(".custom-select-display");
          if (jellyseerrDisplay) jellyseerrDisplay.remove();
          const jellyseerrTrigger = jellyseerrSelect.querySelector(".custom-select-trigger");
          jellyseerrTrigger.value = "";
          jellyseerrTrigger.style.display = "block";
          
          await loadMappings();
        } else {
          showToast(`Error: ${result.message}`);
        }
      } catch (error) {
        console.error("Error adding mapping:", error);
        showToast("Failed to add mapping.");
      }
    });
  }
  
  // Lazy load members/users when user clicks on the dropdowns
  const discordSelect = document.getElementById("discord-user-select");
  const jellyseerrSelect = document.getElementById("jellyseerr-user-select");
  
  if (discordSelect) {
    const trigger = discordSelect.querySelector(".custom-select-trigger");
    const chevron = discordSelect.querySelector(".custom-select-chevron");
    
    // Click on wrapper or trigger to open
    discordSelect.addEventListener("click", (e) => {
      // Don't open if clicking on an option
      if (e.target.closest(".custom-select-option")) return;
      
      const wasActive = discordSelect.classList.contains("active");
      const hasSelection = discordSelect.classList.contains("has-selection");
      
      // Close all other custom selects
      document.querySelectorAll(".custom-select.active").forEach(el => {
        if (el !== discordSelect) {
          el.classList.remove("active");
        }
      });
      
      if (!wasActive) {
        // Load members if not loaded
        if (!membersLoaded) {
          loadDiscordMembers();
        }
        
        // If user was selected, restore search mode
        if (hasSelection) {
          const display = discordSelect.querySelector(".custom-select-display");
          if (display) display.style.display = "none";
          trigger.style.display = "block";
          trigger.value = "";
        }
        
        discordSelect.classList.add("active");
        trigger.removeAttribute("readonly");
        trigger.focus();
      } else {
        discordSelect.classList.remove("active");
        
        // If has selection, restore display mode
        if (hasSelection) {
          const display = discordSelect.querySelector(".custom-select-display");
          if (display) display.style.display = "flex";
          trigger.style.display = "none";
        } else {
          trigger.setAttribute("readonly", "");
        }
        trigger.blur();
      }
    });
    
    // Search functionality
    trigger.addEventListener("input", (e) => {
      const searchTerm = e.target.value.toLowerCase();
      const options = discordSelect.querySelectorAll(".custom-select-option");
      
      options.forEach(option => {
        const displayName = option.dataset.displayName.toLowerCase();
        const username = option.dataset.username.toLowerCase();
        
        if (displayName.includes(searchTerm) || username.includes(searchTerm)) {
          option.style.display = "flex";
        } else {
          option.style.display = "none";
        }
      });
    });
  }
  
  function restoreDiscordTrigger() {
    const discordSelect = document.getElementById("discord-user-select");
    const trigger = discordSelect.querySelector(".custom-select-trigger");
    const selectedValue = discordSelect.dataset.value;
    
    if (selectedValue) {
      const member = discordMembers.find(m => m.id === selectedValue);
      if (member) {
        trigger.innerHTML = `
          <div class="custom-select-trigger-content">
            <img src="${member.avatar}" alt="${member.displayName}">
            <span>${member.displayName} (@${member.username})</span>
          </div>
          <i class="bi bi-chevron-down"></i>
        `;
        return;
      }
    }
    
    trigger.innerHTML = `
      <span>Select a Discord user...</span>
      <i class="bi bi-chevron-down"></i>
    `;
  }
  
  if (jellyseerrSelect) {
    const trigger = jellyseerrSelect.querySelector(".custom-select-trigger");
    const chevron = jellyseerrSelect.querySelector(".custom-select-chevron");
    
    // Click on wrapper or trigger to open
    jellyseerrSelect.addEventListener("click", (e) => {
      // Don't open if clicking on an option
      if (e.target.closest(".custom-select-option")) return;
      
      const wasActive = jellyseerrSelect.classList.contains("active");
      const hasSelection = jellyseerrSelect.classList.contains("has-selection");
      
      // Close all other custom selects
      document.querySelectorAll(".custom-select.active").forEach(el => {
        if (el !== jellyseerrSelect) {
          el.classList.remove("active");
        }
      });
      
      if (!wasActive) {
        // Load users if not loaded
        if (!usersLoaded) {
          loadJellyseerrUsers();
        }
        
        // If user was selected, restore search mode
        if (hasSelection) {
          const display = jellyseerrSelect.querySelector(".custom-select-display");
          if (display) display.style.display = "none";
          trigger.style.display = "block";
          trigger.value = "";
        }
        
        jellyseerrSelect.classList.add("active");
        trigger.removeAttribute("readonly");
        trigger.focus();
      } else {
        jellyseerrSelect.classList.remove("active");
        
        // If has selection, restore display mode
        if (hasSelection) {
          const display = jellyseerrSelect.querySelector(".custom-select-display");
          if (display) display.style.display = "flex";
          trigger.style.display = "none";
        } else {
          trigger.setAttribute("readonly", "");
        }
        trigger.blur();
      }
    });
    
    // Search functionality
    trigger.addEventListener("input", (e) => {
      const searchTerm = e.target.value.toLowerCase();
      const options = jellyseerrSelect.querySelectorAll(".custom-select-option");
      
      options.forEach(option => {
        const displayName = option.dataset.displayName.toLowerCase();
        const email = (option.dataset.email || '').toLowerCase();
        
        if (displayName.includes(searchTerm) || email.includes(searchTerm)) {
          option.style.display = "flex";
        } else {
          option.style.display = "none";
        }
      });
    });
  }
  
  function restoreJellyseerrTrigger() {
    const jellyseerrSelect = document.getElementById("jellyseerr-user-select");
    const trigger = jellyseerrSelect.querySelector(".custom-select-trigger");
    const selectedValue = jellyseerrSelect.dataset.value;
    
    if (selectedValue) {
      const user = jellyseerrUsers.find(u => String(u.id) === String(selectedValue));
      if (user) {
        trigger.innerHTML = `
          <div class="custom-select-trigger-content">
            <span>${user.displayName}${user.email ? ` (${user.email})` : ''}</span>
          </div>
          <i class="bi bi-chevron-down"></i>
        `;
        return;
      }
    }
    
    trigger.innerHTML = `
      <span>Select a Jellyseerr user...</span>
      <i class="bi bi-chevron-down"></i>
    `;
  }
  
  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".custom-select")) {
      document.querySelectorAll(".custom-select.active").forEach(el => {
        el.classList.remove("active");
        const trigger = el.querySelector(".custom-select-trigger");
        const hasSelection = el.classList.contains("has-selection");
        
        if (trigger) {
          trigger.setAttribute("readonly", "");
          trigger.blur();
          
          // If has selection, restore display mode
          if (hasSelection) {
            const display = el.querySelector(".custom-select-display");
            if (display) display.style.display = "flex";
            trigger.style.display = "none";
            trigger.value = "";
          }
        }
      });
    }
  });
  
  // --- Role Permissions ---
  let rolesLoaded = false;
  let guildRoles = [];
  
  async function loadRoles() {
    if (rolesLoaded && guildRoles.length > 0) {
      return;
    }
    
    try {
      const response = await fetch("/api/discord-roles");
      const data = await response.json();
      
      if (data.success && data.roles) {
        guildRoles = data.roles;
        rolesLoaded = true;
        
        // Load current config to get saved allowlist/blocklist
        const configResponse = await fetch("/api/config");
        const config = await configResponse.json();
        const allowlist = config.ROLE_ALLOWLIST || [];
        const blocklist = config.ROLE_BLOCKLIST || [];
        
        populateRoleList("allowlist-roles", allowlist);
        populateRoleList("blocklist-roles", blocklist);
      } else {
        document.getElementById("allowlist-roles").innerHTML = '<p class="form-text" style="opacity: 0.7; font-style: italic;">Bot must be running to load roles</p>';
        document.getElementById("blocklist-roles").innerHTML = '<p class="form-text" style="opacity: 0.7; font-style: italic;">Bot must be running to load roles</p>';
      }
    } catch (error) {
      console.error("Error loading roles:", error);
    }
  }
  
  function populateRoleList(containerId, selectedRoles) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (guildRoles.length === 0) {
      container.innerHTML = '<p class="form-text" style="opacity: 0.7; font-style: italic;">No roles available</p>';
      return;
    }

    container.innerHTML = guildRoles.map(role => {
      const isChecked = selectedRoles.includes(role.id);
      const listType = containerId.includes('allowlist') ? 'allowlist' : 'blocklist';

      return `
        <label class="role-item">
          <input type="checkbox"
                 name="${listType === 'allowlist' ? 'ROLE_ALLOWLIST' : 'ROLE_BLOCKLIST'}"
                 value="${role.id}"
                 ${isChecked ? 'checked' : ''}>
          <div class="role-color-indicator" style="background-color: ${role.color || '#99aab5'};"></div>
          <span class="role-name">${role.name}</span>
          <span class="role-member-count">${role.memberCount || 0} members</span>
        </label>
      `;
    }).join('');
  }

  // --- LOGS PAGE FUNCTIONALITY ---
  const logsPageBtn = document.getElementById("logs-page-btn");
  const logsSection = document.getElementById("logs-section");
  const setupSection = document.getElementById("setup");
  const logsContainer = document.getElementById("logs-container");
  const logsTabBtns = document.querySelectorAll(".logs-tab-btn");
  const botControlBtnLogs = document.getElementById("bot-control-btn-logs");
  const botControlTextLogs = document.getElementById("bot-control-text-logs");
  let currentLogsTab = "all";

  // Logs page button click handler
  logsPageBtn.addEventListener("click", async () => {
    setupSection.style.display = "none";
    logsSection.style.display = "block";
    window.scrollTo(0, 0);
    await loadLogs(currentLogsTab);
    updateConnectionStatus();
    updateBotControlButtonLogs();
  });

  // Logs tab switching
  logsTabBtns.forEach(btn => {
    btn.addEventListener("click", async () => {
      logsTabBtns.forEach(b => {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      currentLogsTab = btn.dataset.target;
      await loadLogs(currentLogsTab);
    });
  });

  // Load and display logs
  async function loadLogs(type) {
    try {
      logsContainer.innerHTML = '<div style="text-align: center; color: var(--subtext0);">Loading logs...</div>';
      const endpoint = type === "error" ? "/api/logs/error" : "/api/logs/all";
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();

      if (data.entries.length === 0) {
        logsContainer.innerHTML = '<div class="logs-empty">No logs available</div>';
        return;
      }

      logsContainer.innerHTML = data.entries.map(entry => `
        <div class="log-entry">
          <span class="log-timestamp">${entry.timestamp}</span>
          <span class="log-level ${entry.level}">${entry.level.toUpperCase()}</span>
          <span class="log-message">${escapeHtml(entry.message)}</span>
        </div>
      `).join('');
    } catch (error) {
      logsContainer.innerHTML = `<div class="logs-empty">Error loading logs: ${error.message}</div>`;
    }
  }

  // Helper function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Update connection status indicators
  async function updateConnectionStatus() {
    try {
      // Test Jellyseerr
      try {
        const jellyseerrResponse = await fetch("/api/test-jellyseerr", { method: "POST" });
        const jellyseerrStatusIndicator = document.getElementById("jellyseerr-status-indicator");
        jellyseerrStatusIndicator.style.backgroundColor = jellyseerrResponse.ok ? "#a6e3a1" : "#f38ba8";
      } catch {
        document.getElementById("jellyseerr-status-indicator").style.backgroundColor = "#f38ba8";
      }

      // Test Jellyfin
      try {
        const jellyfinResponse = await fetch("/api/test-jellyfin", { method: "POST" });
        const jellyfinStatusIndicator = document.getElementById("jellyfin-status-indicator");
        jellyfinStatusIndicator.style.backgroundColor = jellyfinResponse.ok ? "#a6e3a1" : "#f38ba8";
      } catch {
        document.getElementById("jellyfin-status-indicator").style.backgroundColor = "#f38ba8";
      }
    } catch (error) {
      console.error("Error updating connection status:", error);
    }
  }

  // Update bot control button for logs page
  function updateBotControlButtonLogs() {
    if (isBotRunning) {
      botControlBtnLogs.classList.remove("btn-danger");
      botControlBtnLogs.classList.add("btn-success");
      botControlBtnLogs.querySelector("i").className = "bi bi-stop-fill";
      botControlTextLogs.textContent = "Stop Bot";
    } else {
      botControlBtnLogs.classList.remove("btn-success");
      botControlBtnLogs.classList.add("btn-danger");
      botControlBtnLogs.querySelector("i").className = "bi bi-play-fill";
      botControlTextLogs.textContent = "Start Bot";
    }
  }

  // Bot control button for logs page
  botControlBtnLogs.addEventListener("click", async () => {
    try {
      const endpoint = isBotRunning ? "/api/stop-bot" : "/api/start-bot";
      const response = await fetch(endpoint, { method: "POST" });
      const data = await response.json();
      showToast(data.message);
      isBotRunning = !isBotRunning;
      updateBotControlButtonLogs();
    } catch (error) {
      showToast(`Error: ${error.message}`);
    }
  });

  // Back to setup button (reuse nav items logic for logs section)
  document.querySelectorAll(".nav-item, .about-button, .about-link").forEach(item => {
    item.addEventListener("click", (e) => {
      if (logsSection.style.display !== "none") {
        e.preventDefault();
        logsSection.style.display = "none";
        setupSection.style.display = "block";
        window.scrollTo(0, 0);
      }
    });
  });
});
