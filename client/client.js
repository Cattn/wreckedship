class PersonTracker {
  constructor() {
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.pose = null;
    this.camera = null;

    this.isInitialized = false;
    this.lastDetectionTime = 0;
    this.frameCount = 0;
    this.lastFpsTime = Date.now();

    this.baselineX = null;
    this.currentX = null;
    this.movementThreshold = 0.15;
    this.stillFramesThreshold = 30;
    this.stillFramesCount = 0;
    this.lastMovement = "STILL";

    this.movementCallbacks = {
      onMoveLeft: () => console.log("Move Left"),
      onMoveRight: () => console.log("Move Right"),
      onStill: () => console.log("Still"),
    };

    this.init();
  }

  async init() {
    try {
      this.updateStatus("camera-status", "Initializing...");
      this.updateStatus("detection-status", "Loading model...");

      await this.setupCamera();
      await this.setupPoseDetection();
      await this.startCamera();

      this.isInitialized = true;
      this.updateStatus("camera-status", "Active");
      this.updateStatus("detection-status", "Ready");
      this.updateMovementStatus("READY");
    } catch (error) {
      this.showError(`Initialization failed: ${error.message}`);
      console.error("Initialization error:", error);
    }
  }

  async setupCamera() {
    this.video = document.getElementById("video");
    this.canvas = document.getElementById("canvas");
    this.ctx = this.canvas.getContext("2d");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera access not supported");
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        },
      });

      this.video.srcObject = stream;
      await new Promise((resolve) => {
        this.video.onloadedmetadata = resolve;
      });
    } catch (error) {
      throw new Error(`Camera access denied: ${error.message}`);
    }
  }

  async setupPoseDetection() {
    try {
      this.pose = new Pose({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        },
      });

      this.pose.setOptions({
        modelComplexity: 0,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: false,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
        upperbodyOnly: false,
      });

      this.pose.onResults(this.onPoseResults.bind(this));
    } catch (err) {
      this.showError("Pose module blocked by CSP. Movement disabled.");
      console.error("Pose init error:", err);
      this.pose = null;
    }

    this.camera = new Camera(this.video, {
      onFrame: async () => {
        if (this.isInitialized && this.pose) {
          try {
            await this.pose.send({ image: this.video });
          } catch (e) {
          }
        }
      },
      width: 640,
      height: 480,
    });
  }

  async startCamera() {
    await this.camera.start();
    this.startFpsCounter();
  }

  onPoseResults(results) {
    this.frameCount++;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (results.poseLandmarks && results.poseLandmarks.length > 0) {
      this.processPoseDetection(results.poseLandmarks);
      this.drawPoseOverlay(results.poseLandmarks);
      this.updateStatus("detection-status", "Person detected");
    } else {
      this.updateStatus("detection-status", "No person detected");
      this.resetMovementTracking();
    }
  }

  processPoseDetection(landmarks) {
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];

    if (leftShoulder.visibility > 0.6 && rightShoulder.visibility > 0.6) {
      const centerX = (leftShoulder.x + rightShoulder.x) / 2;
      this.currentX = centerX;

      if (this.baselineX === null) {
        this.baselineX = centerX;
        this.updateMovementStatus("CALIBRATED");
        return;
      }

      this.classifyMovement();
    }
  }

  classifyMovement() {
    const deltaX = this.currentX - this.baselineX;
    let movement = "STILL";

    // reverse to match person's perspective
    if (deltaX > this.movementThreshold) {
      movement = "LEFT";
      this.stillFramesCount = 0;
    } else if (deltaX < -this.movementThreshold) {
      movement = "RIGHT";
      this.stillFramesCount = 0;
    } else {
      movement = "STILL";
      this.stillFramesCount++;

      if (this.stillFramesCount > this.stillFramesThreshold) {
        this.baselineX = this.currentX;
        this.stillFramesCount = 0;
      }
    }

    if (movement !== this.lastMovement) {
      this.lastMovement = movement;
      this.updateMovementStatus(movement);
      this.triggerMovementCallback(movement);
    }
  }

  triggerMovementCallback(movement) {
    switch (movement) {
      case "LEFT":
        this.movementCallbacks.onMoveLeft();
        break;
      case "RIGHT":
        this.movementCallbacks.onMoveRight();
        break;
      case "STILL":
        this.movementCallbacks.onStill();
        break;
    }
  }

  drawPoseOverlay(landmarks) {
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];

    if (leftShoulder.visibility > 0.6 && rightShoulder.visibility > 0.6) {
      const centerX = (leftShoulder.x + rightShoulder.x) / 2;
      const centerY = (leftShoulder.y + rightShoulder.y) / 2;

      this.ctx.strokeStyle = "#4ecdc4";
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.moveTo(centerX * this.canvas.width, 0);
      this.ctx.lineTo(centerX * this.canvas.width, this.canvas.height);
      this.ctx.stroke();

      this.ctx.fillStyle = "#ff6b6b";
      this.ctx.beginPath();
      this.ctx.arc(
        centerX * this.canvas.width,
        centerY * this.canvas.height,
        8,
        0,
        2 * Math.PI
      );
      this.ctx.fill();

      if (this.baselineX !== null) {
        this.ctx.strokeStyle = "#ffe66d";
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(this.baselineX * this.canvas.width, 0);
        this.ctx.lineTo(this.baselineX * this.canvas.width, this.canvas.height);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
      }

      const shoulderWidth =
        Math.abs(rightShoulder.x - leftShoulder.x) * this.canvas.width;
      const shoulderHeight =
        Math.abs(rightShoulder.y - leftShoulder.y) * this.canvas.height;
      const boundingBoxX =
        Math.min(leftShoulder.x, rightShoulder.x) * this.canvas.width -
        shoulderWidth * 0.5;
      const boundingBoxY =
        Math.min(leftShoulder.y, rightShoulder.y) * this.canvas.height -
        shoulderHeight * 2;
      const boundingBoxWidth = shoulderWidth * 2;
      const boundingBoxHeight = shoulderHeight * 4;

      this.ctx.strokeStyle = "#ffffff";
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(
        boundingBoxX,
        boundingBoxY,
        boundingBoxWidth,
        boundingBoxHeight
      );
    }
  }

  resetMovementTracking() {
    this.baselineX = null;
    this.currentX = null;
    this.stillFramesCount = 0;
    if (this.lastMovement !== "STILL") {
      this.lastMovement = "STILL";
      this.updateMovementStatus("NO PERSON");
    }
  }

  startFpsCounter() {
    setInterval(() => {
      const now = Date.now();
      const fps = Math.round(
        (this.frameCount * 1000) / (now - this.lastFpsTime)
      );
      this.updateStatus("fps", fps);
      this.frameCount = 0;
      this.lastFpsTime = now;
    }, 1000);
  }

  updateStatus(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = value;
    }
  }

  updateMovementStatus(movement) {
    const element = document.getElementById("movement-status");
    if (element) {
      element.textContent = movement;
      element.className = "movement";

      switch (movement) {
        case "LEFT":
          element.classList.add("left");
          break;
        case "RIGHT":
          element.classList.add("right");
          break;
        case "STILL":
        case "CALIBRATED":
        case "READY":
          element.classList.add("still");
          break;
      }
    }
  }

  showError(message) {
    const errorElement = document.getElementById("error-message");
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.style.display = "block";
    }
  }

  setMovementCallbacks(callbacks) {
    this.movementCallbacks = { ...this.movementCallbacks, ...callbacks };
  }

  setMovementThreshold(threshold) {
    this.movementThreshold = threshold;
  }
}

class GameClient {
  constructor(tracker) {
    this.tracker = tracker;
    this.socket = null;
    this.currentLane = "CENTER";
    this.role = this.resolveRoleFromUrl();
    this.laneElements = {
      LEFT: document.getElementById("lane-left"),
      CENTER: document.getElementById("lane-center"),
      RIGHT: document.getElementById("lane-right"),
    };
    this.laneEntityContainers = {
      LEFT: document.getElementById("lane-left-entities"),
      CENTER: document.getElementById("lane-center-entities"),
      RIGHT: document.getElementById("lane-right-entities"),
    };
    this.assets = {
      cursorUrl: (window.SPRITES && window.SPRITES.cursor) || null,
      monsterUrl: (window.SPRITES && window.SPRITES.monster) || null,
      obstacleUrl: (window.SPRITES && window.SPRITES.obstacle) || null,
      laneBgUrl: (window.SPRITES && window.SPRITES.laneBg) || null,
    };
    this.entities = { monsters: [], obstacles: [] };
    this.entityElements = new Map();
    this.travelMs = 2200;
    this.rafId = null;
    this.toastEl = null;
    this.updateRoleHud();
    this.setupCursorSprites();
    this.setupLaneBackgrounds();
    this.setupSocket();
    this.bindMovementCallbacks();
    this.configureControllerCardsVisibility();
    this.renderQRCodes();
    this.renderCursor();
    this.startAnimationLoop();
  }

  resolveRoleFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const roleParam = (params.get("role") || "").toUpperCase();
    if (roleParam === "SHOOTER") return "SHOOTER_A";
    if (["CAPTAIN", "SHOOTER_A", "SHOOTER_B", "ENEMY"].includes(roleParam))
      return roleParam;
    return null;
  }

  updateRoleHud() {
    const el = document.getElementById("role");
    if (el) el.textContent = `Role: ${this.role}`;
  }

  configureControllerCardsVisibility() {
    const roleToCardId = {
      SHOOTER_A: "card-shooter-a",
      SHOOTER_B: "card-shooter-b",
      ENEMY: "card-enemy",
      CAPTAIN: null,
    };
    const showId = roleToCardId[this.role] || null;
    const cards = [
      document.getElementById("card-shooter-a"),
      document.getElementById("card-shooter-b"),
      document.getElementById("card-enemy"),
    ];
    if (this.role === "CAPTAIN") {
      for (const c of cards) if (c) c.style.display = "none";
      return;
    }
    for (const c of cards) if (c) c.style.display = "none";
    if (showId) {
      const el = document.getElementById(showId);
      if (el) el.style.display = "block";
    }
  }

  setupSocket() {
    const overrideUrl = window.SOCKET_URL;
    const { protocol, hostname, port } = window.location;
    const devApiHost = `${hostname}:5233`;
    const resolvedHost =
      port === "4032" || hostname === "localhost" || hostname === "127.0.0.1"
        ? devApiHost
        : window.location.host;
    const url = overrideUrl || `${protocol}//${resolvedHost}`;
    this.socket = io(url, { transports: ["websocket"], upgrade: false });
    this.socket.on("connect", () => {
      this.socket.emit("join", this.role || "AUTO");
    });
    this.socket.on("joined", (payload) => {
      if (payload && payload.role) {
        this.role = payload.role;
        this.updateRoleHud();
        this.configureControllerCardsVisibility();
      }
      const waitEl = document.getElementById("waiting-message");
      if (waitEl) waitEl.style.display = "none";
    });
    this.socket.on("waiting", () => {
      const waitEl = document.getElementById("waiting-message");
      if (waitEl) {
        waitEl.textContent = "waiting on new game";
        waitEl.style.display = "block";
      }
    });
    this.socket.on("entities", (payload) => {
      this.entities = payload || { monsters: [], obstacles: [] };
      this.renderEntities();
    });
    this.socket.on("players-updated", (players) => {
      this.updateControllerStatuses(players || []);
    });
    this.socket.on("controllers-updated", (readiness) => {
      this.applyControllersReadiness(readiness || {});
    });
    this.socket.on("controller-shake", (payload) => {
      if (!payload || !payload.fromRole) return;
      if (payload.type === "SHOOT") {
        if (this.role !== "SHOOTER_A" && this.role !== "SHOOTER_B") return;
      } else if (payload.type === "TIDE") {
        if (this.role !== "ENEMY") return;
      } else {
        return;
      }
      this.showShakeToast(payload);
    });
    this.socket.on("monster-destroyed", (payload) => {
      console.log("monster-destroyed received", payload);
      if (!payload || !payload.id) return;
      this.removeEntityImmediate(payload.id);
      if (this.entities && Array.isArray(this.entities.monsters)) {
        this.entities.monsters = this.entities.monsters.filter((m) => m.id !== payload.id);
        console.log("monsters remaining", this.entities.monsters.length);
      }
    });
    this.socket.on("round-started", () => {});
    this.socket.on("round-ended", () => {
      this.entities = { monsters: [], obstacles: [] };
      this.renderEntities();
    });
  }

  bindMovementCallbacks() {
    this.tracker.setMovementCallbacks({
      onMoveLeft: () => {
        console.log("🡸 Person moved LEFT");
        this.onMovement("LEFT");
      },
      onMoveRight: () => {
        console.log("🡺 Person moved RIGHT");
        this.onMovement("RIGHT");
      },
      onStill: () => {
        console.log("⏸ Person is STILL");
        this.onMovement("STILL");
      },
    });
  }

  onMovement(direction) {
    if (this.socket && this.socket.connected)
      this.socket.emit("movement", direction);
    if (direction === "LEFT") this.currentLane = "LEFT";
    else if (direction === "RIGHT") this.currentLane = "RIGHT";
    else this.currentLane = "CENTER";
    this.renderCursor();
  }

  setupCursorSprites() {
    if (!this.assets.cursorUrl) return;
    Object.values(this.laneElements).forEach((lane) => {
      const el = lane.querySelector(".lane-cursor");
      if (el) {
        el.style.background = "transparent";
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.backgroundImage = `url(${this.assets.cursorUrl})`;
        el.style.backgroundSize = "contain";
        el.style.backgroundRepeat = "no-repeat";
        el.style.backgroundPosition = "center";
      }
    });
  }

  setupLaneBackgrounds() {
    if (!this.assets.laneBgUrl) return;
    Object.values(this.laneElements).forEach((lane) => {
      lane.style.backgroundImage = `url(${this.assets.laneBgUrl})`;
      lane.style.backgroundSize = "cover";
      lane.style.backgroundPosition = "center";
      lane.style.backgroundRepeat = "no-repeat";
    });
  }

  renderQRCodes() {
    const a = document.getElementById("qr-shooter-a");
    const b = document.getElementById("qr-shooter-b");
    const e = document.getElementById("qr-enemy");
    if (!a && !b && !e) return;
    const { protocol, hostname, port } = window.location;
    const devApiHost = `${hostname}:5233`;
    const resolvedHost =
      port === "4032" || hostname === "localhost" || hostname === "127.0.0.1"
        ? devApiHost
        : window.location.host;
    const makeUrl = (role) => {
      const u = new URL("controller.html", window.location.href);
      u.searchParams.set("role", role);
      return u.toString();
    };
    const draw = (id, url) => {
      if (!window.QRCode) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = "";
      el.style.width = "272px";
      el.style.height = "272px";
      el.style.padding = "8px";
      el.style.background = "#ffffff";
      el.style.boxSizing = "border-box";
      new window.QRCode(id, url);
      const child = el.querySelector("canvas, img");
      if (child) {
        child.style.width = "256px";
        child.style.height = "256px";
        child.style.display = "block";
        child.style.margin = "0 auto";
        child.style.imageRendering = "pixelated";
      }
    };
    const urlA = makeUrl("SHOOTER_A");
    const urlB = makeUrl("SHOOTER_B");
    const urlE = makeUrl("ENEMY");
    console.log("QR URL (SHOOTER_A):", urlA);
    console.log("QR URL (SHOOTER_B):", urlB);
    console.log("QR URL (ENEMY):", urlE);
    draw("qr-shooter-a", urlA);
    draw("qr-shooter-b", urlB);
    draw("qr-enemy", urlE);
  }

  updateControllerStatuses(players) {
    const byRole = new Map();
    for (const p of players) byRole.set(p.role, p);
    const showForCaptain = this.role === "CAPTAIN";
    const apply = (roleKey, qrId, statusId) => {
      const qr = document.getElementById(qrId);
      const st = document.getElementById(statusId);
      const player = byRole.get(roleKey);
      if (!qr || !st) return;
      if (showForCaptain) { 
        qr.style.display = "none";
        st.textContent = player ? "Connected" : "--";
        st.classList.toggle("ready", !!player);
        return;
      }
      if (player) {
        qr.style.display = "none";
        st.textContent = "Ready";
        st.classList.add("ready");
      } else {
        qr.style.display = "block";
        st.textContent = "Scan to connect";
        st.classList.remove("ready");
      }
    };
    apply("SHOOTER_A", "qr-shooter-a", "status-shooter-a");
    apply("SHOOTER_B", "qr-shooter-b", "status-shooter-b");
    apply("ENEMY", "qr-enemy", "status-enemy");
  }

  applyControllersReadiness(readiness) {
    const set = (id, isReady) => {
      const qr = document.getElementById(id.qr);
      const st = document.getElementById(id.status);
      if (!qr || !st) return;
      if (this.role === "CAPTAIN") {
        qr.style.display = "none";
        st.textContent = isReady ? "Ready" : "Scan to connect";
        st.classList.toggle("ready", !!isReady);
        return;
      }
      if (isReady) {
        qr.style.display = "none";
        st.textContent = "Ready";
        st.classList.add("ready");
      } else {
        qr.style.display = "block";
        st.textContent = "Scan to connect";
        st.classList.remove("ready");
      }
    };
    set({ qr: "qr-shooter-a", status: "status-shooter-a" }, !!readiness.SHOOTER_A);
    set({ qr: "qr-shooter-b", status: "status-shooter-b" }, !!readiness.SHOOTER_B);
    set({ qr: "qr-enemy", status: "status-enemy" }, !!readiness.ENEMY);
  }

  renderCursor() {
    Object.entries(this.laneElements).forEach(([laneName, laneEl]) => {
      if (!laneEl) return;
      if (laneName === this.currentLane) laneEl.classList.add("active");
      else laneEl.classList.remove("active");
    });
  }

  removeEntityImmediate(entityId) {
    const el = this.entityElements && this.entityElements.get(entityId);
    if (el && el.parentElement) {
      el.parentElement.removeChild(el);
      console.log("removed entity element", entityId);
    } else {
      console.log("entity element not found or no parent", entityId);
    }
    if (this.entityElements) this.entityElements.delete(entityId);
  }

  ensureToast() {
    if (this.toastEl) return this.toastEl;
    const el = document.createElement("div");
    el.style.position = "fixed";
    el.style.bottom = "16px";
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    el.style.background = "#111827";
    el.style.color = "#fff";
    el.style.padding = "10px 14px";
    el.style.border = "1px solid #334155";
    el.style.borderRadius = "10px";
    el.style.fontSize = "14px";
    el.style.boxShadow = "0 6px 20px rgba(0,0,0,0.35)";
    el.style.opacity = "0";
    el.style.transition = "opacity 120ms ease";
    document.body.appendChild(el);
    this.toastEl = el;
    return el;
  }

  showShakeToast(payload) {
    const el = this.ensureToast();
    const who = payload && payload.fromRole ? payload.fromRole : "Controller";
    const accepted = payload && payload.accepted ? "accepted" : "queued";
    if (payload && payload.type === "SHOOT") {
      el.textContent = `${who} shake: SHOOT (${accepted})`;
      if (payload.hitId) {
        const elHit = this.entityElements && this.entityElements.get(payload.hitId);
        if (elHit) {
          this.removeEntityImmediate(payload.hitId);
          if (this.entities && Array.isArray(this.entities.monsters)) {
            this.entities.monsters = this.entities.monsters.filter((m) => m.id !== payload.hitId);
          }
        }
      }
    } else if (payload && payload.type === "TIDE") {
      el.textContent = `${who} shake: TIDE ${payload.direction || ""} (${accepted})`;
    } else {
      el.textContent = `${who} shake`;
    }
    el.style.opacity = "1";
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.style.opacity = "0";
    }, 1100);
  }

    createEntityElement(kind) {
     if (kind === "MONSTER" && this.assets.monsterUrl) {
       const img = document.createElement("img");
       img.src = this.assets.monsterUrl;
       img.style.width = "128px";
       img.style.height = "128px";
       img.style.display = "block";
       img.style.borderRadius = "6px";
       img.style.position = "absolute";
       img.style.left = "50%";
       img.style.transform = "translateX(-50%)";
       img.style.top = "0px";
       return img;
     }
     if (kind === "OBSTACLE" && this.assets.obstacleUrl) {
       const img = document.createElement("img");
       img.src = this.assets.obstacleUrl;
       img.style.width = "128px";
       img.style.height = "128px";
       img.style.display = "block";
       img.style.borderRadius = "6px";
       img.style.position = "absolute";
       img.style.left = "50%";
       img.style.transform = "translateX(-50%)";
       img.style.top = "0px";
       return img;
     }
    const div = document.createElement("div");
    div.className = `entity ${kind === "MONSTER" ? "monster" : "obstacle"}`;
    div.style.position = "absolute";
    div.style.left = "50%";
        div.style.transform = "translateX(-50%)";
        div.style.top = "0px";
    return div;
  }

  renderEntities() {
    const visibleMonsters =
      this.role === "SHOOTER_A" || this.role === "SHOOTER_B"
        ? (this.entities.monsters || []).filter((e) => (e.forRole || "ALL") === "ALL" || e.forRole === this.role)
        : [];
    const visibleObstacles =
      this.role === "CAPTAIN" ? this.entities.obstacles || [] : [];
    const visible = [...visibleMonsters, ...visibleObstacles];
    const visibleIds = new Set(visible.map((e) => e.id));

    for (const [id, el] of this.entityElements.entries()) {
      if (!visibleIds.has(id)) {
        if (el.parentElement) el.parentElement.removeChild(el);
        this.entityElements.delete(id);
      }
    }

    for (const entity of visible) {
      const laneContainer = this.laneEntityContainers[entity.lane];
      if (!laneContainer) continue;
      const existing = this.entityElements.get(entity.id);
      if (!existing) {
        const el = this.createEntityElement(entity.type);
        laneContainer.appendChild(el);
        this.entityElements.set(entity.id, el);
      } else if (existing.parentElement !== laneContainer) {
        laneContainer.appendChild(existing);
      }
    }
  }

  startAnimationLoop() {
    const step = () => {
      this.updateEntityPositions();
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

    updateEntityPositions() {
    const now = Date.now();
    const visibleMonsters =
      this.role === "SHOOTER_A" || this.role === "SHOOTER_B"
        ? this.entities.monsters || []
        : [];
    const visibleObstacles =
      this.role === "CAPTAIN" ? this.entities.obstacles || [] : [];
    const index = new Map();
    for (const e of visibleMonsters) index.set(e.id, e);
    for (const e of visibleObstacles) index.set(e.id, e);

    for (const [id, el] of this.entityElements.entries()) {
      const data = index.get(id);
      if (!data) continue;
            const elapsed = Math.max(0, now - (data.spawnedAt || now));
            const t = Math.min(1, elapsed / this.travelMs);
            const container = el.parentElement;
            if (!container) continue;
            const ch = container.clientHeight || container.getBoundingClientRect().height;
            const eh = el.offsetHeight || 18;
            const y = t * Math.max(0, ch - eh);
            el.style.top = `${y}px`;
    }
  }
}

let tracker = null;
let game = null;

document.addEventListener("DOMContentLoaded", () => {
  tracker = new PersonTracker();
  game = new GameClient(tracker);
  window.tracker = tracker;
  window.game = game;
});
