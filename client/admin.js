class AdminPanel {
  constructor() {
    this.password = null;
    this.autoRefreshInterval = null;
    this.isAutoRefreshing = false;
    const overrideApi = window.API_BASE_URL;
    const { protocol, hostname, port } = window.location;
    const devApiHost = `${hostname}:5233`;
    const resolvedHost =
      port === "4031" || hostname === "localhost" || hostname === "127.0.0.1"
        ? devApiHost
        : window.location.host;
    this.apiBaseUrl = overrideApi || `${protocol}//${resolvedHost}`;
    this.setupEventListeners();
  }

  setupEventListeners() {
    document.getElementById("login-btn").addEventListener("click", () => {
      this.login();
    });
    document
      .getElementById("admin-password")
      .addEventListener("keypress", (e) => {
        if (e.key === "Enter") this.login();
      });
    document.getElementById("start-game-btn").addEventListener("click", () => {
      this.startGame();
    });
    document
      .getElementById("refresh-stats-btn")
      .addEventListener("click", () => {
        this.refreshStats();
      });
    document
      .getElementById("auto-refresh-btn")
      .addEventListener("click", () => {
        this.toggleAutoRefresh();
      });
    document.getElementById("end-game-btn").addEventListener("click", () => {
      this.endGame();
    });
    document.getElementById("logout-btn").addEventListener("click", () => {
      this.logout();
    });
  }

  async login() {
    const passwordInput = document.getElementById("admin-password");
    const password = passwordInput.value.trim();
    if (!password) {
      this.showLoginError("Please enter a password");
      return;
    }
    try {
      const response = await fetch(
        this.apiBaseUrl + "/admin/stats?" + new URLSearchParams({ password })
      );
      if (response.ok) {
        this.password = password;
        this.showAdminPanel();
        this.refreshStats();
        this.hideLoginError();
      } else {
        const error = await response.json();
        this.showLoginError(error.error || "Invalid password");
      }
    } catch (e) {
      this.showLoginError(
        "Connection error. Please check if the server is running."
      );
    }
  }

  logout() {
    this.password = null;
    this.hideAdminPanel();
    this.stopAutoRefresh();
    document.getElementById("admin-password").value = "";
  }

  showAdminPanel() {
    document.getElementById("login-section").classList.add("hidden");
    document.getElementById("admin-panel").classList.remove("hidden");
  }
  hideAdminPanel() {
    document.getElementById("login-section").classList.remove("hidden");
    document.getElementById("admin-panel").classList.add("hidden");
  }

  showLoginError(message) {
    const el = document.getElementById("login-error");
    el.textContent = message;
    el.style.display = "block";
  }
  hideLoginError() {
    document.getElementById("login-error").style.display = "none";
  }
  showAdminMessage(message) {
    const el = document.getElementById("admin-message");
    el.textContent = message;
    el.style.display = "block";
    setTimeout(() => {
      el.style.display = "none";
    }, 3000);
  }
  showAdminError(message) {
    const el = document.getElementById("admin-error");
    el.textContent = message;
    el.style.display = "block";
    setTimeout(() => {
      el.style.display = "none";
    }, 5000);
  }

  parseLevelScript() {
    const raw = document.getElementById("level-script").value.trim();
    if (!raw) return null;
    try {
      const json = JSON.parse(raw);
      if (!Array.isArray(json)) throw new Error("Level must be an array");
      for (const evt of json) {
        if (typeof evt.atMs !== "number") throw new Error("Invalid atMs");
        if (!["MONSTER", "OBSTACLE"].includes(evt.type))
          throw new Error("Invalid type");
        if (!["LEFT", "CENTER", "RIGHT"].includes(evt.lane))
          throw new Error("Invalid lane");
      }
      return json;
    } catch (e) {
      this.showAdminError("Invalid level JSON: " + e.message);
      return null;
    }
  }

  async startGame() {
    if (!this.password) return;
    const script = this.parseLevelScript();
    if (
      script === null &&
      document.getElementById("level-script").value.trim() !== ""
    )
      return;
    try {
      const response = await fetch(this.apiBaseUrl + "/admin/start-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: this.password,
          script: script || undefined,
        }),
      });
      const result = await response.json();
      if (response.ok) {
        this.showAdminMessage(result.message || "Game started successfully");
        this.refreshStats();
      } else {
        this.showAdminError(result.error || "Failed to start game");
      }
    } catch (e) {
      this.showAdminError(
        "Connection error. Please check if the server is running."
      );
    }
  }

  async endGame() {
    if (!this.password) return;
    try {
      const response = await fetch(this.apiBaseUrl + "/admin/end-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: this.password }),
      });
      const result = await response.json();
      if (response.ok) {
        this.showAdminMessage(result.message || "Game ending");
        this.refreshStats();
      } else {
        this.showAdminError(result.error || "Failed to end game");
      }
    } catch (e) {
      this.showAdminError(
        "Connection error. Please check if the server is running."
      );
    }
  }

  async refreshStats() {
    if (!this.password) return;
    try {
      const response = await fetch(
        this.apiBaseUrl +
          "/admin/stats?" +
          new URLSearchParams({ password: this.password })
      );
      if (response.ok) {
        const stats = await response.json();
        this.updateStatsDisplay(stats);
      } else {
        const error = await response.json();
        this.showAdminError(error.error || "Failed to fetch stats");
      }
    } catch (e) {
      this.showAdminError(
        "Connection error. Please check if the server is running."
      );
    }
  }

  updateStatsDisplay(stats) {
    document.getElementById("total-players").textContent =
      stats.totalPlayers || 0;
    document.getElementById("active-players").textContent =
      stats.activePlayers || 0;
    document.getElementById("eliminated-players").textContent =
      stats.eliminatedPlayers || 0;
    document.getElementById("round-number").textContent =
      stats.roundNumber || 0;
    document.getElementById("current-monsters").textContent =
      stats.currentMonsters || 0;
    document.getElementById("current-obstacles").textContent =
      stats.currentObstacles || 0;
    const statusText = document.getElementById("round-status-text");
    statusText.textContent = stats.roundActive
      ? "Active"
      : stats.activePlayers > 0
      ? "Waiting"
      : "Inactive";
    const startGameBtn = document.getElementById("start-game-btn");
    if (stats.roundActive) {
      startGameBtn.disabled = true;
      startGameBtn.textContent = "Round in Progress";
    } else {
      startGameBtn.disabled = false;
      startGameBtn.textContent = "Start Round";
    }
  }

  toggleAutoRefresh() {
    const btn = document.getElementById("auto-refresh-btn");
    if (this.isAutoRefreshing) {
      this.stopAutoRefresh();
      btn.textContent = "Enable Auto-Refresh";
      btn.classList.remove("danger");
    } else {
      this.startAutoRefresh();
      btn.textContent = "Disable Auto-Refresh";
      btn.classList.add("danger");
    }
  }
  startAutoRefresh() {
    this.isAutoRefreshing = true;
    this.autoRefreshInterval = setInterval(() => this.refreshStats(), 3000);
  }
  stopAutoRefresh() {
    this.isAutoRefreshing = false;
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new AdminPanel();
});
