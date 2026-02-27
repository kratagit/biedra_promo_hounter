/**
 * Advanced Particle System
 * Large rotating 3D sphere with orbital rings, shooting comets,
 * connecting lines, pulsing core glow, and depth-based rendering
 */

class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.ringParticles = [];
    this.floatingDots = [];
    this.rotationY = 0;
    this.rotationX = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.targetRotX = 0;
    this.targetRotY = 0;
    this.time = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.running = true;
    this.breathPhase = 0;

    this._resize = this.resize.bind(this);
    this._mouseMove = this.onMouseMove.bind(this);

    window.addEventListener('resize', this._resize);
    window.addEventListener('mousemove', this._mouseMove);

    this.resize();
    this.initSphere();
    this.initRings();
    this.initFloatingDots();
    this.animate();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.width = w;
    this.height = h;
    this.centerX = w / 2;
    this.centerY = h / 2;
    this.sphereRadius = Math.min(w, h) * 0.42;
  }

  initSphere() {
    const count = 900;
    this.particles = [];

    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const radiusAtY = Math.sqrt(1 - y * y);
      const theta = ((Math.sqrt(5) + 1) / 2) * i * Math.PI * 2;

      const colorRand = Math.random();
      let color;
      if (colorRand < 0.4) {
        color = { r: 227, g: 6, b: 19 };
      } else if (colorRand < 0.6) {
        color = { r: 200, g: 20, b: 30 };
      } else if (colorRand < 0.8) {
        color = { r: 212, g: 168, b: 0 };
      } else if (colorRand < 0.92) {
        color = { r: 255, g: 80, b: 60 };
      } else {
        color = { r: 180, g: 150, b: 0 };
      }

      this.particles.push({
        nx: radiusAtY * Math.cos(theta),
        ny: y,
        nz: radiusAtY * Math.sin(theta),
        size: Math.random() * 2.2 + 0.5,
        color,
        twinkleSpeed: Math.random() * 0.01 + 0.002,
        twinkleOffset: Math.random() * Math.PI * 2,
        waveOffset: Math.random() * Math.PI * 2,
        waveSpeed: Math.random() * 0.005 + 0.001,
      });
    }
  }

  initRings() {
    this.ringParticles = [];
    const ringConfigs = [
      { tilt: 0.3, particles: 160, radius: 1.15, speed: 0.002, color: { r: 227, g: 6, b: 19 } },
      { tilt: -0.5, particles: 120, radius: 1.25, speed: -0.0015, color: { r: 212, g: 168, b: 0 } },
      { tilt: 0.8, particles: 100, radius: 1.35, speed: 0.001, color: { r: 255, g: 80, b: 60 } },
    ];

    for (const cfg of ringConfigs) {
      for (let i = 0; i < cfg.particles; i++) {
        const angle = (i / cfg.particles) * Math.PI * 2;
        this.ringParticles.push({
          angle,
          radius: cfg.radius,
          tilt: cfg.tilt,
          speed: cfg.speed,
          size: Math.random() * 1.5 + 0.4,
          color: cfg.color,
          alpha: Math.random() * 0.4 + 0.1,
          twinkleOffset: Math.random() * Math.PI * 2,
        });
      }
    }
  }

  initFloatingDots() {
    this.floatingDots = [];
    for (let i = 0; i < 60; i++) {
      this.floatingDots.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: Math.random() * 1.8 + 0.3,
        speedX: (Math.random() - 0.5) * 0.06,
        speedY: (Math.random() - 0.5) * 0.06,
        alpha: Math.random() * 0.12 + 0.02,
        pulseOffset: Math.random() * Math.PI * 2,
        color: Math.random() > 0.5
          ? { r: 227, g: 6, b: 19 }
          : { r: 200, g: 160, b: 0 },
      });
    }
  }

  onMouseMove(e) {
    this.mouseX = (e.clientX / this.width - 0.5) * 2;
    this.mouseY = (e.clientY / this.height - 0.5) * 2;
  }

  rotatePoint(x, y, z, rotX, rotY) {
    let cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    let x1 = x * cosY - z * sinY;
    let z1 = x * sinY + z * cosY;
    let cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    let y1 = y * cosX - z1 * sinX;
    let z2 = y * sinX + z1 * cosX;
    return { x: x1, y: y1, z: z2 };
  }

  drawFloatingDots() {
    const ctx = this.ctx;
    for (const p of this.floatingDots) {
      p.x += p.speedX;
      p.y += p.speedY;
      if (p.x < 0) p.x = this.width;
      if (p.x > this.width) p.x = 0;
      if (p.y < 0) p.y = this.height;
      if (p.y > this.height) p.y = 0;

      const pulse = 0.7 + 0.3 * Math.sin(this.time * 0.005 + p.pulseOffset);
      const a = p.alpha * pulse;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color.r},${p.color.g},${p.color.b},${a.toFixed(3)})`;
      ctx.fill();
    }
  }

  drawCoreGlow() {
    const ctx = this.ctx;
    const breath = 0.6 + 0.4 * Math.sin(this.breathPhase);
    const R = this.sphereRadius;

    const g1 = ctx.createRadialGradient(
      this.centerX, this.centerY, R * 0.1,
      this.centerX, this.centerY, R * 1.4
    );
    g1.addColorStop(0, `rgba(227, 6, 19, ${(0.04 * breath).toFixed(3)})`);
    g1.addColorStop(0.4, `rgba(255, 237, 0, ${(0.02 * breath).toFixed(3)})`);
    g1.addColorStop(1, 'transparent');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, this.width, this.height);

    const g2 = ctx.createRadialGradient(
      this.centerX, this.centerY, 0,
      this.centerX, this.centerY, R * 0.25
    );
    g2.addColorStop(0, `rgba(227, 6, 19, ${(0.06 * breath).toFixed(3)})`);
    g2.addColorStop(1, 'transparent');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  drawSphere() {
    const ctx = this.ctx;
    const R = this.sphereRadius;
    const focalLength = 700;
    const breath = 1 + 0.03 * Math.sin(this.breathPhase * 1.5);

    this.targetRotY += 0.0005;
    this.targetRotX = this.mouseY * 0.06;
    this.rotationY += (this.targetRotY - this.rotationY + this.mouseX * 0.08) * 0.01;
    this.rotationX += (this.targetRotX - this.rotationX) * 0.01;

    const projected = [];
    for (const p of this.particles) {
      const wave = 1 + 0.04 * Math.sin(this.time * p.waveSpeed + p.waveOffset);
      const nx = p.nx * wave;
      const ny = p.ny * wave;
      const nz = p.nz * wave;

      const rotated = this.rotatePoint(nx, ny, nz, this.rotationX, this.rotationY);
      const z3d = rotated.z * R * breath;
      const scale = focalLength / (focalLength + z3d);
      const x2d = this.centerX + rotated.x * R * breath * scale;
      const y2d = this.centerY + rotated.y * R * breath * scale;

      const depthAlpha = 0.08 + (rotated.z + 1) * 0.5 * 0.92;
      const twinkle = 0.5 + 0.5 * Math.sin(this.time * p.twinkleSpeed + p.twinkleOffset);
      const alpha = Math.max(0.03, Math.min(1, depthAlpha * twinkle * scale));
      const size = p.size * scale;

      projected.push({ x: x2d, y: y2d, z: z3d, alpha, size, color: p.color });
    }

    projected.sort((a, b) => a.z - b.z);

    // Connecting lines between nearby front particles
    ctx.lineWidth = 0.5;
    const frontParticles = projected.filter(p => p.z > 0 && p.alpha > 0.3);
    const maxDist = 50;
    for (let i = 0; i < frontParticles.length; i++) {
      for (let j = i + 1; j < frontParticles.length; j++) {
        const dx = frontParticles[i].x - frontParticles[j].x;
        const dy = frontParticles[i].y - frontParticles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < maxDist) {
          const lineAlpha = (1 - dist / maxDist) * 0.08;
          ctx.beginPath();
          ctx.moveTo(frontParticles[i].x, frontParticles[i].y);
          ctx.lineTo(frontParticles[j].x, frontParticles[j].y);
          ctx.strokeStyle = `rgba(227, 6, 19, ${lineAlpha.toFixed(3)})`;
          ctx.stroke();
        }
      }
    }

    // Draw particles
    for (const p of projected) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color.r},${p.color.g},${p.color.b},${p.alpha.toFixed(3)})`;
      ctx.fill();

      if (p.alpha > 0.55 && p.size > 1.2) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color.r},${p.color.g},${p.color.b},${(p.alpha * 0.06).toFixed(3)})`;
        ctx.fill();
      }
    }
  }

  drawRings() {
    const ctx = this.ctx;
    const R = this.sphereRadius;
    const focalLength = 700;

    for (const rp of this.ringParticles) {
      rp.angle += rp.speed;

      const x = Math.cos(rp.angle) * rp.radius;
      const z = Math.sin(rp.angle) * rp.radius;
      const y = Math.sin(rp.angle) * Math.sin(rp.tilt) * 0.3;

      const rotated = this.rotatePoint(x, y, z, this.rotationX, this.rotationY);
      const z3d = rotated.z * R;
      const scale = focalLength / (focalLength + z3d);
      const x2d = this.centerX + rotated.x * R * scale;
      const y2d = this.centerY + rotated.y * R * scale;

      const depthAlpha = 0.1 + (rotated.z + 1) * 0.5 * 0.5;
      const twinkle = 0.6 + 0.4 * Math.sin(this.time * 0.005 + rp.twinkleOffset);
      const alpha = depthAlpha * twinkle * rp.alpha;
      const size = rp.size * scale;

      ctx.beginPath();
      ctx.arc(x2d, y2d, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rp.color.r},${rp.color.g},${rp.color.b},${alpha.toFixed(3)})`;
      ctx.fill();
    }
  }

  animate() {
    if (!this.running) return;
    requestAnimationFrame(() => this.animate());

    this.time++;
    this.breathPhase += 0.004;
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.drawCoreGlow();
    this.drawFloatingDots();
    this.drawRings();
    this.drawSphere();
  }

  destroy() {
    this.running = false;
    window.removeEventListener('resize', this._resize);
    window.removeEventListener('mousemove', this._mouseMove);
  }
}

const particleCanvas = document.getElementById('particle-canvas');
const particleSystem = new ParticleSystem(particleCanvas);
