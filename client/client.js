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
        this.lastMovement = 'STILL';
        
        this.movementCallbacks = {
            onMoveLeft: () => console.log('Move Left'),
            onMoveRight: () => console.log('Move Right'),
            onStill: () => console.log('Still')
        };
        
        this.init();
    }
    
    async init() {
        try {
            this.updateStatus('camera-status', 'Initializing...');
            this.updateStatus('detection-status', 'Loading model...');
            
            await this.setupCamera();
            await this.setupPoseDetection();
            await this.startCamera();
            
            this.isInitialized = true;
            this.updateStatus('camera-status', 'Active');
            this.updateStatus('detection-status', 'Ready');
            this.updateMovementStatus('READY');
            
        } catch (error) {
            this.showError(`Initialization failed: ${error.message}`);
            console.error('Initialization error:', error);
        }
    }
    
    async setupCamera() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Camera access not supported');
        }
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 }
                }
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
        this.pose = new Pose({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
            }
        });
        
        this.pose.setOptions({
            modelComplexity: 0,
            smoothLandmarks: true,
            enableSegmentation: false,
            smoothSegmentation: false,
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.5,
            upperbodyOnly: false
        });
        
        this.pose.onResults(this.onPoseResults.bind(this));
        
        this.camera = new Camera(this.video, {
            onFrame: async () => {
                if (this.isInitialized) {
                    await this.pose.send({image: this.video});
                }
            },
            width: 640,
            height: 480
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
            this.updateStatus('detection-status', 'Person detected');
        } else {
            this.updateStatus('detection-status', 'No person detected');
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
                this.updateMovementStatus('CALIBRATED');
                return;
            }
            
            this.classifyMovement();
        }
    }
    
    classifyMovement() {
        const deltaX = this.currentX - this.baselineX;
        let movement = 'STILL';
        
        // reverse to match person's perspective
        if (deltaX > this.movementThreshold) {
            movement = 'LEFT'; 
            this.stillFramesCount = 0;
        } else if (deltaX < -this.movementThreshold) {
            movement = 'RIGHT'; 
            this.stillFramesCount = 0;
        } else {
            movement = 'STILL';
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
            case 'LEFT':
                this.movementCallbacks.onMoveLeft();
                break;
            case 'RIGHT':
                this.movementCallbacks.onMoveRight();
                break;
            case 'STILL':
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
            
            this.ctx.strokeStyle = '#4ecdc4';
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.moveTo(centerX * this.canvas.width, 0);
            this.ctx.lineTo(centerX * this.canvas.width, this.canvas.height);
            this.ctx.stroke();
            
            this.ctx.fillStyle = '#ff6b6b';
            this.ctx.beginPath();
            this.ctx.arc(
                centerX * this.canvas.width,
                centerY * this.canvas.height,
                8, 0, 2 * Math.PI
            );
            this.ctx.fill();
            
            if (this.baselineX !== null) {
                this.ctx.strokeStyle = '#ffe66d';
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([5, 5]);
                this.ctx.beginPath();
                this.ctx.moveTo(this.baselineX * this.canvas.width, 0);
                this.ctx.lineTo(this.baselineX * this.canvas.width, this.canvas.height);
                this.ctx.stroke();
                this.ctx.setLineDash([]);
            }
            
            const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x) * this.canvas.width;
            const shoulderHeight = Math.abs(rightShoulder.y - leftShoulder.y) * this.canvas.height;
            const boundingBoxX = Math.min(leftShoulder.x, rightShoulder.x) * this.canvas.width - shoulderWidth * 0.5;
            const boundingBoxY = Math.min(leftShoulder.y, rightShoulder.y) * this.canvas.height - shoulderHeight * 2;
            const boundingBoxWidth = shoulderWidth * 2;
            const boundingBoxHeight = shoulderHeight * 4;
            
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(boundingBoxX, boundingBoxY, boundingBoxWidth, boundingBoxHeight);
        }
    }
    
    resetMovementTracking() {
        this.baselineX = null;
        this.currentX = null;
        this.stillFramesCount = 0;
        if (this.lastMovement !== 'STILL') {
            this.lastMovement = 'STILL';
            this.updateMovementStatus('NO PERSON');
        }
    }
    
    startFpsCounter() {
        setInterval(() => {
            const now = Date.now();
            const fps = Math.round(this.frameCount * 1000 / (now - this.lastFpsTime));
            this.updateStatus('fps', fps);
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
        const element = document.getElementById('movement-status');
        if (element) {
            element.textContent = movement;
            element.className = 'movement';
            
            switch (movement) {
                case 'LEFT':
                    element.classList.add('left');
                    break;
                case 'RIGHT':
                    element.classList.add('right');
                    break;
                case 'STILL':
                case 'CALIBRATED':
                case 'READY':
                    element.classList.add('still');
                    break;
            }
        }
    }
    
    showError(message) {
        const errorElement = document.getElementById('error-message');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }
    
    setMovementCallbacks(callbacks) {
        this.movementCallbacks = { ...this.movementCallbacks, ...callbacks };
    }
    
    setMovementThreshold(threshold) {
        this.movementThreshold = threshold;
    }
}

let tracker = null;

document.addEventListener('DOMContentLoaded', () => {
    tracker = new PersonTracker();
    
    tracker.setMovementCallbacks({
        onMoveLeft: () => {
            console.log('🡸 Person moved LEFT');
        },
        onMoveRight: () => {
            console.log('🡺 Person moved RIGHT');
        },
        onStill: () => {
            console.log('⏸ Person is STILL');
        }
    });
});

window.tracker = tracker;
