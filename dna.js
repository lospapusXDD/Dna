'use strict';

/* ═══════════════════════════════════════════════════════════════════
   DNA LAB — Real-time Double Helix Engine
   · 25 000 partículas en GPU via ShaderMaterial
   · Doble hélice real: 2 strands + rungs (escalones)
   · Ruido orgánico Simplex-like para movimiento vivo
   · Repulsión táctil / mouse en tiempo real
   · Breathing animation, rotation, depth-based alpha
═══════════════════════════════════════════════════════════════════ */

class DNAEngine {

  constructor() {
    this.N          = 25000;
    this.TURNS      = 8;
    this.HEIGHT     = 24;
    this.RADIUS     = 2.4;
    this.RUNG_COUNT = 80;    // horizontal rungs between strands
    this.NOISE      = 0.18;
    this.REPEL_R    = 2.8;
    this.REPEL_F    = 6.0;
    this.SPRING     = 0.055;
    this.DAMP       = 0.82;

    this._initRenderer();
    this._initScene();
    this._buildDNA();
    this._buildRungs();
    this._initInteraction();
    this._loop();
  }

  /* ── Renderer ─────────────────────────────────── */
  _initRenderer() {
    this.canvas   = document.getElementById('dna-canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x030508, 1);
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  /* ── Scene ────────────────────────────────────── */
  _initScene() {
    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 0, 20);
    this.clock  = new THREE.Clock();
    this._resize();
  }

  /* ════════════════════════════════════════════════
     VERTEX SHADER
     Inputs:
       position  — current CPU-updated particle pos
       aHome     — home position on helix
       aStrand   — 0=strand A, 1=strand B, 2=rung
       aPhase    — random phase for shimmer

     Calculates:
       gl_PointSize — perspective + breathing scale
       vAlpha       — depth fog + strand color blend
       vColor       — green/cyan gradient by strand
  ════════════════════════════════════════════════ */
  get _vertexShader() { return /* glsl */`
    attribute float aStrand;
    attribute float aPhase;
    attribute float aBaseSize;

    varying float vAlpha;
    varying vec3  vColor;

    uniform float uTime;
    uniform float uBreath;

    void main() {
      // ── Color by strand type ──────────────────
      // Strand 0: bright neon green
      // Strand 1: cyan-blue
      // Rung    : dim teal connecting color
      vec3 colA    = vec3(0.0,  1.0,  0.45);   // #00FF72
      vec3 colB    = vec3(0.0,  0.82, 1.0);    // #00D1FF
      vec3 colRung = vec3(0.0,  0.55, 0.45);   // dim teal

      if      (aStrand < 0.5) vColor = colA;
      else if (aStrand < 1.5) vColor = colB;
      else                    vColor = colRung;

      // ── Shimmer: brightness flicker per particle ──
      float shimmer = 0.75 + 0.25 * sin(uTime * 2.5 + aPhase * 6.28);
      vColor *= shimmer;

      // ── MVP transform ─────────────────────────
      vec4 mv = modelViewMatrix * vec4(position * uBreath, 1.0);

      // ── Point size: perspective + depth ───────
      float perspective_size = aBaseSize * (300.0 / -mv.z);
      gl_PointSize = clamp(perspective_size, 0.8, 10.0);

      // ── Alpha: depth fog ──────────────────────
      float depthT = (position.y + 12.0) / 24.0;  // 0=bottom 1=top
      vAlpha = mix(0.2, 1.0, depthT);

      gl_Position = projectionMatrix * mv;
    }
  `; }

  /* ════════════════════════════════════════════════
     FRAGMENT SHADER
     Draws a soft glowing disc per particle.
     Additive blending creates accumulative glow.
  ════════════════════════════════════════════════ */
  get _fragmentShader() { return /* glsl */`
    varying float vAlpha;
    varying vec3  vColor;

    void main() {
      // Distance from center of point quad
      vec2 uv = gl_PointCoord - 0.5;
      float d = length(uv);

      // Anti-aliased disc
      float disc = 1.0 - smoothstep(0.28, 0.5, d);

      // Bright gaussian core glow
      float glow = exp(-d * d * 14.0) * 0.9;

      // Inner hot white core (very small radius)
      float core = exp(-d * d * 60.0) * 0.6;

      float alpha = (disc + glow) * vAlpha;
      if (alpha < 0.008) discard;

      // Color: vColor at edges, white-hot at core
      vec3 finalColor = vColor + vec3(core);

      gl_FragColor = vec4(finalColor, alpha);
    }
  `; }

  /* ── PSEUDO-RANDOM (deterministic hash) ─────── */
  _hash(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  /* ── ORGANIC NOISE ───────────────────────────── */
  _noise(x, y, z) {
    // Simple smooth noise approximation
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    // Smoothstep
    const ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy);

    const r = (a,b,c) => this._hash(a + b*57 + c*113) * 2 - 1;

    return (
      r(ix,iy,iz)*(1-ux)*(1-uy) +
      r(ix+1,iy,iz)*ux*(1-uy) +
      r(ix,iy+1,iz)*(1-ux)*uy +
      r(ix+1,iy+1,iz)*ux*uy
    ) * 0.5 + (
      r(ix,iy,iz+1)*(1-ux)*(1-uy) +
      r(ix+1,iy,iz+1)*ux*(1-uy) +
      r(ix,iy+1,iz+1)*(1-ux)*uy +
      r(ix+1,iy+1,iz+1)*ux*uy
    ) * 0.5;
  }

  /* ── HELIX POSITION ─────────────────────────────
     t     : [0,1] parameter along helix length
     strand: 0 or 1 (offset by π)
     Returns exact position on the DNA backbone.
  ─────────────────────────────────────────────── */
  _helixPos(t, strand) {
    const angle  = t * Math.PI * 2 * this.TURNS + strand * Math.PI;
    const y      = t * this.HEIGHT - this.HEIGHT / 2;
    const nx     = this._noise(t * 3.1, strand * 2.7, 0.5) * this.NOISE;
    const nz     = this._noise(t * 2.8, strand * 1.9, 1.2) * this.NOISE;
    return {
      x: this.RADIUS * Math.cos(angle) + nx,
      y: y,
      z: this.RADIUS * Math.sin(angle) + nz
    };
  }

  /* ── BUILD DNA PARTICLE CLOUD ─────────────────── */
  _buildDNA() {
    const N  = this.N;
    const home    = new Float32Array(N * 3);
    const pos     = new Float32Array(N * 3);
    const vel     = new Float32Array(N * 3);
    const strand  = new Float32Array(N);
    const phase   = new Float32Array(N);
    const baseSize= new Float32Array(N);

    // Distribute particles: 48% strand A, 48% strand B, 4% scattered halo
    const nStrandA = Math.floor(N * 0.48);
    const nStrandB = Math.floor(N * 0.48);
    const nHalo    = N - nStrandA - nStrandB;

    let idx = 0;

    // ── Strand A ──
    for (let i = 0; i < nStrandA; i++, idx++) {
      const t = i / nStrandA;
      const h = this._helixPos(t, 0);
      // Scatter around backbone — denser near spine
      const scatter = Math.pow(Math.random(), 1.8) * 0.35;
      const ang = Math.random() * Math.PI * 2;
      const b = idx * 3;
      home[b]   = h.x + Math.cos(ang) * scatter;
      home[b+1] = h.y + (Math.random()-0.5) * 0.12;
      home[b+2] = h.z + Math.sin(ang) * scatter;
      pos[b]=home[b]; pos[b+1]=home[b+1]; pos[b+2]=home[b+2];
      strand[idx] = 0;
      phase[idx]  = this._hash(idx);
      baseSize[idx] = 1.0 + Math.random() * 0.8;
    }

    // ── Strand B ──
    for (let i = 0; i < nStrandB; i++, idx++) {
      const t = i / nStrandB;
      const h = this._helixPos(t, 1);
      const scatter = Math.pow(Math.random(), 1.8) * 0.35;
      const ang = Math.random() * Math.PI * 2;
      const b = idx * 3;
      home[b]   = h.x + Math.cos(ang) * scatter;
      home[b+1] = h.y + (Math.random()-0.5) * 0.12;
      home[b+2] = h.z + Math.sin(ang) * scatter;
      pos[b]=home[b]; pos[b+1]=home[b+1]; pos[b+2]=home[b+2];
      strand[idx] = 1;
      phase[idx]  = this._hash(idx + 99999);
      baseSize[idx] = 1.0 + Math.random() * 0.8;
    }

    // ── Halo scatter ──
    for (let i = 0; i < nHalo; i++, idx++) {
      const t = Math.random();
      const s = Math.random() < 0.5 ? 0 : 1;
      const h = this._helixPos(t, s);
      const scatter = 0.35 + Math.random() * 0.6;
      const ang = Math.random() * Math.PI * 2;
      const b = idx * 3;
      home[b]   = h.x + Math.cos(ang) * scatter;
      home[b+1] = h.y + (Math.random()-0.5) * 0.4;
      home[b+2] = h.z + Math.sin(ang) * scatter;
      pos[b]=home[b]; pos[b+1]=home[b+1]; pos[b+2]=home[b+2];
      strand[idx] = s;
      phase[idx]  = this._hash(idx + 55555);
      baseSize[idx] = 0.5 + Math.random() * 0.5;
    }

    // Store for physics
    this.home = home;
    this.pos  = pos;
    this.vel  = vel;

    // Geometry
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aStrand',   new THREE.BufferAttribute(strand, 1));
    this.geo.setAttribute('aPhase',    new THREE.BufferAttribute(phase, 1));
    this.geo.setAttribute('aBaseSize', new THREE.BufferAttribute(baseSize, 1));

    this.uniforms = {
      uTime:   { value: 0 },
      uBreath: { value: 1 }
    };

    const mat = new THREE.ShaderMaterial({
      uniforms:         this.uniforms,
      vertexShader:     this._vertexShader,
      fragmentShader:   this._fragmentShader,
      transparent:      true,
      depthWrite:       false,
      blending:         THREE.AdditiveBlending
    });

    this.dnaPoints = new THREE.Points(this.geo, mat);
    this.scene.add(this.dnaPoints);

    // Background star dust
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(800 * 3);
    for (let i = 0; i < 800; i++) {
      starPos[i*3]   = (Math.random()-0.5) * 60;
      starPos[i*3+1] = (Math.random()-0.5) * 40;
      starPos[i*3+2] = (Math.random()-0.5) * 20 - 10;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
      size: 0.04, color: 0xffffff, transparent: true, opacity: 0.22
    })));
  }

  /* ── BUILD RUNGS (base pairs) ─────────────────── */
  _buildRungs() {
    // Each rung: thin line connecting strand A to strand B at same t
    const rungPositions = [];
    for (let i = 0; i < this.RUNG_COUNT; i++) {
      const t  = i / this.RUNG_COUNT;
      const hA = this._helixPos(t, 0);
      const hB = this._helixPos(t, 1);
      rungPositions.push(
        new THREE.Vector3(hA.x, hA.y, hA.z),
        new THREE.Vector3(hB.x, hB.y, hB.z)
      );
    }

    const rungGeo = new THREE.BufferGeometry().setFromPoints(rungPositions);
    // Use LineSegments (every 2 pts = one segment)
    const rungMat = new THREE.LineBasicMaterial({
      color: 0x00aa66,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.rungs = new THREE.LineSegments(rungGeo, rungMat);
    this.scene.add(this.rungs);

    // Also add glowing rung midpoint dots (nucleobases)
    const midGeo  = new THREE.BufferGeometry();
    const midPos  = new Float32Array(this.RUNG_COUNT * 3);
    for (let i = 0; i < this.RUNG_COUNT; i++) {
      const t  = i / this.RUNG_COUNT;
      const hA = this._helixPos(t, 0);
      const hB = this._helixPos(t, 1);
      midPos[i*3]   = (hA.x + hB.x) / 2;
      midPos[i*3+1] = (hA.y + hB.y) / 2;
      midPos[i*3+2] = (hA.z + hB.z) / 2;
    }
    midGeo.setAttribute('position', new THREE.BufferAttribute(midPos, 3));
    this.scene.add(new THREE.Points(midGeo, new THREE.PointsMaterial({
      size: 0.12, color: 0x00ffcc,
      transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    })));
  }

  /* ── INTERACTION ─────────────────────────────── */
  _initInteraction() {
    this.pointer    = new THREE.Vector2(9999, 9999);
    this.pointerW   = new THREE.Vector3(9999, 0, 0);
    this.raycaster  = new THREE.Raycaster();
    this._plane     = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    const onMove = (x, y) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x =  ((x - rect.left) / rect.width)  * 2 - 1;
      this.pointer.y = -((y - rect.top)  / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      this.raycaster.ray.intersectPlane(this._plane, this.pointerW);
    };

    window.addEventListener('mousemove', e => {
      // Also update custom cursor
      document.getElementById('cursor').style.left = e.clientX + 'px';
      document.getElementById('cursor').style.left = e.clientX + 'px';
      document.getElementById('cursor').style.top  = e.clientY + 'px';
      onMove(e.clientX, e.clientY);
    });
    window.addEventListener('touchmove', e => {
      e.preventDefault();
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    window.addEventListener('touchend', () => {
      this.pointerW.set(9999, 0, 0);
    });
  }

  /* ── MAIN LOOP ─────────────────────────────────
     Physics pipeline each frame:
     1. Spring force toward home position
     2. Radial repulsion from pointer in local space
     3. Damping
     4. Integration
     5. Upload to GPU via needsUpdate
  ─────────────────────────────────────────────── */
  _loop() {
    requestAnimationFrame(() => this._loop());

    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t  = this.clock.getElapsedTime();

    // Update shader uniforms
    this.uniforms.uTime.value   = t;
    this.uniforms.uBreath.value = 1.0 + Math.sin(t * 0.5) * 0.015;

    // Slow auto-rotation of entire helix
    this.dnaPoints.rotation.y = t * 0.18;
    this.rungs.rotation.y     = t * 0.18;

    // Gentle camera bob
    this.camera.position.y = Math.sin(t * 0.22) * 0.4;

    // ── Physics in local (pre-rotation) space ──
    const pw = this.pointerW;
    const sinY = Math.sin(-this.dnaPoints.rotation.y);
    const cosY = Math.cos(-this.dnaPoints.rotation.y);

    for (let i = 0; i < this.N; i++) {
      const b = i * 3;

      let px = this.pos[b], py = this.pos[b+1], pz = this.pos[b+2];
      let vx = this.vel[b], vy = this.vel[b+1], vz = this.vel[b+2];

      // Spring toward home
      const hx = this.home[b], hy = this.home[b+1], hz = this.home[b+2];
      vx += (hx - px) * this.SPRING;
      vy += (hy - py) * this.SPRING;
      vz += (hz - pz) * this.SPRING;

      // Repulsion — rotate pointer to local space
      const lwx =  pw.x * cosY + pw.z * sinY;
      const lwz = -pw.x * sinY + pw.z * cosY;
      const lwy =  pw.y;

      const rx = px - lwx, ry = py - lwy, rz = pz - lwz;
      const dist2 = rx*rx + ry*ry + rz*rz;

      if (dist2 < this.REPEL_R * this.REPEL_R && dist2 > 0.0001) {
        const dist    = Math.sqrt(dist2);
        const falloff = 1.0 - dist / this.REPEL_R;
        const force   = (this.REPEL_F * falloff) / dist;
        vx += rx * force * dt;
        vy += ry * force * dt;
        vz += rz * force * dt;
      }

      // Damping + integrate
      vx *= this.DAMP; vy *= this.DAMP; vz *= this.DAMP;
      px += vx; py += vy; pz += vz;

      this.pos[b]=px; this.pos[b+1]=py; this.pos[b+2]=pz;
      this.vel[b]=vx; this.vel[b+1]=vy; this.vel[b+2]=vz;
    }

    this.posAttr.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}

/* ── CURSOR RING LAG ─────────────────────────── */
(function cursorRing() {
  const ring = document.getElementById('cursor-ring');
  let rx = 0, ry = 0, tx = 0, ty = 0;
  document.addEventListener('mousemove', e => { tx = e.clientX; ty = e.clientY; });
  (function loop() {
    requestAnimationFrame(loop);
    rx += (tx - rx) * 0.1;
    ry += (ty - ry) * 0.1;
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';
  })();
})();

/* ── LIVE DATA HUD ───────────────────────────── */
(function liveData() {
  const vals = {
    'data-gc': () => (Math.random() * 5 + 42).toFixed(1) + '%',
    'data-at': () => (Math.random() * 5 + 55).toFixed(1) + '%',
    'data-bp': () => (3200000000 + Math.floor(Math.random()*1000000)).toLocaleString(),
    'data-seq': () => Math.floor(Math.random()*9999).toString().padStart(4,'0'),
  };
  setInterval(() => {
    Object.entries(vals).forEach(([id, fn]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = fn();
    });
  }, 1200);
})();

/* ── BOOT ─────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => new DNAEngine());
