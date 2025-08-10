(function () {
  function getParams() {
    const params = new URLSearchParams(window.location.search);
    const roleParam = (params.get("role") || "").toUpperCase();
    const role = ["ENEMY", "SHOOTER_A", "SHOOTER_B"].includes(roleParam)
      ? roleParam
      : null;
    const socketUrl = params.get("socket");
    return { role, socketUrl };
  }

  function resolveSocketUrl(passed) {
    if (passed) return passed;
    const { protocol, hostname, port } = window.location;
    const devApiHost = `${hostname}:5233`;
    const resolvedHost =
      port === "4031" || hostname === "localhost" || hostname === "127.0.0.1"
        ? devApiHost
        : window.location.host;
    return `${protocol}//${resolvedHost}`;
  }

  class PhoneController {
    constructor() {
      const { role, socketUrl } = getParams();
      this.role = role;
      this.socketUrl = resolveSocketUrl(socketUrl);
      this.socket = null;
      this.lastHoriz = 0;
      this.lastShakeAt = 0;
      this.shakeCooldownMs = 0;
      this.motionEnabled = false;
      this.accThreshold = 18;
      this.feedbackTimer = null;
      this.init();
    }

    init() {
      if (!this.role) {
        document.getElementById("role").textContent = "Role: -";
        document.getElementById("status").textContent = "Not linked. Scan QR from main screen.";
        return;
      }
      document.getElementById("role").textContent = `Role: ${this.role}`;
      this.bindUI();
      this.connect();
    }

    bindUI() {
      document.getElementById("perm").addEventListener("click", () => {
        this.enableMotion();
      });
    }

    connect() {
      if (!this.role) return;
      this.socket = io(this.socketUrl, { transports: ["websocket"], upgrade: false });
      this.socket.on("connect", () => {
        document.getElementById("status").textContent = "Connected";
        this.socket.emit("pair-controller", this.role);
      });
      this.socket.on("disconnect", () => {
        document.getElementById("status").textContent = "Disconnected";
      });
      this.socket.on("controller-shake", (payload) => {
        this.showFeedback("Shake: good!");
      });
    }

    enableMotion() {
      if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
        DeviceMotionEvent.requestPermission().then((state) => {
          if (state === "granted") this.startMotion();
        });
      } else {
        this.startMotion();
      }
    }

    startMotion() {
      if (this.motionEnabled) return;
      this.motionEnabled = true;
      window.addEventListener("devicemotion", (e) => this.onDeviceMotion(e), { passive: true });
      document.getElementById("status").textContent = "Motion Ready";
    }

    onDeviceMotion(e) {
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const ax = acc.x || 0, ay = acc.y || 0, az = acc.z || 0;
      this.lastHoriz = ax;
      const magnitude = Math.sqrt(ax * ax + ay * ay + az * az);
      if (magnitude > this.accThreshold) this.onShake();
    }

    onShake() {
      const now = Date.now();
      if (this.role === "ENEMY" && now - this.lastShakeAt < 900) return;
      this.lastShakeAt = now;
      this.showFeedback("Shake: good!");
      if (!this.socket || !this.socket.connected) return;
      if (this.role === "ENEMY") this.emitTide();
      else this.emitShoot();
    }

    emitShoot() {
      if (!this.socket || !this.socket.connected) return;
      const lane = this.deriveLane();
      if (lane) this.socket.emit("shoot", lane);
    }

    emitTide() {
      if (!this.socket || !this.socket.connected) return;
      const dir = this.deriveDirection();
      this.socket.emit("tide-shift", dir);
    }

    deriveLane() {
      const h = this.lastHoriz || 0;
      if (h > 2) return "RIGHT";
      if (h < -2) return "LEFT";
      return "CENTER";
    }

    deriveDirection() {
      const h = this.lastHoriz || 0;
      return h >= 0 ? "RIGHT" : "LEFT";
    }

    showFeedback(msg) {
      const el = document.getElementById("shake-feedback");
      if (!el) return;
      el.textContent = msg;
      el.style.opacity = "1";
      if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
      this.feedbackTimer = setTimeout(() => {
        el.style.opacity = "0.85";
      }, 1000);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    new PhoneController();
  });
})();


