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

// Generate procedural grass texture
const generateGrassTexture = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    // Base green
    ctx.fillStyle = '#2d5a2d';
    ctx.fillRect(0, 0, width, height);
    
    // Add grass variation
    for (let i = 0; i < width * height / 4; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const shade = Math.random() * 40 - 20;
        ctx.fillStyle = `rgb(${45 + shade}, ${90 + shade}, ${45 + shade})`;
        ctx.fillRect(x, y, 2, 2);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
};

// Generate launch pad concrete texture
const generateConcreteTexture = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, width, height);
    
    // Add concrete variation and cracks
    for (let i = 0; i < width * height / 8; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const shade = Math.random() * 60 - 30;
        ctx.fillStyle = `rgb(${128 + shade}, ${128 + shade}, ${128 + shade})`;
        ctx.fillRect(x, y, 1, 1);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
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

    const loadingManager = new THREE.LoadingManager(() => {
        setLoading(false);
        if (isMounted) {
            animationFrameId = requestAnimationFrame(animate);
        }
    });
    const textureLoader = new THREE.TextureLoader(loadingManager);

        const scene = new THREE.Scene();
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

    // --- LAUNCH SITE ENVIRONMENT ---
    // Create terrain ground plane
    const grassTexture = generateGrassTexture(512, 512);
    grassTexture.repeat.set(20, 20);
    const terrainMaterial = new THREE.MeshStandardMaterial({ 
        map: grassTexture, 
        roughness: 0.8,
        color: 0x90c090
    });
    const terrain = new THREE.Mesh(new THREE.PlaneBufferGeometry(2000, 2000, 64, 64), terrainMaterial);
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.y = -2;
    terrain.receiveShadow = true;
    scene.add(terrain);
    
    // Launch pad
    const concreteTexture = generateConcreteTexture(256, 256);
    concreteTexture.repeat.set(4, 4);
    const launchPadMaterial = new THREE.MeshStandardMaterial({ map: concreteTexture, roughness: 0.9 });
    const launchPad = new THREE.Mesh(new THREE.CylinderBufferGeometry(15, 15, 1, 32), launchPadMaterial);
    launchPad.position.y = -1.5;
    launchPad.receiveShadow = true;
    scene.add(launchPad);
    
    // Launch tower structure
    const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8, roughness: 0.3 });
    const tower = new THREE.Mesh(new THREE.BoxBufferGeometry(2, 50, 2), towerMaterial);
    tower.position.set(25, 24, 0);
    tower.castShadow = true;
    scene.add(tower);
    
    // Add some trees around launch site
    const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x0d4d0d });
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    for (let i = 0; i < 20; i++) {
        const angle = (i / 20) * Math.PI * 2;
        const distance = 80 + Math.random() * 100;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;
        
        // Tree trunk
        const trunk = new THREE.Mesh(new THREE.CylinderBufferGeometry(1, 1.5, 8), trunkMaterial);
        trunk.position.set(x, 2, z);
        trunk.castShadow = true;
        scene.add(trunk);
        
        // Tree foliage
        const foliage = new THREE.Mesh(new THREE.SphereBufferGeometry(6, 16, 16), treeMaterial);
        foliage.position.set(x, 10, z);
        foliage.castShadow = true;
        scene.add(foliage);
    }
    
    // Distant mountains (low poly)
    const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.9 });
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const distance = 800 + Math.random() * 200;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;
        const height = 40 + Math.random() * 60;
        
        const mountain = new THREE.Mesh(new THREE.ConeBufferGeometry(30 + Math.random() * 20, height), mountainMaterial);
        mountain.position.set(x, height / 2 - 2, z);
        scene.add(mountain);
    }

    const starVertices = [];
    for (let i = 0; i < 10000; i++) { starVertices.push((Math.random() - 0.5) * 3000, (Math.random() - 0.5) * 3000, (Math.random() - 0.5) * 3000); }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9 }));
    scene.add(stars);

    const earthGroup = new THREE.Group();
    const earthRadius = 500; // Much larger Earth for realistic curvature
    const earthMaterial = new THREE.MeshStandardMaterial({
        map: textureLoader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'),
        bumpMap: textureLoader.load('https://unpkg.com/three-globe/example/img/earth-topology.png'),
        bumpScale: 0.1,
        roughness: 0.85
    });
    const earth = new THREE.Mesh(new THREE.SphereBufferGeometry(earthRadius, 64, 64), earthMaterial);
    earth.receiveShadow = true;
    earthGroup.add(earth);
    
    // Position Earth far below launch site
    earthGroup.position.y = -earthRadius - 100;
    
    const cloudMaterial = new THREE.MeshStandardMaterial({
        map: textureLoader.load('https://solarsystem.nasa.gov/assets/ve-clouds-8k.png'),
        transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending
    });
    const clouds = new THREE.Mesh(new THREE.SphereBufferGeometry(earthRadius + 5, 64, 64), cloudMaterial);
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
    rocketGroup.position.y = 10; // Start on launch pad (ground level)
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
    const PARTICLE_COUNT = 5000;
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

    const animate = (time: number) => {
        if (!isMounted) return;
        const deltaTime = clock.getDelta();
        
        earth.rotation.y += 0.0005;
        clouds.rotation.y += 0.0007;

        const p = scrollState.percent / 100;
        let missionData: MissionData = { phase: '', altitude: 0, velocity: 0 };
        let exhaustIntensity = 0;

        let targetCamPos = new THREE.Vector3();
        let targetLookAt = new THREE.Vector3();
        let primarySubject = rocketGroup;

        const launchpadY = 10; // Ground level launch pad

        // --- ANIMATION PHASES ---
        if (p <= 0.10) { 
            rocketGroup.position.y = launchpadY; exhaustIntensity = 0;
            missionData = { phase: 'Pre-Launch', altitude: 0, velocity: 0 };
        } else if (p <= 0.25) { 
            rocketGroup.position.y = launchpadY; exhaustIntensity = lerp(0, 0.1, (p - 0.10) / 0.15); // Steam vent effect
            missionData = { phase: 'Launch Preparation', altitude: 0, velocity: 0 };
        } else if (p <= 0.40) { 
            const phaseProgress = easeInOutCubic((p - 0.25) / 0.15);
            rocketGroup.position.y = lerp(launchpadY, launchpadY + 300, phaseProgress);
            exhaustIntensity = Math.min(1, phaseProgress * 5);
            missionData = { phase: 'Liftoff & Ascent', altitude: (rocketGroup.position.y - launchpadY) * 2, velocity: lerp(0, 5.0, phaseProgress) };
        } else if (p <= 0.55) {
            // Transition to space - rocket moves to Earth-relative position
            const phaseProgress = easeInOutCubic((p - 0.40) / 0.15);
            const spaceY = earthRadius + 53 + (phaseProgress * 200); // Transition to current space altitude
            rocketGroup.position.y = lerp(launchpadY + 300, spaceY, phaseProgress);
            exhaustIntensity = lerp(1.0, 0.8, phaseProgress);
            missionData = { phase: 'Atmospheric Exit', altitude: (rocketGroup.position.y - launchpadY) * 2, velocity: lerp(5.0, 7.5, phaseProgress) };
        } else if (p <= 0.70) { 
            const phaseProgress = easeInOutCubic((p - 0.50) / 0.20);
            rocketGroup.position.y = lerp(launchpadY + 250, launchpadY + 500, phaseProgress);
            exhaustIntensity = lerp(1.0, 0.5, phaseProgress);
            boosters[0].position.x = lerp(-3.5, -20 - phaseProgress * 30, phaseProgress);
            boosters[1].position.x = lerp(3.5, 20 + phaseProgress * 30, phaseProgress);
            boosters.forEach(b => { b.rotation.z += phaseProgress * 0.02; b.position.y -= phaseProgress * 0.8; });
            missionData = { phase: 'Booster Separation', altitude: (rocketGroup.position.y - earthRadius) * 5, velocity: lerp(7.5, 15, phaseProgress) };
        } else if (p <= 0.85) { 
            const phaseProgress = easeInOutCubic((p - 0.70) / 0.15);
            rocketGroup.position.y = lerp(launchpadY + 500, launchpadY + 600, phaseProgress);
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
            const phaseProgress = easeInOutCubic((p - 0.85) / 0.15);
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

        if (p <= 0.10) {
            const phaseProgress = easeInOutCubic(p / 0.10);
            // Ground-based launch cameras
            targetCamPos.lerpVectors(new THREE.Vector3(0, 15, 80), new THREE.Vector3(-20, 20, 50), phaseProgress);
            targetLookAt.lerpVectors(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, launchpadY + 15, 0), phaseProgress);
        } else {
            const currentCameraAngle = cameraAngleRef.current;
            if (currentCameraAngle === 'cinematic') {
                if (p <= 0.25) { targetCamPos.set(-20, 20, 50); targetLookAt.set(0, launchpadY + 15, 0); } 
                else if (p <= 0.40) { 
                    const phaseProgress = easeInOutCubic((p - 0.25) / 0.15); 
                    const height = rocketGroup.position.y;
                    targetCamPos.set(-30, height + 20, 60); 
                    targetLookAt.set(0, height, 0); 
                } 
                else if (p <= 0.55) {
                    // Transition to space view
                    const phaseProgress = easeInOutCubic((p - 0.40) / 0.15);
                    const spaceViewY = lerp(rocketGroup.position.y + 20, earthRadius + 78, phaseProgress);
                    targetCamPos.set(0, spaceViewY, lerp(60, 45, phaseProgress)); 
                    targetLookAt.set(0, lerp(rocketGroup.position.y, earthRadius + 68, phaseProgress), 0); 
                }
                else if (p <= 0.70) { const phaseProgress = easeInOutCubic((p - 0.55) / 0.15); targetCamPos.set(65, rocketGroup.position.y + 35, 65); targetLookAt.copy(rocketGroup.position); } 
                else if (p <= 0.85) { targetCamPos.set(-20, satelliteGroup.position.y + 10, 40); targetLookAt.copy(satelliteGroup.position); } 
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
        
        camera.position.lerp(targetCamPos, 0.05);
        const currentLookAt = new THREE.Vector3().copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()));
        currentLookAt.lerp(targetLookAt, 0.05);
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