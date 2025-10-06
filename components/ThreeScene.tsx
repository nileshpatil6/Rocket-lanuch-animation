import React, { useRef, useEffect } from 'react';
import type { MissionData, CameraAngle } from '../App';

// Fix: Provide a minimal namespace declaration for THREE
declare namespace THREE {
  type Mesh = any;
  type Group = any;
}

// Make TypeScript aware of the global THREE object from the CDN script
declare const THREE: any;

interface ThreeSceneProps {
  setLoading: (loading: boolean) => void;
  onSceneUpdate: (percent: number, data: MissionData) => void;
  cameraAngle: CameraAngle;
}

// --- PARTICLE SHADERS ---
const exhaustVertexShader = `
  attribute float a_size;
  attribute vec3 a_color;
  attribute float a_alpha;
  varying vec3 v_color;
  varying float v_alpha;
  void main() {
    v_color = a_color;
    v_alpha = a_alpha;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_PointSize = a_size * ( 300.0 / -mvPosition.z );
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const exhaustFragmentShader = `
  uniform sampler2D u_texture;
  varying vec3 v_color;
  varying float v_alpha;
  void main() {
    vec4 texColor = texture2D( u_texture, gl_PointCoord );
    if (texColor.a < 0.1) discard;
    gl_FragColor = vec4( v_color, texColor.a * v_alpha );
  }
`;

// Helper to generate a procedural roughness map
const generateRoughnessMap = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.fillStyle = 'rgb(150, 150, 150)';
    context.fillRect(0, 0, width, height);

    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const randomFactor = (Math.random() - 0.5) * 80;
        const value = 150 + randomFactor;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
    }
    context.putImageData(imageData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
};

// Helper for procedural solar panel texture
const generateSolarPanelTexture = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.fillStyle = '#050525';
    context.fillRect(0, 0, width, height);
    
    context.strokeStyle = '#4455bb';
    context.lineWidth = Math.max(1, width / 64);

    const stepX = width / 8;
    for (let i = 1; i < 8; i++) {
        context.beginPath();
        context.moveTo(i * stepX, 0);
        context.lineTo(i * stepX, height);
        context.stroke();
    }

    const stepY = height / 4;
    for (let i = 1; i < 4; i++) {
        context.beginPath();
        context.moveTo(0, i * stepY);
        context.lineTo(width, i * stepY);
        context.stroke();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
};

// Creates a soft, round texture for particles
const createParticleTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
};

// Procedural rocket metal texture suite: diffuse(albedo), roughness, normal approximation
const generateRocketMetalTextures = (w: number, h: number) => {
    const albedoCanvas = document.createElement('canvas'); albedoCanvas.width = w; albedoCanvas.height = h;
    const roughCanvas = document.createElement('canvas'); roughCanvas.width = w; roughCanvas.height = h;
    const normalCanvas = document.createElement('canvas'); normalCanvas.width = w; normalCanvas.height = h;
    const aCtx = albedoCanvas.getContext('2d'); const rCtx = roughCanvas.getContext('2d'); const nCtx = normalCanvas.getContext('2d');
    if (!aCtx || !rCtx || !nCtx) return null;

    // Base brushed gradient (lighter metallic silver with subtle tint)
    const grad = aCtx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#c5d0dc');
    grad.addColorStop(0.5, '#a8b5c5');
    grad.addColorStop(1, '#b5c0d0');
    aCtx.fillStyle = grad; aCtx.fillRect(0,0,w,h);

    // Brushed streaks (vertical)
    for (let i=0;i<w;i++) {
        if (Math.random() < 0.25) {
            const light = (Math.random()*40)-20;
            aCtx.fillStyle = `rgba(${180+light},${190+light},${205+light},0.3)`;
            const stripeW = 1 + Math.random()*2;
            aCtx.fillRect(i,0,stripeW,h);
        }
    }

    // Horizontal panel seams every ~15% height with subtle darker line + tiny rivets
    const panelGap = Math.floor(h * 0.15);
    aCtx.strokeStyle = 'rgba(70,80,90,0.4)';
    aCtx.lineWidth = 2;
    for (let y = panelGap; y < h; y += panelGap) {
        aCtx.beginPath(); aCtx.moveTo(0,y); aCtx.lineTo(w,y); aCtx.stroke();
        // Rivets along seam
        for (let x=10; x<w; x+= Math.floor(w/18)) {
            aCtx.fillStyle = 'rgba(255,255,255,0.25)';
            aCtx.beginPath(); aCtx.arc(x,y,2,0,Math.PI*2); aCtx.fill();
            aCtx.fillStyle = 'rgba(0,0,0,0.35)';
            aCtx.beginPath(); aCtx.arc(x+0.5,y+0.5,1,0,Math.PI*2); aCtx.fill();
        }
    }

    // Heat tint (bottom 15%) subtle blueish / straw transition
    const heatGrad = aCtx.createLinearGradient(0, h*0.85, 0, h);
    heatGrad.addColorStop(0, 'rgba(255,255,255,0)');
    heatGrad.addColorStop(0.4, 'rgba(170,190,255,0.15)');
    heatGrad.addColorStop(1, 'rgba(210,170,90,0.25)');
    aCtx.fillStyle = heatGrad; aCtx.fillRect(0,h*0.75,w,h*0.25);

    // Roughness map: brighter=rougher. Start uniform mid, then add vertical noise + panels slightly different
    rCtx.fillStyle = 'rgb(140,140,140)'; rCtx.fillRect(0,0,w,h);
    const rImg = rCtx.getImageData(0,0,w,h); const rd = rImg.data;
    for (let y=0;y<h;y++) {
        for (let x=0;x<w;x++) {
            const i = (y*w + x)*4; const v = 140 + (Math.sin(x*0.15)+Math.random()*0.6-0.3)*18;
            rd[i]=rd[i+1]=rd[i+2]=v;
        }
    }
    // Panel seams slightly rougher
    for (let y = panelGap; y < h; y += panelGap) {
        for (let x=0;x<w;x++) { const i=(y*w + x)*4; rd[i]=rd[i+1]=rd[i+2]=180; }
    }
    rCtx.putImageData(rImg,0,0);

    // Normal approximation: encode vertical brushed perturbation into normal X component
    nCtx.fillStyle = 'rgb(128,128,255)'; nCtx.fillRect(0,0,w,h); // flat normal
    const nImg = nCtx.getImageData(0,0,w,h); const nd = nImg.data;
    for (let x=0;x<w;x++) {
        const offset = Math.sin(x*0.25)*8 + (Math.random()*4-2);
        for (let y=0;y<h;y++) {
            const i=(y*w + x)*4; // perturb x channel
            const nx = 128 + offset;
            nd[i] = Math.min(255, Math.max(0,nx));
            // Keep y (green) near 128, blue 255
        }
    }
    nCtx.putImageData(nImg,0,0);

    const albedoTex = new THREE.CanvasTexture(albedoCanvas); albedoTex.wrapS = albedoTex.wrapT = THREE.RepeatWrapping; albedoTex.anisotropy = 4; albedoTex.needsUpdate = true;
    const roughTex = new THREE.CanvasTexture(roughCanvas); roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping; roughTex.needsUpdate = true;
    const normalTex = new THREE.CanvasTexture(normalCanvas); normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping; normalTex.needsUpdate = true;
    return { map: albedoTex, roughnessMap: roughTex, normalMap: normalTex };
};

// Color-tinted metal variants
const tintMetalTexture = (baseTex: any, tint: {r:number,g:number,b:number,a:number}) => {
    if (!baseTex || !baseTex.image) return baseTex;
    const canvas = document.createElement('canvas');
    const w = baseTex.image.width, h = baseTex.image.height;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return baseTex;
    ctx.drawImage(baseTex.image, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(${tint.r},${tint.g},${tint.b},${tint.a})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    const tinted = new THREE.CanvasTexture(canvas);
    tinted.wrapS = tinted.wrapT = THREE.RepeatWrapping;
    tinted.anisotropy = baseTex.anisotropy;
    return tinted;
};

const ThreeScene: React.FC<ThreeSceneProps> = ({ setLoading, onSceneUpdate, cameraAngle }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const cameraAngleRef = useRef(cameraAngle);
  const onSceneUpdateRef = useRef(onSceneUpdate);

  useEffect(() => { cameraAngleRef.current = cameraAngle; }, [cameraAngle]);
  useEffect(() => { onSceneUpdateRef.current = onSceneUpdate; }, [onSceneUpdate]);

  useEffect(() => {
    if (!mountRef.current) return;
    
    let isMounted = true;
    let animationFrameId: number;
    const mountNode = mountRef.current;
    const clock = new THREE.Clock();

    const lerp = (start: number, end: number, alpha: number) => start * (1 - alpha) + end * alpha;
    const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const easeInOutQuint = (t: number) => t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

    const loadingManager = new THREE.LoadingManager(() => {
        setLoading(false);
        if (isMounted) {
            animationFrameId = requestAnimationFrame(animate);
        }
    });
    const textureLoader = new THREE.TextureLoader(loadingManager);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x87CEEB, 100, 800);
        const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 3000);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // Physically based lighting + tone mapping for brighter metals
        if ('physicallyCorrectLights' in renderer) renderer.physicallyCorrectLights = true;
        if ('toneMapping' in renderer && THREE.ACESFilmicToneMapping) {
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.2; // Reduced for more natural Earth appearance
        }
        // sRGB output (fallback for older three versions)
        if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
            renderer.outputColorSpace = THREE.SRGBColorSpace;
        } else if ('gammaOutput' in renderer) {
            renderer.gammaOutput = true; renderer.gammaFactor = 2.2;
        }
    mountNode.appendChild(renderer.domElement);

        // --- IMPROVED LIGHTING RIG ---
        // Goal: brighter readable rocket with metallic sheen and subtle rim separation.
        const hemisphereLight = new THREE.HemisphereLight(0xbfd5ff, 0x101520, 1.2); // reduced for darker Earth
        scene.add(hemisphereLight);

        // Key ("sun") directional
        const keyLight = new THREE.DirectionalLight(0xffe2c4, 4.5);
        keyLight.position.set(-60, 80, 45);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(2048, 2048);
        keyLight.shadow.camera.near = 1;
        keyLight.shadow.camera.far = 600;
        scene.add(keyLight);

        // Fill light (cool) to lift dark side
        const fillLight = new THREE.DirectionalLight(0x6fa3ff, 2.5);
        fillLight.position.set(70, 35, -40);
        scene.add(fillLight);

        // Rim/back light for edge highlight
        const rimLight = new THREE.DirectionalLight(0xffffff, 2.5);
        rimLight.position.set(30, 25, 120);
        scene.add(rimLight);

        // Gentle ambient to avoid crushed blacks
        const ambient = new THREE.AmbientLight(0x182030, 0.4);
        scene.add(ambient);

        // Procedural gradient environment for reflection highlights
        const createEnvironmentMap = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 512; canvas.height = 256;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            const g = ctx.createLinearGradient(0, 0, 0, 256);
            g.addColorStop(0, '#5d6d80');
            g.addColorStop(0.55, '#1a2430');
            g.addColorStop(1, '#05070b');
            ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace ? THREE.SRGBColorSpace : tex.colorSpace; // Align with renderer
            const pmrem = new THREE.PMREMGenerator(renderer);
            const envRT = pmrem.fromEquirectangular(tex);
            tex.dispose(); pmrem.dispose();
            return envRT.texture;
        };
        const envMap = createEnvironmentMap();
        if (envMap) { scene.environment = envMap; }
        // Tuning tips:
        // - Overall scene brightness: increase renderer.toneMappingExposure (current 1.55)
        // - Stronger reflections: raise envMapIntensity on materials (darkMetal / whitePaint)
        // - Softer contrast: bump ambient light intensity or hemisphereLight intensity
        // - More dramatic edges: increase rimLight intensity or move its position further behind Z+


    const starVertices = [];
    for (let i = 0; i < 10000; i++) { starVertices.push((Math.random() - 0.5) * 3000, (Math.random() - 0.5) * 3000, (Math.random() - 0.5) * 3000); }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9 }));
    scene.add(stars);

    // --- GROUND LAUNCH ENVIRONMENT ---
    const groundGroup = new THREE.Group();
    
    // Ground terrain with smoother rolling hills using layered noise
    const terrainGeometry = new THREE.PlaneGeometry(2000, 2000, 200, 200);
    const groundPositions = terrainGeometry.attributes.position.array as Float32Array;
    for (let i = 0; i < groundPositions.length; i += 3) {
      const x = groundPositions[i];
      const z = groundPositions[i + 1];
      const dist = Math.sqrt(x * x + z * z);
      // Layered smooth waves for natural rolling hills
      const height = 
        Math.sin(x * 0.008) * 4 + 
        Math.cos(z * 0.008) * 4 + 
        Math.sin(x * 0.02) * 1.5 + 
        Math.cos(z * 0.02) * 1.5 +
        Math.sin(dist * 0.005) * 2;
      groundPositions[i + 2] = height;
    }
    terrainGeometry.computeVertexNormals();
    const terrainMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x3a6b1f,
      roughness: 0.95,
      metalness: 0.0
    });
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.y = -2;
    terrain.receiveShadow = true;
    groundGroup.add(terrain);
    
    // Launch pad with detailed structure
    const launchPadBase = new THREE.Mesh(
      new THREE.CylinderGeometry(25, 28, 2, 32),
      new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7, metalness: 0.3 })
    );
    launchPadBase.position.y = -2;
    launchPadBase.castShadow = true;
    launchPadBase.receiveShadow = true;
    groundGroup.add(launchPadBase);
    
    const launchPadTop = new THREE.Mesh(
      new THREE.CylinderGeometry(18, 20, 1.5, 32),
      new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.6, metalness: 0.4 })
    );
    launchPadTop.position.y = -0.25;
    launchPadTop.castShadow = true;
    launchPadTop.receiveShadow = true;
    groundGroup.add(launchPadTop);
    
    // Support pillars
    for (let i = 0; i < 4; i++) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 1.5, 15, 8),
        new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6, metalness: 0.5 })
      );
      const angle = (i / 4) * Math.PI * 2;
      pillar.position.x = Math.cos(angle) * 22;
      pillar.position.z = Math.sin(angle) * 22;
      pillar.position.y = -9;
      pillar.castShadow = true;
      groundGroup.add(pillar);
    }
    
    // Trees scattered naturally with varied species and clustering
    const treeCount = 50;
    for (let i = 0; i < treeCount; i++) {
      const treeType = Math.random();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 1.0, treeType > 0.5 ? 12 : 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x4a3820, roughness: 0.95 })
      );
      
      // Different foliage shapes
      const foliage = new THREE.Group();
      if (treeType > 0.7) {
        // Cone shaped (pine-like)
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(3.5, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0x2d5016, roughness: 0.85 })
        );
        cone.position.y = 8;
        foliage.add(cone);
      } else {
        // Layered spheres (oak-like)
        for (let j = 0; j < 3; j++) {
          const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(3 - j * 0.5, 8, 8),
            new THREE.MeshStandardMaterial({ color: 0x2d5016, roughness: 0.85 })
          );
          sphere.position.y = 6 + j * 2;
          sphere.scale.set(1, 1.2, 1);
          foliage.add(sphere);
        }
      }
      
      const tree = new THREE.Group();
      tree.add(trunk);
      tree.add(foliage);
      
      // Natural clustering with some randomness
      const cluster = Math.floor(i / 8);
      const clusterAngle = (cluster / 6) * Math.PI * 2;
      const clusterRadius = 180 + Math.random() * 350;
      const spread = 50;
      
      tree.position.x = Math.cos(clusterAngle) * clusterRadius + (Math.random() - 0.5) * spread;
      tree.position.z = Math.sin(clusterAngle) * clusterRadius + (Math.random() - 0.5) * spread;
      tree.position.y = -2;
      tree.scale.setScalar(0.7 + Math.random() * 0.8);
      tree.rotation.y = Math.random() * Math.PI * 2;
      tree.castShadow = true;
      tree.receiveShadow = true;
      
      groundGroup.add(tree);
    }
    
    // Mountains in distance with snow caps
    const mountainCount = 12;
    for (let i = 0; i < mountainCount; i++) {
      const mountainBase = new THREE.Mesh(
        new THREE.ConeGeometry(60 + Math.random() * 40, 120 + Math.random() * 80, 6),
        new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.95 })
      );
      const snowCap = new THREE.Mesh(
        new THREE.ConeGeometry(40 + Math.random() * 20, 50 + Math.random() * 30, 6),
        new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.7 })
      );
      snowCap.position.y = 70 + Math.random() * 20;
      
      const mountain = new THREE.Group();
      mountain.add(mountainBase);
      mountain.add(snowCap);
      
      const angle = (i / mountainCount) * Math.PI * 2;
      const radius = 650 + Math.random() * 150;
      mountain.position.x = Math.cos(angle) * radius;
      mountain.position.z = Math.sin(angle) * radius;
      mountain.position.y = 20 + Math.random() * 30;
      mountain.scale.y = 0.9 + Math.random() * 0.4;
      mountain.rotation.y = Math.random() * Math.PI * 2;
      mountain.receiveShadow = true;
      groundGroup.add(mountain);
    }
    
    // Sky dome with gradient
    const skyGeometry = new THREE.SphereGeometry(2500, 32, 32);
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      fog: false,
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          vec3 skyColor = mix(vec3(0.53, 0.81, 0.92), vec3(0.1, 0.4, 0.8), h);
          gl_FragColor = vec4(skyColor, 1.0);
        }
      `
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    groundGroup.add(sky);
    
    // Clouds with multiple puffs for realistic shapes
    const cloudCount = 25;
    const cloudGroups: THREE.Group[] = [];
    for (let i = 0; i < cloudCount; i++) {
      const cloudGroup = new THREE.Group();
      const puffCount = 3 + Math.floor(Math.random() * 3);
      
      for (let j = 0; j < puffCount; j++) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(15 + Math.random() * 15, 8, 8),
          new THREE.MeshStandardMaterial({ 
            color: 0xffffff, 
            roughness: 1.0, 
            transparent: true, 
            opacity: 0.8,
            fog: true
          })
        );
        puff.position.x = (Math.random() - 0.5) * 50;
        puff.position.y = (Math.random() - 0.5) * 10;
        puff.position.z = (Math.random() - 0.5) * 20;
        cloudGroup.add(puff);
      }
      
      cloudGroup.position.x = (Math.random() - 0.5) * 1200;
      cloudGroup.position.y = 80 + Math.random() * 120;
      cloudGroup.position.z = (Math.random() - 0.5) * 1200;
      cloudGroups.push(cloudGroup);
      groundGroup.add(cloudGroup);
    }
    
    // Sun light for ground scene with warmer tone
    const sunLight = new THREE.DirectionalLight(0xfff4e6, 3.0);
    sunLight.position.set(500, 800, 300);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.left = -500;
    sunLight.shadow.camera.right = 500;
    sunLight.shadow.camera.top = 500;
    sunLight.shadow.camera.bottom = -500;
    sunLight.shadow.bias = -0.0001;
    groundGroup.add(sunLight);
    
    // Ambient ground light for softer shadows
    const groundAmbient = new THREE.AmbientLight(0x87CEEB, 0.6);
    groundGroup.add(groundAmbient);
    
    // Ground hemisphere light for natural outdoor lighting
    const groundHemi = new THREE.HemisphereLight(0x87CEEB, 0x3a6b1f, 0.8);
    groundGroup.add(groundHemi);
    
    scene.add(groundGroup);
    groundGroup.visible = true; // Start with ground visible

    const earthGroup = new THREE.Group();
    const earthRadius = 50;
    const earthMaterial = new THREE.MeshStandardMaterial({
        map: textureLoader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'),
        bumpMap: textureLoader.load('https://unpkg.com/three-globe/example/img/earth-topology.png'),
        bumpScale: 0.1,
        roughness: 0.85
    });
    const earth = new THREE.Mesh(new THREE.SphereBufferGeometry(earthRadius, 64, 64), earthMaterial);
    earth.receiveShadow = true;
    earthGroup.add(earth);

    const cloudMaterial = new THREE.MeshStandardMaterial({
        map: textureLoader.load('https://solarsystem.nasa.gov/assets/ve-clouds-8k.png'),
        transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending
    });
    const clouds = new THREE.Mesh(new THREE.SphereBufferGeometry(earthRadius + 0.5, 64, 64), cloudMaterial);
    earthGroup.add(clouds);
    scene.add(earthGroup);
    
    // --- ROCKET MODEL ---
    // Procedural realistic metal textures with color variants
    const rocketTex = generateRocketMetalTextures(1024, 2048);
    
    // Blue-gray titanium for main stage
    const blueTitaniumMap = tintMetalTexture(rocketTex?.map, {r:180,g:190,b:210,a:1.0});
    const stage1Metal = new THREE.MeshStandardMaterial({
        color: 0xd0dae5,
        metalness: 1.0,
        roughness: 0.48,
        map: blueTitaniumMap,
        roughnessMap: rocketTex?.roughnessMap || null,
        normalMap: rocketTex?.normalMap || null,
        envMapIntensity: 1.6,
        normalScale: new THREE.Vector2(0.45, 0.45)
    });
    
    // Lighter titanium-gray for stage 2 & fairings
    const titaniumMap = tintMetalTexture(rocketTex?.map, {r:200,g:205,b:210,a:1.0});
    const stage2Metal = new THREE.MeshStandardMaterial({
        color: 0xe5eaef,
        metalness: 1.0,
        roughness: 0.44,
        map: titaniumMap,
        roughnessMap: rocketTex?.roughnessMap || null,
        normalMap: rocketTex?.normalMap || null,
        envMapIntensity: 1.75,
        normalScale: new THREE.Vector2(0.5, 0.5)
    });
    
    // Dark gunmetal for boosters
    const gunmetalMap = tintMetalTexture(rocketTex?.map, {r:80,g:85,b:95,a:1.0});
    const boosterMetal = new THREE.MeshStandardMaterial({
        color: 0x6a7080,
        metalness: 1.0,
        roughness: 0.52,
        map: gunmetalMap,
        roughnessMap: rocketTex?.roughnessMap || null,
        normalMap: rocketTex?.normalMap || null,
        envMapIntensity: 1.4,
        normalScale: new THREE.Vector2(0.4, 0.4)
    });
    
    // Very dark metal for engines/interstage (heat-resistant)
    const engineMap = tintMetalTexture(rocketTex?.map, {r:50,g:52,b:58,a:1.0});
    const engineMetal = new THREE.MeshStandardMaterial({
        color: 0x3a3e45,
        metalness: 1.0,
        roughness: 0.58,
        map: engineMap,
        roughnessMap: rocketTex?.roughnessMap || null,
        normalMap: rocketTex?.normalMap || null,
        envMapIntensity: 1.2,
        normalScale: new THREE.Vector2(0.35, 0.35)
    });
    
    const rocketGroup = new THREE.Group();
    const stage1 = new THREE.Mesh(new THREE.CylinderBufferGeometry(2.5, 2.5, 20, 64), stage1Metal); stage1.position.y = 10; rocketGroup.add(stage1);
    const interstage = new THREE.Mesh(new THREE.CylinderBufferGeometry(2.5, 2.2, 1, 64), engineMetal); interstage.position.y = 20.5; rocketGroup.add(interstage);
    const stage2 = new THREE.Mesh(new THREE.CylinderBufferGeometry(2.2, 2.2, 8, 64), stage2Metal); stage2.position.y = 25; rocketGroup.add(stage2);
    const fairingGeo = new THREE.ConeBufferGeometry(2.2, 5, 64, 2, 0, Math.PI); const fairingL = new THREE.Mesh(fairingGeo, stage2Metal); fairingL.position.y = 31.5; fairingL.rotation.y = -Math.PI / 2; rocketGroup.add(fairingL);
    const fairingR = new THREE.Mesh(fairingGeo, stage2Metal); fairingR.position.y = 31.5; fairingR.rotation.y = Math.PI / 2; rocketGroup.add(fairingR);
    const engineHousing = new THREE.Mesh(new THREE.CylinderBufferGeometry(2, 2.5, 2, 64), engineMetal); engineHousing.position.y = -1; rocketGroup.add(engineHousing);
    for (let i = 0; i < 4; i++) { const angle = (i / 4) * Math.PI * 2; const engineBell = new THREE.Mesh(new THREE.CylinderBufferGeometry(0.2, 0.8, 2, 32), engineMetal); engineBell.position.set(Math.sin(angle) * 1.2, -2, Math.cos(angle) * 1.2); rocketGroup.add(engineBell); }
    const boosters: THREE.Group[] = []; [-3.5, 3.5].forEach(x => { const boosterGroup = new THREE.Group(); const boosterBody = new THREE.Mesh(new THREE.CylinderBufferGeometry(1, 1, 16, 32), boosterMetal); boosterGroup.add(boosterBody); const boosterNose = new THREE.Mesh(new THREE.ConeBufferGeometry(1, 2.5, 32), engineMetal); boosterNose.position.y = 8 + 1.25; boosterGroup.add(boosterNose); boosterGroup.position.set(x, 7, 0); rocketGroup.add(boosterGroup); boosters.push(boosterGroup); });
    rocketGroup.traverse((c:any) => { if (c.isMesh) c.castShadow = true; });
    rocketGroup.position.y = 0; // Start on ground
    scene.add(rocketGroup);

    // --- SATELLITE MODEL ---
    const satelliteGroup = new THREE.Group();
    const goldMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 1.0, roughness: 0.3 }); const satBody = new THREE.Mesh( new THREE.BoxBufferGeometry(3, 3, 3), goldMaterial); satelliteGroup.add(satBody);
    const dish = new THREE.Mesh(new THREE.CylinderBufferGeometry(2.25, 1.8, 0.3, 64), new THREE.MeshStandardMaterial({ color: 0xffffff })); dish.position.set(0, 1.8, 0); dish.rotation.x = -Math.PI / 8; satelliteGroup.add(dish);
    for (let i = 0; i < 4; i++) { const antenna = new THREE.Mesh(new THREE.CylinderBufferGeometry(0.03, 0.03, 2.25, 8), engineMetal); const angle = i * (Math.PI / 2); antenna.position.set(Math.sin(angle) * 1.5, -1.8, Math.cos(angle) * 1.5); satelliteGroup.add(antenna); }
    const sensor = new THREE.Mesh(new THREE.BoxBufferGeometry(0.75, 0.75, 1.2), engineMetal); sensor.position.set(1.2, 0, 1.2); satelliteGroup.add(sensor);
    const solarPanels: THREE.Mesh[] = []; const panelGeo = new THREE.BoxBufferGeometry(6, 3, 0.15); const solarTexture = generateSolarPanelTexture(256, 128); const panelMat = new THREE.MeshStandardMaterial({ map: solarTexture, side: THREE.DoubleSide });
    const panelL = new THREE.Mesh(panelGeo, panelMat); panelL.position.x = -1.5; panelL.geometry.translate(3, 0, 0); panelL.rotation.y = Math.PI / 2; satelliteGroup.add(panelL); solarPanels.push(panelL);
    const panelR = new THREE.Mesh(panelGeo, panelMat); panelR.position.x = 1.5; panelR.geometry.translate(-3, 0, 0); panelR.rotation.y = -Math.PI / 2; satelliteGroup.add(panelR); solarPanels.push(panelR);
    satelliteGroup.traverse((c:any) => { if (c.isMesh) c.castShadow = true; });
    satelliteGroup.visible = false;
    scene.add(satelliteGroup);
    
    // --- REALISTIC EXHAUST PARTICLE SYSTEM ---
    const PARTICLE_COUNT = 5001;
    const particles: any[] = [];
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const alphas = new Float32Array(PARTICLE_COUNT);

    // Classic rocket exhaust: blue-white core, orange mid, deep red outer
    const colorHot = new THREE.Color(0xadd8ff);   // Pale blue-white core
    const colorWarm = new THREE.Color(0xffa500);  // Orange mid
    const colorCool = new THREE.Color(0xb22222);  // Deep red outer

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            age: 999, // Dead initially
            lifetime: 0,
            size: 0,
        });
        positions[i * 3 + 1] = -999; // Hide initially
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute('a_color', new THREE.BufferAttribute(colors, 3));
    particleGeometry.setAttribute('a_size', new THREE.BufferAttribute(sizes, 1));
    particleGeometry.setAttribute('a_alpha', new THREE.BufferAttribute(alphas, 1));

    const particleMaterial = new THREE.ShaderMaterial({
        uniforms: { u_texture: { value: createParticleTexture() } },
        vertexShader: exhaustVertexShader,
        fragmentShader: exhaustFragmentShader,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
    });
    const exhaustSystem = new THREE.Points(particleGeometry, particleMaterial);
    exhaustSystem.position.y = -3; // Emitter position relative to rocket
    rocketGroup.add(exhaustSystem);

    const updateExhaust = (deltaTime: number, intensity: number) => {
        const positions = particleGeometry.attributes.position.array;
        const colors = particleGeometry.attributes.a_color.array;
        const sizes = particleGeometry.attributes.a_size.array;
        const alphas = particleGeometry.attributes.a_alpha.array;
        
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const p = particles[i];
            p.age += deltaTime;

            if (p.age > p.lifetime) {
                if (Math.random() < intensity) { // Respawn particle based on intensity
                    p.age = 0;
                    p.lifetime = lerp(0.8, 1.5, Math.random());
                    p.position.set( (Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5 );
                    p.velocity.set( (Math.random() - 0.5) * 8, lerp(-50, -80, Math.random()), (Math.random() - 0.5) * 8 );
                } else {
                    positions[i * 3 + 1] = -999; // Hide dead particle
                    continue;
                }
            }
            
            p.position.addScaledVector(p.velocity, deltaTime);
            p.velocity.y *= 0.99; // Gravity/drag
            
            const ageRatio = p.age / p.lifetime;

            positions[i * 3] = p.position.x;
            positions[i * 3 + 1] = p.position.y;
            positions[i * 3 + 2] = p.position.z;
            
            sizes[i] = lerp(5, 20, ageRatio) * intensity;
            
            const tempColor = ageRatio < 0.3 ? colorHot.clone().lerp(colorWarm, ageRatio / 0.3) : colorWarm.clone().lerp(colorCool, (ageRatio - 0.3) / 0.7);
            colors[i * 3] = tempColor.r;
            colors[i * 3 + 1] = tempColor.g;
            colors[i * 3 + 2] = tempColor.b;
            
            alphas[i] = (1.0 - Math.pow(ageRatio, 2.0)) * intensity;
        }

        particleGeometry.attributes.position.needsUpdate = true;
        particleGeometry.attributes.a_color.needsUpdate = true;
        particleGeometry.attributes.a_size.needsUpdate = true;
        particleGeometry.attributes.a_alpha.needsUpdate = true;
    };


    camera.position.set(0, 100, 300);
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    const scrollState = { percent: 0 };
    let lastUIUpdate = 0;
    let orbitTime = 0; // Track orbit rotation over real time
    const handleScroll = () => { scrollState.percent = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100; };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    const handleResize = () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); };
    window.addEventListener('resize', handleResize);

    // Click handler for Earth/Satellite - redirects after animation completes
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    const handleMouseMove = (event: MouseEvent) => {
      // Only show pointer cursor after scroll animation is complete (> 51%)
      if (scrollState.percent < 51) {
        renderer.domElement.style.cursor = 'default';
        return;
      }
      
      // Calculate mouse position in normalized device coordinates
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      
      // Update raycaster
      raycaster.setFromCamera(mouse, camera);
      
      // Check for intersections with Earth and Satellite
      const intersectableObjects: any[] = [];
      earth.traverse((child) => {
        if (child instanceof THREE.Mesh) intersectableObjects.push(child);
      });
      satelliteGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) intersectableObjects.push(child);
      });
      
      const intersects = raycaster.intersectObjects(intersectableObjects, false);
      
      // Change cursor to pointer when hovering over clickable objects
      renderer.domElement.style.cursor = intersects.length > 0 ? 'pointer' : 'default';
    };
    
    const handleClick = (event: MouseEvent) => {
      // Only allow clicks after scroll animation is complete (> 51%)
      if (scrollState.percent < 51) return;
      
      // Calculate mouse position in normalized device coordinates
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      
      // Update raycaster
      raycaster.setFromCamera(mouse, camera);
      
      // Check for intersections with Earth and Satellite
      const intersectableObjects: any[] = [];
      earth.traverse((child) => {
        if (child instanceof THREE.Mesh) intersectableObjects.push(child);
      });
      satelliteGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) intersectableObjects.push(child);
      });
      
      const intersects = raycaster.intersectObjects(intersectableObjects, false);
      
      if (intersects.length > 0) {
        // Redirect to TerrautoMATE AI website
        window.location.href = 'https://eyeeterra.vercel.app/';
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('click', handleClick);


    const animate = (time: number) => {
        if (!isMounted) return;
        const deltaTime = clock.getDelta();
        const elapsedTime = clock.getElapsedTime();
        
        earth.rotation.y += 0.0005;
        clouds.rotation.y += 0.0007;
        
        // Animate ground clouds drifting
        if (groundGroup.visible) {
          groundGroup.children.forEach((child) => {
            if (child instanceof THREE.Group && child.children[0]?.material?.transparent) {
              child.position.x += deltaTime * 2;
              if (child.position.x > 700) child.position.x = -700;
            }
          });
        }

        const p = scrollState.percent / 100;
        let missionData: MissionData = { phase: '', altitude: 0, velocity: 0 };
        let exhaustIntensity = 0;

        let targetCamPos = new THREE.Vector3();
        let targetLookAt = new THREE.Vector3();
        let primarySubject = rocketGroup;

        const launchpadY = earthRadius + 3;
        const groundLaunchY = 0; // Ground level

        // --- ANIMATION PHASES ---
        // NEW: Ground launch sequence (0-15%)
        if (p <= 0.05) {
            // Pre-launch on ground
            rocketGroup.position.y = groundLaunchY;
            groundGroup.visible = true;
            earthGroup.visible = false;
            stars.visible = false;
            exhaustIntensity = 0;
            missionData = { phase: 'Pre-Launch Countdown', altitude: 0, velocity: 0 };
        } else if (p <= 0.10) {
            // Ignition on ground
            const phaseProgress = (p - 0.05) / 0.05;
            rocketGroup.position.y = groundLaunchY;
            groundGroup.visible = true;
            earthGroup.visible = false;
            stars.visible = false;
            exhaustIntensity = lerp(0, 0.3, phaseProgress);
            missionData = { phase: 'Ignition Sequence', altitude: 0, velocity: 0 };
        } else if (p <= 0.35) {
            // Liftoff from ground - ultra slow, extremely gradual (EXTENDED DURATION)
            const phaseProgress = easeInOutCubic((p - 0.10) / 0.25);
            // Very slow climb with extended time
            rocketGroup.position.y = lerp(groundLaunchY, groundLaunchY + 50, phaseProgress);
            groundGroup.visible = true;
            earthGroup.visible = false;
            stars.visible = false;
            exhaustIntensity = Math.min(0.7, phaseProgress * 1.2);
            missionData = { phase: 'Ground Liftoff', altitude: rocketGroup.position.y * 2, velocity: lerp(0, 0.18, phaseProgress) };
        } else if (p <= 0.50) {
            // Transition to space view - ULTRA LONG ultra smooth with quintic easing
            const phaseProgress = easeInOutQuint((p - 0.35) / 0.15);
            rocketGroup.position.y = lerp(groundLaunchY + 50, launchpadY, phaseProgress);
            // Ultra gradual crossfade with overlapping visibility
            const fadeOut = Math.max(0, Math.min(1, (phaseProgress - 0.5) / 0.35));
            const fadeIn = Math.max(0, Math.min(1, (phaseProgress - 0.05) / 0.5));
            groundGroup.visible = fadeOut < 0.98;
            earthGroup.visible = fadeIn > 0.02;
            stars.visible = fadeIn > 0.12;
            exhaustIntensity = lerp(0.45, 0.08, phaseProgress);
            missionData = { phase: 'Ascending to Orbit', altitude: rocketGroup.position.y * 5, velocity: lerp(0.18, 0.9, phaseProgress) };
        } 
        // EXISTING: Space-based animation continues (shifted to start at 50%)
        else if (p <= 0.53) { 
            rocketGroup.position.y = launchpadY;
            groundGroup.visible = false;
            earthGroup.visible = true;
            stars.visible = true;
            exhaustIntensity = 0;
            missionData = { phase: 'Orbital Approach', altitude: 0, velocity: 0 };
        } else if (p <= 0.58) { 
            rocketGroup.position.y = launchpadY;
            groundGroup.visible = false;
            earthGroup.visible = true;
            stars.visible = true;
            exhaustIntensity = lerp(0, 0.1, (p - 0.53) / 0.05);
            missionData = { phase: 'Launch Preparation', altitude: 0, velocity: 0 };
        } else if (p <= 0.72) { 
            const phaseProgress = easeInOutCubic((p - 0.58) / 0.14);
            rocketGroup.position.y = lerp(launchpadY, launchpadY + 250, phaseProgress);
            groundGroup.visible = false;
            earthGroup.visible = true;
            stars.visible = true;
            exhaustIntensity = Math.min(1, phaseProgress * 5);
            missionData = { phase: 'Orbital Liftoff & Ascent', altitude: (rocketGroup.position.y - earthRadius) * 5, velocity: lerp(0, 7.5, phaseProgress) };
        } else if (p <= 0.84) { 
            const phaseProgress = easeInOutCubic((p - 0.72) / 0.12);
            const stageSep = 0.3;
            rocketGroup.position.y = lerp(launchpadY + 250, launchpadY + 500, phaseProgress);
            groundGroup.visible = false;
            earthGroup.visible = true;
            stars.visible = true;

            if (phaseProgress > stageSep) {
                const sepProg = (phaseProgress - stageSep) / (1 - stageSep);
                boosters[0].position.x = lerp(-3.5, -20 - sepProg * 30, sepProg);
                boosters[1].position.x = lerp(3.5, 20 + sepProg * 30, sepProg);
                boosters[0].position.y = lerp(0, -10, sepProg);
                boosters[1].position.y = lerp(0, -10, sepProg);
                boosters[0].rotation.z = lerp(0, -0.3, sepProg);
                boosters[1].rotation.z = lerp(0, 0.3, sepProg);
            } else {
                boosters[0].position.set(-3.5, 0, -2);
                boosters[1].position.set(3.5, 0, -2);
                boosters[0].rotation.z = 0;
                boosters[1].rotation.z = 0;
            }

            exhaustIntensity = phaseProgress > stageSep ? lerp(1, 0.7, (phaseProgress - stageSep) / (1 - stageSep)) : 1;
            missionData = {
                phase: phaseProgress > stageSep ? 'Booster Separation' : 'Orbital Ascent',
                altitude: (rocketGroup.position.y - earthRadius) * 5,
                velocity: lerp(7.5, 9, phaseProgress),
            };
        } else if (p <= 0.94) { 
            const phaseProgress = easeInOutCubic((p - 0.84) / 0.10);
            rocketGroup.position.y = lerp(launchpadY + 500, launchpadY + 600, phaseProgress);
            groundGroup.visible = false;
            earthGroup.visible = true;
            stars.visible = true;
            exhaustIntensity = 0;
            fairingL.position.x = lerp(0, -5, phaseProgress); fairingL.rotation.z = lerp(0, -0.2, phaseProgress);
            fairingR.position.x = lerp(0, 5, phaseProgress); fairingR.rotation.z = lerp(0, 0.2, phaseProgress);
            // Satellite becomes visible but position will be set in next phase
            if (!satelliteGroup.visible) {
                satelliteGroup.visible = true;
                satelliteGroup.position.copy(rocketGroup.position);
                satelliteGroup.position.y = rocketGroup.position.y + 30;
            }
            primarySubject = satelliteGroup;
            missionData = { phase: 'Fairing Separation', altitude: (rocketGroup.position.y - earthRadius) * 5, velocity: lerp(15, 27.6, phaseProgress) };
        } else { 
            const phaseProgress = easeInOutCubic((p - 0.94) / 0.06);
            rocketGroup.position.y = lerp(launchpadY + 600, launchpadY + 580, phaseProgress);
            
            // Satellite orbital motion using continuous time-based rotation
            orbitTime += deltaTime * 0.5; // Increment orbit angle continuously
            const orbitRadius = earthRadius + 75; // Close orbit altitude
            const orbitAngle = orbitTime; // Continuous rotation based on time
            const orbitInclination = Math.PI / 8; // 22.5 degree tilt
            
            // Position satellite in inclined circular orbit around Earth's center (0,0,0)
            satelliteGroup.position.x = Math.cos(orbitAngle) * orbitRadius;
            satelliteGroup.position.y = Math.sin(orbitAngle) * orbitRadius * Math.sin(orbitInclination);
            satelliteGroup.position.z = Math.sin(orbitAngle) * orbitRadius * Math.cos(orbitInclination);
            
            // Rotate satellite to face direction of travel
            satelliteGroup.rotation.y = orbitAngle + Math.PI / 2;
            satelliteGroup.rotation.x = Math.sin(orbitAngle) * 0.15;
            
            // Animate solar panels (deploy early)
            solarPanels[0].rotation.y = lerp(Math.PI / 2, 0, Math.min(1, phaseProgress * 3));
            solarPanels[1].rotation.y = lerp(-Math.PI / 2, 0, Math.min(1, phaseProgress * 3));
            
            primarySubject = satelliteGroup;
            const altitudeKM = (orbitRadius - earthRadius) * 5;
            missionData = { phase: 'Orbital Operations', altitude: altitudeKM, velocity: 27.6 };
        }
        
        updateExhaust(deltaTime, exhaustIntensity);

        // --- CAMERA CONTROL ---
        if (p <= 0.05) {
            // Pre-launch ground view - wide establishing shot
            const phaseProgress = easeInOutCubic(p / 0.05);
            targetCamPos.lerpVectors(new THREE.Vector3(100, 20, 100), new THREE.Vector3(85, 18, 85), phaseProgress);
            targetLookAt.set(0, 12, 0);
        } else if (p <= 0.10) {
            // Ignition - slowly pushing in
            const phaseProgress = easeInOutCubic((p - 0.05) / 0.05);
            targetCamPos.lerpVectors(new THREE.Vector3(85, 18, 85), new THREE.Vector3(70, 20, 70), phaseProgress);
            targetLookAt.set(0, 12, 0);
        } else if (p <= 0.35) {
            // Liftoff from ground - ultra slow smooth tilt following rocket (EXTENDED DURATION)
            const phaseProgress = easeInOutCubic((p - 0.10) / 0.25);
            targetCamPos.lerpVectors(new THREE.Vector3(70, 20, 70), new THREE.Vector3(65, 38, 65), phaseProgress);
            targetLookAt.set(0, lerp(12, 33, phaseProgress), 0);
        } else if (p <= 0.38) {
            // Begin transition - camera pulls back ultra smoothly with quintic easing
            const phaseProgress = easeInOutQuint((p - 0.35) / 0.03);
            targetCamPos.lerpVectors(new THREE.Vector3(65, 38, 65), new THREE.Vector3(58, 60, 95), phaseProgress);
            targetLookAt.lerpVectors(new THREE.Vector3(0, 33, 0), new THREE.Vector3(0, 31, 0), phaseProgress);
        } else if (p <= 0.42) {
            // Continue transition - mid stage (slow pullback)
            const phaseProgress = easeInOutQuint((p - 0.38) / 0.04);
            targetCamPos.lerpVectors(new THREE.Vector3(58, 60, 95), new THREE.Vector3(42, 90, 140), phaseProgress);
            targetLookAt.lerpVectors(new THREE.Vector3(0, 31, 0), new THREE.Vector3(0, 28, 0), phaseProgress);
        } else if (p <= 0.46) {
            // Continue transition - revealing more space
            const phaseProgress = easeInOutQuint((p - 0.42) / 0.04);
            targetCamPos.lerpVectors(new THREE.Vector3(42, 90, 140), new THREE.Vector3(25, 115, 200), phaseProgress);
            targetLookAt.lerpVectors(new THREE.Vector3(0, 28, 0), new THREE.Vector3(0, 23, 0), phaseProgress);
        } else if (p <= 0.51) {
            // Final approach to space view - ultra ultra gradual
            const phaseProgress = easeInOutQuint((p - 0.46) / 0.05);
            targetCamPos.lerpVectors(new THREE.Vector3(25, 115, 200), new THREE.Vector3(0, launchpadY + 25, 60), phaseProgress);
            targetLookAt.lerpVectors(new THREE.Vector3(0, 23, 0), new THREE.Vector3(0, launchpadY + 20, 0), phaseProgress);
        } else {
            const currentCameraAngle = cameraAngleRef.current;
            if (currentCameraAngle === 'cinematic') {
                if (p <= 0.58) { targetCamPos.set(0, launchpadY + 25, 60); targetLookAt.set(0, launchpadY + 20, 0); } 
                else if (p <= 0.72) { const phaseProgress = easeInOutCubic((p - 0.58) / 0.14); const camAngle = phaseProgress * Math.PI * 0.5; targetCamPos.set(Math.sin(camAngle) * 30, rocketGroup.position.y + 15, 60 + Math.cos(camAngle) * 15); targetLookAt.set(0, rocketGroup.position.y, 0); } 
                else if (p <= 0.84) { targetCamPos.set(65, rocketGroup.position.y + 35, 65); targetLookAt.copy(rocketGroup.position); } 
                else if (p <= 0.94) { targetCamPos.set(-20, satelliteGroup.position.y + 10, 40); targetLookAt.copy(satelliteGroup.position); } 
                else { 
                    // Camera orbits around origin showing Earth and satellite
                    const camOrbitRadius = 180; // Camera distance from origin
                    const camAngleOffset = orbitTime * 0.3; // Camera rotates slowly
                    const camElevation = 70; // Elevated view
                    
                    targetCamPos.set(
                        Math.cos(camAngleOffset) * camOrbitRadius,
                        camElevation,
                        Math.sin(camAngleOffset) * camOrbitRadius
                    );
                    // Look at origin (center of Earth) to keep both Earth and satellite in frame
                    targetLookAt.set(0, 0, 0);
                }
            } else if (currentCameraAngle === 'follow') { const offset = new THREE.Vector3(0, 20, -70); const targetPos = primarySubject.localToWorld(offset); targetCamPos.copy(targetPos); targetLookAt.copy(primarySubject.position); } 
            else if (currentCameraAngle === 'wide') { const offset = new THREE.Vector3(180, 180, 180); targetCamPos.copy(primarySubject.position).add(offset); targetLookAt.copy(primarySubject.position); }
        }
        
        const lerpFactor = p <= 0.51 ? 0.012 : 0.04;
        camera.position.lerp(targetCamPos, lerpFactor);
        const currentLookAt = new THREE.Vector3().copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()));
        currentLookAt.lerp(targetLookAt, lerpFactor);
        camera.lookAt(currentLookAt);

        if (time - lastUIUpdate > 16) { onSceneUpdateRef.current(scrollState.percent, missionData); lastUIUpdate = time; }
        renderer.render(scene, camera);
        animationFrameId = requestAnimationFrame(animate);
    };

    return () => {
      isMounted = false;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('click', handleClick);
      if (mountNode && renderer.domElement) { mountNode.removeChild(renderer.domElement); }
      scene.traverse((o: any) => { 
        if (o.geometry) o.geometry.dispose(); 
        if (o.material) {
            if (Array.isArray(o.material)) { o.material.forEach((m: any) => m.dispose()); } 
            else { o.material.dispose(); }
        }
      });
            if (scene.environment && scene.environment.dispose) { try { scene.environment.dispose(); } catch(_){} }
      renderer.dispose();
    };
  }, [setLoading]);

  return <div ref={mountRef} className="absolute top-0 left-0 w-full h-full" />;
};

export default ThreeScene;