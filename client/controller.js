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
      this.currentLane = "CENTER";
      this.tideDirection = "RIGHT";
      this.lastShakeAt = 0;
      this.shakeCooldownMs = 900;
      this.motionEnabled = false;
      this.accThreshold = 18;
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
      document.getElementById("test").addEventListener("click", () => {
        this.onShake();
      });
      const shooterBox = document.getElementById("shooter-controls");
      const enemyBox = document.getElementById("enemy-controls");
      if (this.role === "ENEMY") enemyBox.style.display = "grid";
      else shooterBox.style.display = "grid";
      const leftBtn = document.getElementById("dir-left");
      const rightBtn = document.getElementById("dir-right");
      leftBtn.addEventListener("click", () => {
        this.tideDirection = "LEFT";
        leftBtn.classList.add("active");
        rightBtn.classList.remove("active");
      });
      rightBtn.addEventListener("click", () => {
        this.tideDirection = "RIGHT";
        rightBtn.classList.add("active");
        leftBtn.classList.remove("active");
      });
      document.getElementById("confirm-tide").addEventListener("click", () => {
        this.emitTide();
      });
      document.getElementById("shoot").addEventListener("click", () => {
        this.emitShoot();
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
      const magnitude = Math.sqrt(ax * ax + ay * ay + az * az);
      if (magnitude > this.accThreshold) this.onShake();
      const horiz = ax;
      if (horiz > 2) this.updateLane("RIGHT");
      else if (horiz < -2) this.updateLane("LEFT");
      else this.updateLane("CENTER");
    }

    updateLane(lane) {
      if (lane === this.currentLane) return;
      this.currentLane = lane;
      const el = document.getElementById("lane");
      el.textContent = lane;
      if (this.socket && this.socket.connected) this.socket.emit("movement", lane === "LEFT" ? "LEFT" : lane === "RIGHT" ? "RIGHT" : "STILL");
    }

    onShake() {
      const now = Date.now();
      if (now - this.lastShakeAt < this.shakeCooldownMs) return;
      this.lastShakeAt = now;
      if (this.role === "ENEMY") this.emitTide();
      else this.emitShoot();
    }

    emitShoot() {
      if (!this.socket || !this.socket.connected) return;
      const lane = this.currentLane;
      if (lane === "CENTER" || lane === "LEFT" || lane === "RIGHT") this.socket.emit("shoot", lane);
    }

    emitTide() {
      if (!this.socket || !this.socket.connected) return;
      this.socket.emit("tide-shift", this.tideDirection);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    new PhoneController();
  });
})();


