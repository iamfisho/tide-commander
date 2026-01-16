import * as THREE from 'three';

/**
 * Time of day phases
 */
type TimePhase = 'night' | 'dawn' | 'day' | 'dusk';

/**
 * Floor texture styles
 */
export type FloorStyle = 'none' | 'concrete' | 'galactic' | 'metal' | 'hex' | 'circuit';

/**
 * Time-based configuration for the environment
 */
interface TimeConfig {
  phase: TimePhase;
  sunPosition: THREE.Vector3;
  moonPosition: THREE.Vector3;
  ambientColor: number;
  ambientIntensity: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  mainLightColor: number;
  mainLightIntensity: number;
  fogColor: number;
  fogDensity: number;
  skyColor: number;
  starsOpacity: number;
  moonOpacity: number;
  sunOpacity: number;
  lampIntensity: number;
  windowEmissive: number;
}

/**
 * Creates and manages the battlefield environment with day/night cycle.
 */
export class Battlefield {
  private scene: THREE.Scene;
  private ground: THREE.Mesh | null = null;
  private gridHelper: THREE.GridHelper | null = null;

  // Time-based elements
  private sun: THREE.Sprite | null = null;
  private moon: THREE.Sprite | null = null;
  private stars: THREE.Points | null = null;
  private ambientLight: THREE.AmbientLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private mainLight: THREE.DirectionalLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;
  private lampLights: THREE.PointLight[] = [];
  private windowMaterials: THREE.MeshStandardMaterial[] = [];

  // Terrain elements (for show/hide)
  private trees: THREE.Group[] = [];
  private bushes: THREE.Group[] = [];
  private house: THREE.Group | null = null;
  private lamps: THREE.Group[] = [];
  private grass: THREE.Mesh | null = null;
  private baseFogDensity = 0.01;
  private currentFloorStyle: FloorStyle = 'concrete';

  // Galactic floor elements (for deep space effect)
  private galacticGroup: THREE.Group | null = null;
  private galacticStars: THREE.Points | null = null;
  private galacticNebulas: THREE.Mesh[] = [];
  private galacticTime = 0;

  // Debug: override time for testing (set to null to use real time)
  private debugHourOverride: number | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Set grid visibility.
   */
  setGridVisible(visible: boolean): void {
    if (this.gridHelper) {
      this.gridHelper.visible = visible;
    }
  }

  /**
   * Create the complete battlefield environment.
   */
  create(): void {
    this.createGround();
    this.createGrass();
    this.createGrid();
    this.createLogo();
    this.createSun();
    this.createMoon();
    this.createStars();
    this.createTrees();
    this.createBushes();
    this.createHouse();
    this.createStreetLamps();
    this.createLighting();
    this.createFog();

    // Apply initial time-based settings
    this.updateTimeOfDay();
  }

  /**
   * Update the environment based on current time of day.
   * Call this periodically or when time changes.
   */
  updateTimeOfDay(): void {
    const config = this.getTimeConfig();
    this.applyTimeConfig(config);
  }

  /**
   * Get the current hour (0-24) based on local timezone.
   */
  private getCurrentHour(): number {
    // Debug override for testing
    if (this.debugHourOverride !== null) {
      return this.debugHourOverride;
    }
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  }

  /**
   * Set a debug time override for testing (null to use real time).
   */
  setDebugTime(hour: number | null): void {
    this.debugHourOverride = hour;
    this.updateTimeOfDay();
    console.log(`[Battlefield] Time set to: ${hour !== null ? `${hour}:00` : 'real time'}`);
  }

  /**
   * Set time mode for the environment.
   * @param mode - 'auto' for real time, or 'day'/'night'/'dawn'/'dusk' for fixed time
   */
  setTimeMode(mode: string): void {
    const modeToHour: Record<string, number | null> = {
      'auto': null,
      'day': 12,
      'night': 23,
      'dawn': 6,
      'dusk': 19.5,
    };
    const hour = modeToHour[mode] ?? null;
    this.debugHourOverride = hour;
    this.updateTimeOfDay();
    console.log(`[Battlefield] Time mode set to: ${mode} (${hour !== null ? `${hour}:00` : 'real time'})`);
  }

  /**
   * Set terrain configuration (show/hide elements, fog density).
   */
  setTerrainConfig(config: {
    showTrees: boolean;
    showBushes: boolean;
    showHouse: boolean;
    showLamps: boolean;
    showGrass: boolean;
    fogDensity: number;
  }): void {
    // Toggle trees
    this.trees.forEach(tree => { tree.visible = config.showTrees; });

    // Toggle bushes
    this.bushes.forEach(bush => { bush.visible = config.showBushes; });

    // Toggle house
    if (this.house) {
      this.house.visible = config.showHouse;
    }

    // Toggle lamps and their lights
    this.lamps.forEach(lamp => { lamp.visible = config.showLamps; });
    this.lampLights.forEach(light => { light.visible = config.showLamps; });

    // Toggle grass
    if (this.grass) {
      this.grass.visible = config.showGrass;
    }

    // Update fog density (0 = off, 1 = normal, 2 = heavy)
    this.baseFogDensity = config.fogDensity * 0.008;
    this.updateTimeOfDay(); // Re-apply time config which uses fog density
  }

  /**
   * Set the floor texture style.
   */
  setFloorStyle(style: FloorStyle, force = false): void {
    if (this.currentFloorStyle === style && !force) return;
    const previousStyle = this.currentFloorStyle;
    this.currentFloorStyle = style;

    console.log(`[Battlefield] Switching floor from ${previousStyle} to ${style} (force=${force})`);

    // Clean up galactic elements if switching away from galactic
    if (previousStyle === 'galactic') {
      this.removeGalacticElements();
      // Show ground again
      if (this.ground) {
        this.ground.visible = true;
      }
    }

    if (this.ground) {
      const material = this.ground.material as THREE.MeshStandardMaterial;

      // Special handling for galactic - HIDE the floor and show galaxy elements
      if (style === 'galactic') {
        console.log('[Battlefield] Creating galactic floor...');

        // Hide the regular ground completely
        this.ground.visible = false;

        // Create the galactic visuals
        this.createGalacticElements();

        console.log('[Battlefield] Galactic elements created');
      } else {
        // Show ground for non-galactic styles
        this.ground.visible = true;

        // Regular floor styles
        material.transparent = false;
        material.opacity = 1;
        material.side = THREE.FrontSide;
        material.depthWrite = true;
        this.ground!.renderOrder = 0;

        // Handle 'none' style - match the grass terrain
        if (style === 'none') {
          material.map = null;
          material.color.setHex(0x2d5a27); // Same as grass
          material.roughness = 0.9;
          material.metalness = 0;
          material.emissive.setHex(0x000000);
          material.emissiveIntensity = 0;
          material.needsUpdate = true;
        } else {
          const texture = this.generateFloorTexture(style);
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(6, 6);
          material.map = texture;
          material.needsUpdate = true;
        }

        // Adjust material properties based on style
        switch (style) {
          case 'none':
            // Already handled above
            break;
          case 'metal':
            material.color.setHex(0x888899);
            material.roughness = 0.4;
            material.metalness = 0.8;
            material.emissive.setHex(0x000000);
            material.emissiveIntensity = 0;
            break;
          case 'hex':
            material.color.setHex(0x446688);
            material.roughness = 0.6;
            material.metalness = 0.4;
            material.emissive.setHex(0x112233);
            material.emissiveIntensity = 0.2;
            break;
          case 'circuit':
            material.color.setHex(0x224433);
            material.roughness = 0.7;
            material.metalness = 0.3;
            material.emissive.setHex(0x003322);
            material.emissiveIntensity = 0.4;
            break;
          default: // concrete
            material.color.setHex(0x555555);
            material.roughness = 0.8;
            material.metalness = 0.1;
            material.emissive.setHex(0x000000);
            material.emissiveIntensity = 0;
        }
      }
    }
    console.log(`[Battlefield] Floor style set to: ${style}`);
  }

  /**
   * Create the deep space elements as the floor for galactic style.
   */
  private createGalacticElements(): void {
    this.galacticGroup = new THREE.Group();
    this.galacticGroup.name = 'galacticFloor';

    // Create the main galaxy texture plane (this IS the floor now)
    this.createGalaxyPlane();

    // Add star field particles
    this.createGalacticStarField();

    // Add nebula cloud effects
    this.createNebulaClouds();

    // Add glowing portal rim around the edge
    this.createPortalRim();

    // Add floating cosmic dust particles
    this.createCosmicDust();

    this.scene.add(this.galacticGroup);
    console.log('[Battlefield] Galactic group added to scene:', this.galacticGroup);
  }

  /**
   * Create the main galaxy background plane - this replaces the floor.
   */
  private createGalaxyPlane(): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 2048;
    canvas.height = 2048;

    // Deep space background - darker at edges
    const bgGradient = ctx.createRadialGradient(1024, 1024, 0, 1024, 1024, 1024);
    bgGradient.addColorStop(0, '#2a1050');
    bgGradient.addColorStop(0.2, '#1a0a40');
    bgGradient.addColorStop(0.5, '#0d0525');
    bgGradient.addColorStop(0.8, '#060215');
    bgGradient.addColorStop(1, '#020108');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, 2048, 2048);

    // Draw spiral galaxy with 3 arms
    ctx.save();
    ctx.translate(1024, 1024);

    for (let arm = 0; arm < 3; arm++) {
      const armAngle = (arm / 3) * Math.PI * 2;
      ctx.save();
      ctx.rotate(armAngle);

      // Draw stars along spiral arm
      for (let i = 0; i < 1500; i++) {
        const distance = (i / 1500) * 800;
        const spiralAngle = distance * 0.012;
        const spread = distance * 0.15;

        const x = Math.cos(spiralAngle) * distance + (Math.random() - 0.5) * spread;
        const y = Math.sin(spiralAngle) * distance + (Math.random() - 0.5) * spread;

        const brightness = 1 - (distance / 800) * 0.6;
        const size = (1 - distance / 800) * 4 + Math.random() * 3;

        // Colors: white/yellow at core, blue/purple at edges
        const r = Math.floor(220 * brightness + 35);
        const g = Math.floor(200 * brightness + 55);
        const b = Math.floor(255);

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${brightness})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();

        // Add glow to brighter stars
        if (brightness > 0.7 && Math.random() > 0.5) {
          const glowGradient = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
          glowGradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.6)`);
          glowGradient.addColorStop(1, 'transparent');
          ctx.fillStyle = glowGradient;
          ctx.beginPath();
          ctx.arc(x, y, size * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Bright galaxy core with multiple layers
    const coreGradient1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 200);
    coreGradient1.addColorStop(0, 'rgba(255, 255, 255, 1)');
    coreGradient1.addColorStop(0.1, 'rgba(255, 240, 220, 0.95)');
    coreGradient1.addColorStop(0.3, 'rgba(255, 200, 150, 0.7)');
    coreGradient1.addColorStop(0.6, 'rgba(200, 150, 255, 0.4)');
    coreGradient1.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGradient1;
    ctx.beginPath();
    ctx.arc(0, 0, 200, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Add lots of background stars
    for (let i = 0; i < 1000; i++) {
      const x = Math.random() * 2048;
      const y = Math.random() * 2048;
      const size = 0.5 + Math.random() * 2.5;
      const brightness = 150 + Math.random() * 105;

      // Random star colors
      const colorRand = Math.random();
      let r, g, b;
      if (colorRand < 0.6) {
        r = brightness; g = brightness; b = 255; // Blue-white
      } else if (colorRand < 0.8) {
        r = 255; g = brightness; b = brightness * 0.7; // Yellow-orange
      } else {
        r = 255; g = brightness * 0.6; b = brightness; // Pink
      }

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 1)`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();

      // Add glow to some stars
      if (Math.random() > 0.85) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 6);
        glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.7)`);
        glow.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.2)`);
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, size * 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Add some nebula clouds
    const nebulaColors = ['#ff00ff', '#00ffff', '#ff6600', '#6600ff'];
    for (let i = 0; i < 8; i++) {
      const nx = 300 + Math.random() * 1448;
      const ny = 300 + Math.random() * 1448;
      const nsize = 100 + Math.random() * 200;
      const color = nebulaColors[i % nebulaColors.length];

      const nebGradient = ctx.createRadialGradient(nx, ny, 0, nx, ny, nsize);
      nebGradient.addColorStop(0, color + '40');
      nebGradient.addColorStop(0.5, color + '15');
      nebGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = nebGradient;
      ctx.beginPath();
      ctx.arc(nx, ny, nsize, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    // Create the floor plane - same size as original ground (30x30)
    const geometry = new THREE.PlaneGeometry(30, 30);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
    });

    const galaxyPlane = new THREE.Mesh(geometry, material);
    galaxyPlane.rotation.x = -Math.PI / 2;
    galaxyPlane.position.y = 0.01; // Slightly above y=0
    galaxyPlane.name = 'galaxyPlane';
    galaxyPlane.receiveShadow = true;

    this.galacticGroup!.add(galaxyPlane);
    console.log('[Battlefield] Galaxy plane created:', galaxyPlane.position);
  }

  /**
   * Create animated star field particles above the galaxy.
   */
  private createGalacticStarField(): void {
    const geometry = new THREE.BufferGeometry();
    const count = 500;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Spread in a circle matching floor size
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 14;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.05 + Math.random() * 0.3; // Slightly above floor
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      // Colorful stars
      const colorChoice = Math.random();
      if (colorChoice < 0.4) {
        colors[i * 3] = 0.9; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 1; // White-blue
      } else if (colorChoice < 0.6) {
        colors[i * 3] = 1; colors[i * 3 + 1] = 0.8; colors[i * 3 + 2] = 0.4; // Yellow
      } else if (colorChoice < 0.8) {
        colors[i * 3] = 1; colors[i * 3 + 1] = 0.4; colors[i * 3 + 2] = 0.8; // Pink
      } else {
        colors[i * 3] = 0.4; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1; // Cyan
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.15,
      transparent: true,
      opacity: 0.9,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.galacticStars = new THREE.Points(geometry, material);
    this.galacticStars.name = 'galacticStars';
    this.galacticStars.renderOrder = 5;
    this.galacticGroup!.add(this.galacticStars);
  }

  /**
   * Create colorful nebula cloud effects.
   */
  private createNebulaClouds(): void {
    const nebulaColors = [0xff00ff, 0x00ffff, 0xff6600, 0x6600ff, 0x00ff66];

    for (let i = 0; i < 4; i++) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.width = 256;
      canvas.height = 256;

      // Soft nebula cloud
      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
      gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.3)');
      gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.1)');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);

      const texture = new THREE.CanvasTexture(canvas);
      const size = 6 + Math.random() * 6;
      const geometry = new THREE.PlaneGeometry(size, size);

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: nebulaColors[i % nebulaColors.length],
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const nebula = new THREE.Mesh(geometry, material);
      nebula.rotation.x = -Math.PI / 2;
      nebula.position.set(
        (Math.random() - 0.5) * 20,
        0.03 + i * 0.01,
        (Math.random() - 0.5) * 20
      );
      nebula.name = `nebula_${i}`;
      nebula.renderOrder = 2 + i;

      this.galacticNebulas.push(nebula);
      this.galacticGroup!.add(nebula);
    }
  }

  /**
   * Create floating cosmic dust particles.
   */
  private createCosmicDust(): void {
    const geometry = new THREE.BufferGeometry();
    const count = 150;
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 14;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.1 + Math.random() * 2; // Float above floor
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      size: 0.15,
      color: 0x8888ff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const dust = new THREE.Points(geometry, material);
    dust.name = 'cosmicDust';
    this.galacticGroup!.add(dust);
  }

  /**
   * Create a glowing rim around the floor portal.
   */
  private createPortalRim(): void {
    const rimGeometry = new THREE.RingGeometry(14.5, 15.5, 64);
    const rimMaterial = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.02;
    rim.name = 'portalRim';
    this.galacticGroup!.add(rim);

    // Inner glow
    const innerRimGeometry = new THREE.RingGeometry(13.5, 14.5, 64);
    const innerRimMaterial = new THREE.MeshBasicMaterial({
      color: 0x8844ff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const innerRim = new THREE.Mesh(innerRimGeometry, innerRimMaterial);
    innerRim.rotation.x = -Math.PI / 2;
    innerRim.position.y = 0.01;
    innerRim.name = 'portalInnerRim';
    this.galacticGroup!.add(innerRim);
  }

  /**
   * Remove galactic elements from the scene.
   */
  private removeGalacticElements(): void {
    if (this.galacticGroup) {
      this.scene.remove(this.galacticGroup);
      this.galacticGroup = null;
      this.galacticStars = null;
      this.galacticNebulas = [];
    }
  }

  /**
   * Update galactic floor animation (call from render loop).
   */
  updateGalacticAnimation(deltaTime: number): void {
    if (this.currentFloorStyle !== 'galactic' || !this.galacticGroup) return;

    this.galacticTime += deltaTime;

    // Slowly rotate the galaxy plane
    const galaxyPlane = this.galacticGroup.getObjectByName('galaxyPlane') as THREE.Mesh;
    if (galaxyPlane) {
      galaxyPlane.rotation.z = this.galacticTime * 0.02;
    }

    // Animate nebulas (slow drift and pulse)
    this.galacticNebulas.forEach((nebula, i) => {
      nebula.rotation.z += deltaTime * 0.03 * (i % 2 === 0 ? 1 : -1);
      // Gentle drift
      nebula.position.x += Math.sin(this.galacticTime * 0.2 + i * 2) * deltaTime * 0.1;
      nebula.position.z += Math.cos(this.galacticTime * 0.15 + i * 2) * deltaTime * 0.1;
      // Keep within bounds
      if (Math.abs(nebula.position.x) > 12) nebula.position.x *= 0.9;
      if (Math.abs(nebula.position.z) > 12) nebula.position.z *= 0.9;
      const material = nebula.material as THREE.MeshBasicMaterial;
      material.opacity = 0.15 + Math.sin(this.galacticTime * 0.5 + i) * 0.1;
    });

    // Animate portal rim pulsing
    const rim = this.galacticGroup.getObjectByName('portalRim') as THREE.Mesh;
    if (rim) {
      const material = rim.material as THREE.MeshBasicMaterial;
      material.opacity = 0.5 + Math.sin(this.galacticTime * 2) * 0.3;
    }

    const innerRim = this.galacticGroup.getObjectByName('portalInnerRim') as THREE.Mesh;
    if (innerRim) {
      const material = innerRim.material as THREE.MeshBasicMaterial;
      material.opacity = 0.3 + Math.sin(this.galacticTime * 3 + 1) * 0.2;
    }

    // Animate cosmic dust (floating upward slowly, then resetting)
    const dust = this.galacticGroup.getObjectByName('cosmicDust') as THREE.Points;
    if (dust) {
      const positions = dust.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 1] += deltaTime * 0.15;
        // Reset when too high
        if (positions[i + 1] > 3) {
          positions[i + 1] = 0.1;
          // Randomize x/z position on reset
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * 14;
          positions[i] = Math.cos(angle) * radius;
          positions[i + 2] = Math.sin(angle) * radius;
        }
      }
      dust.geometry.attributes.position.needsUpdate = true;
    }

    // Twinkle effect for stars + gentle rotation
    if (this.galacticStars) {
      const material = this.galacticStars.material as THREE.PointsMaterial;
      material.opacity = 0.7 + Math.sin(this.galacticTime * 4) * 0.2;
      this.galacticStars.rotation.y = this.galacticTime * 0.01;
    }
  }

  /**
   * Generate a floor texture programmatically.
   */
  private generateFloorTexture(style: FloorStyle): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 512;
    canvas.height = 512;

    switch (style) {
      case 'galactic':
        this.drawGalacticTexture(ctx, canvas.width, canvas.height);
        break;
      case 'metal':
        this.drawMetalTexture(ctx, canvas.width, canvas.height);
        break;
      case 'hex':
        this.drawHexTexture(ctx, canvas.width, canvas.height);
        break;
      case 'circuit':
        this.drawCircuitTexture(ctx, canvas.width, canvas.height);
        break;
      default:
        this.drawConcreteTexture(ctx, canvas.width, canvas.height);
    }

    return new THREE.CanvasTexture(canvas);
  }

  private drawConcreteTexture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Base color
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(0, 0, w, h);

    // Add noise/grain
    for (let i = 0; i < 5000; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const brightness = 60 + Math.random() * 40;
      ctx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.3)`;
      ctx.fillRect(x, y, 2, 2);
    }

    // Add cracks
    ctx.strokeStyle = 'rgba(30, 30, 30, 0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      let x = Math.random() * w;
      let y = Math.random() * h;
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += (Math.random() - 0.5) * 100;
        y += (Math.random() - 0.5) * 100;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private drawGalacticTexture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Deep space background
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 1.5);
    gradient.addColorStop(0, '#1a0a30');
    gradient.addColorStop(0.5, '#0d0520');
    gradient.addColorStop(1, '#050210');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Nebula clouds
    for (let i = 0; i < 3; i++) {
      const cx = Math.random() * w;
      const cy = Math.random() * h;
      const radius = 100 + Math.random() * 150;
      const colors = ['#ff00ff', '#00ffff', '#ff6600', '#6600ff', '#00ff66'];
      const color = colors[Math.floor(Math.random() * colors.length)];

      const nebula = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      nebula.addColorStop(0, color.replace('ff', '66') + '40');
      nebula.addColorStop(0.5, color + '20');
      nebula.addColorStop(1, 'transparent');
      ctx.fillStyle = nebula;
      ctx.fillRect(0, 0, w, h);
    }

    // Stars
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const size = Math.random() * 2;
      const brightness = 150 + Math.random() * 105;

      // Star glow
      if (Math.random() > 0.8) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 4);
        glow.addColorStop(0, `rgba(${brightness}, ${brightness}, 255, 0.8)`);
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(x - size * 4, y - size * 4, size * 8, size * 8);
      }

      ctx.fillStyle = `rgba(${brightness}, ${brightness}, 255, 1)`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Galaxy spiral hints
    ctx.strokeStyle = 'rgba(100, 50, 150, 0.15)';
    ctx.lineWidth = 20;
    ctx.beginPath();
    for (let angle = 0; angle < Math.PI * 4; angle += 0.1) {
      const r = 20 + angle * 30;
      const x = w / 2 + Math.cos(angle) * r;
      const y = h / 2 + Math.sin(angle) * r;
      if (angle === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private drawMetalTexture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Base metal
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(0, 0, w, h);

    // Brushed metal effect
    for (let i = 0; i < 200; i++) {
      const y = Math.random() * h;
      const brightness = 50 + Math.random() * 30;
      ctx.strokeStyle = `rgba(${brightness + 20}, ${brightness + 20}, ${brightness + 30}, 0.3)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (Math.random() - 0.5) * 4);
      ctx.stroke();
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(20, 20, 25, 0.8)';
    ctx.lineWidth = 3;
    const gridSize = w / 4;

    for (let x = 0; x <= w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    for (let y = 0; y <= h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Rivets/bolts at intersections
    ctx.fillStyle = '#555566';
    for (let x = 0; x <= w; x += gridSize) {
      for (let y = 0; y <= h; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();

        // Highlight
        ctx.fillStyle = '#666677';
        ctx.beginPath();
        ctx.arc(x - 2, y - 2, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#555566';
      }
    }
  }

  private drawHexTexture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Dark base
    ctx.fillStyle = '#1a2530';
    ctx.fillRect(0, 0, w, h);

    const hexRadius = 30;
    const hexHeight = hexRadius * Math.sqrt(3);

    // Draw hexagon grid
    for (let row = -1; row < h / hexHeight + 1; row++) {
      for (let col = -1; col < w / (hexRadius * 1.5) + 1; col++) {
        const x = col * hexRadius * 1.5;
        const y = row * hexHeight + (col % 2 === 0 ? 0 : hexHeight / 2);

        // Hex fill with slight variation
        const brightness = 30 + Math.random() * 20;
        ctx.fillStyle = `rgb(${brightness}, ${brightness + 20}, ${brightness + 40})`;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i + Math.PI / 6;
          const hx = x + Math.cos(angle) * (hexRadius - 2);
          const hy = y + Math.sin(angle) * (hexRadius - 2);
          if (i === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.fill();

        // Hex border (glowing edge)
        ctx.strokeStyle = 'rgba(80, 150, 200, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner glow for some hexes
        if (Math.random() > 0.85) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, hexRadius);
          glow.addColorStop(0, 'rgba(100, 200, 255, 0.3)');
          glow.addColorStop(1, 'transparent');
          ctx.fillStyle = glow;
          ctx.fill();
        }
      }
    }
  }

  private drawCircuitTexture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // PCB green background
    ctx.fillStyle = '#0a1a0f';
    ctx.fillRect(0, 0, w, h);

    // Circuit traces
    ctx.strokeStyle = '#00ff66';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00ff66';
    ctx.shadowBlur = 4;

    // Horizontal traces
    for (let y = 20; y < h; y += 40) {
      ctx.beginPath();
      let x = 0;
      ctx.moveTo(x, y);
      while (x < w) {
        const segLength = 20 + Math.random() * 60;
        x += segLength;
        ctx.lineTo(x, y);

        // Random vertical jog
        if (Math.random() > 0.7 && x < w - 40) {
          const jogY = y + (Math.random() > 0.5 ? 20 : -20);
          ctx.lineTo(x, jogY);
          ctx.lineTo(x + 20, jogY);
          x += 20;
        }
      }
      ctx.stroke();
    }

    // Vertical traces
    for (let x = 20; x < w; x += 40) {
      if (Math.random() > 0.5) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        let y = 0;
        while (y < h) {
          const segLength = 20 + Math.random() * 60;
          y += segLength;
          ctx.lineTo(x, y);

          if (Math.random() > 0.7 && y < h - 40) {
            const jogX = x + (Math.random() > 0.5 ? 20 : -20);
            ctx.lineTo(jogX, y);
            ctx.lineTo(jogX, y + 20);
            y += 20;
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
    }

    ctx.shadowBlur = 0;

    // IC chips
    ctx.fillStyle = '#111';
    for (let i = 0; i < 6; i++) {
      const cx = 50 + Math.random() * (w - 100);
      const cy = 50 + Math.random() * (h - 100);
      const chipW = 30 + Math.random() * 40;
      const chipH = 20 + Math.random() * 30;

      ctx.fillRect(cx - chipW / 2, cy - chipH / 2, chipW, chipH);

      // Chip pins
      ctx.fillStyle = '#888';
      for (let p = 0; p < chipW; p += 8) {
        ctx.fillRect(cx - chipW / 2 + p, cy - chipH / 2 - 4, 4, 4);
        ctx.fillRect(cx - chipW / 2 + p, cy + chipH / 2, 4, 4);
      }
      ctx.fillStyle = '#111';
    }

    // Solder pads
    ctx.fillStyle = '#997700';
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Get the time configuration based on current hour.
   */
  private getTimeConfig(): TimeConfig {
    const hour = this.getCurrentHour();

    // Define time phases
    // Night: 21:00 - 5:00
    // Dawn: 5:00 - 7:00
    // Day: 7:00 - 18:00
    // Dusk: 18:00 - 21:00

    if (hour >= 5 && hour < 6) {
      // Early dawn - night to sunrise peak
      const t = hour - 5; // 0 to 1
      return this.interpolateConfig(this.getNightConfig(), this.getDawnConfig(), t, 'dawn');
    } else if (hour >= 6 && hour < 7) {
      // Late dawn - sunrise peak to day
      const t = hour - 6; // 0 to 1
      return this.interpolateConfig(this.getDawnConfig(), this.getDayConfig(), t, 'dawn');
    } else if (hour >= 7 && hour < 18) {
      // Day
      return this.getDayConfig();
    } else if (hour >= 18 && hour < 19.5) {
      // Early dusk - day to sunset peak
      const t = (hour - 18) / 1.5; // 0 to 1
      return this.interpolateConfig(this.getDayConfig(), this.getDuskConfig(), t, 'dusk');
    } else if (hour >= 19.5 && hour < 21) {
      // Late dusk - sunset peak to night
      const t = (hour - 19.5) / 1.5; // 0 to 1
      return this.interpolateConfig(this.getDuskConfig(), this.getNightConfig(), t, 'dusk');
    } else {
      // Night (21:00 - 5:00)
      return this.getNightConfig();
    }
  }

  private getDawnConfig(): TimeConfig {
    return {
      phase: 'dawn',
      sunPosition: new THREE.Vector3(50, 10, -60), // Sun low on horizon
      moonPosition: new THREE.Vector3(-40, 15, -50), // Moon setting
      ambientColor: 0xffaa77, // Warm orange ambient
      ambientIntensity: 0.5,
      hemiSkyColor: 0xff8844, // Orange sky from above
      hemiGroundColor: 0x553322, // Warm ground reflection
      hemiIntensity: 0.6,
      mainLightColor: 0xffcc66, // Golden sunlight
      mainLightIntensity: 0.9,
      fogColor: 0xffbb88, // Orange/peach fog
      fogDensity: 0.008,
      skyColor: 0xff9966, // Orange/coral sky
      starsOpacity: 0.2, // Few stars still visible
      moonOpacity: 0.3, // Moon fading
      sunOpacity: 0.9, // Sun rising
      lampIntensity: 0.3, // Lamps dimming
      windowEmissive: 0.3,
    };
  }

  private getDuskConfig(): TimeConfig {
    return {
      phase: 'dusk',
      sunPosition: new THREE.Vector3(-50, 8, -60), // Sun setting on opposite side
      moonPosition: new THREE.Vector3(40, 12, -50), // Moon rising
      ambientColor: 0xff7755, // Warm red-orange ambient
      ambientIntensity: 0.45,
      hemiSkyColor: 0xff6633, // Deep orange sky
      hemiGroundColor: 0x442222, // Dark warm ground
      hemiIntensity: 0.5,
      mainLightColor: 0xff9944, // Deep golden sunlight
      mainLightIntensity: 0.7,
      fogColor: 0xdd7766, // Red-orange fog
      fogDensity: 0.01,
      skyColor: 0xff7744, // Deep orange sky
      starsOpacity: 0.3, // Stars appearing
      moonOpacity: 0.4, // Moon appearing
      sunOpacity: 0.8, // Sun setting
      lampIntensity: 1.0, // Lamps turning on
      windowEmissive: 0.5,
    };
  }

  private getNightConfig(): TimeConfig {
    return {
      phase: 'night',
      sunPosition: new THREE.Vector3(30, -20, -50),
      moonPosition: new THREE.Vector3(-30, 35, -50),
      ambientColor: 0x334466,
      ambientIntensity: 0.3,
      hemiSkyColor: 0x223344,
      hemiGroundColor: 0x111122,
      hemiIntensity: 0.4,
      mainLightColor: 0xaabbff,
      mainLightIntensity: 0.6,
      fogColor: 0x101020,
      fogDensity: 0.012,
      skyColor: 0x080810,
      starsOpacity: 0.9,
      moonOpacity: 1.0,
      sunOpacity: 0,
      lampIntensity: 2.0,
      windowEmissive: 0.8,
    };
  }

  private getDayConfig(): TimeConfig {
    return {
      phase: 'day',
      sunPosition: new THREE.Vector3(30, 50, -30),
      moonPosition: new THREE.Vector3(-30, -20, -50),
      ambientColor: 0xffffff,
      ambientIntensity: 0.7,
      hemiSkyColor: 0x87ceeb,
      hemiGroundColor: 0x555544,
      hemiIntensity: 0.8,
      mainLightColor: 0xffffee,
      mainLightIntensity: 1.2,
      fogColor: 0xc8d8e8,
      fogDensity: 0.005,
      skyColor: 0x87ceeb,
      starsOpacity: 0,
      moonOpacity: 0,
      sunOpacity: 1.0,
      lampIntensity: 0,
      windowEmissive: 0.1,
    };
  }

  private interpolateConfig(from: TimeConfig, to: TimeConfig, t: number, phase: TimePhase): TimeConfig {
    const lerp = (a: number, b: number) => a + (b - a) * t;
    const lerpColor = (a: number, b: number) => {
      const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
      const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
      const r = Math.round(lerp(ar, br));
      const g = Math.round(lerp(ag, bg));
      const blue = Math.round(lerp(ab, bb));
      return (r << 16) | (g << 8) | blue;
    };

    return {
      phase,
      sunPosition: new THREE.Vector3().lerpVectors(from.sunPosition, to.sunPosition, t),
      moonPosition: new THREE.Vector3().lerpVectors(from.moonPosition, to.moonPosition, t),
      ambientColor: lerpColor(from.ambientColor, to.ambientColor),
      ambientIntensity: lerp(from.ambientIntensity, to.ambientIntensity),
      hemiSkyColor: lerpColor(from.hemiSkyColor, to.hemiSkyColor),
      hemiGroundColor: lerpColor(from.hemiGroundColor, to.hemiGroundColor),
      hemiIntensity: lerp(from.hemiIntensity, to.hemiIntensity),
      mainLightColor: lerpColor(from.mainLightColor, to.mainLightColor),
      mainLightIntensity: lerp(from.mainLightIntensity, to.mainLightIntensity),
      fogColor: lerpColor(from.fogColor, to.fogColor),
      fogDensity: lerp(from.fogDensity, to.fogDensity),
      skyColor: lerpColor(from.skyColor, to.skyColor),
      starsOpacity: lerp(from.starsOpacity, to.starsOpacity),
      moonOpacity: lerp(from.moonOpacity, to.moonOpacity),
      sunOpacity: lerp(from.sunOpacity, to.sunOpacity),
      lampIntensity: lerp(from.lampIntensity, to.lampIntensity),
      windowEmissive: lerp(from.windowEmissive, to.windowEmissive),
    };
  }

  private applyTimeConfig(config: TimeConfig): void {
    // Update sky/fog
    this.scene.background = new THREE.Color(config.skyColor);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(config.fogColor);
      // Apply fog density with user's fog multiplier
      const fogMultiplier = this.baseFogDensity > 0 ? this.baseFogDensity / 0.008 : 0;
      this.scene.fog.density = config.fogDensity * fogMultiplier;
    }

    // Update sun
    if (this.sun) {
      this.sun.position.copy(config.sunPosition);
      this.sun.material.opacity = config.sunOpacity;
      this.sun.visible = config.sunOpacity > 0.01;
    }

    // Update moon
    if (this.moon) {
      this.moon.position.copy(config.moonPosition);
      this.moon.material.opacity = config.moonOpacity;
      this.moon.visible = config.moonOpacity > 0.01;
    }

    // Update stars
    if (this.stars) {
      (this.stars.material as THREE.PointsMaterial).opacity = config.starsOpacity;
      this.stars.visible = config.starsOpacity > 0.01;
    }

    // Update ambient light
    if (this.ambientLight) {
      this.ambientLight.color.setHex(config.ambientColor);
      this.ambientLight.intensity = config.ambientIntensity;
    }

    // Update hemisphere light
    if (this.hemiLight) {
      this.hemiLight.color.setHex(config.hemiSkyColor);
      this.hemiLight.groundColor.setHex(config.hemiGroundColor);
      this.hemiLight.intensity = config.hemiIntensity;
    }

    // Update main light (sun/moon light)
    if (this.mainLight) {
      this.mainLight.color.setHex(config.mainLightColor);
      this.mainLight.intensity = config.mainLightIntensity;
      // Position main light based on which celestial body is visible
      if (config.sunOpacity > config.moonOpacity) {
        this.mainLight.position.copy(config.sunPosition);
      } else {
        this.mainLight.position.copy(config.moonPosition);
      }
    }

    // Update street lamp lights
    this.lampLights.forEach(light => {
      light.intensity = config.lampIntensity;
    });

    // Update window emissive
    this.windowMaterials.forEach(mat => {
      mat.emissiveIntensity = config.windowEmissive;
    });
  }

  /**
   * Get the ground mesh for raycasting.
   */
  getGround(): THREE.Mesh | null {
    return this.ground;
  }

  private createGround(): void {
    const geometry = new THREE.PlaneGeometry(30, 30);

    // Generate programmatic texture
    const floorTexture = this.generateFloorTexture(this.currentFloorStyle);
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(this.currentFloorStyle === 'galactic' ? 1 : 6, this.currentFloorStyle === 'galactic' ? 1 : 6);

    const material = new THREE.MeshStandardMaterial({
      map: floorTexture,
      color: 0x555555,
      roughness: 0.8,
      metalness: 0.1,
    });

    this.ground = new THREE.Mesh(geometry, material);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';

    this.scene.add(this.ground);
  }

  private createGrid(): void {
    this.gridHelper = new THREE.GridHelper(30, 30, 0x2a2a3a, 0x1a1a2a);
    this.gridHelper.position.y = 0.01;
    this.scene.add(this.gridHelper);
  }

  private createLogo(): void {
    const textureLoader = new THREE.TextureLoader();
    const logoTexture = textureLoader.load('/assets/textures/logo-blanco.png');

    // Use aspect ratio close to the actual logo (it's wider than tall)
    const logoWidth = 10;
    const logoHeight = 4;

    const geometry = new THREE.PlaneGeometry(logoWidth, logoHeight);
    const material = new THREE.MeshBasicMaterial({
      map: logoTexture,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const logo = new THREE.Mesh(geometry, material);
    logo.rotation.x = -Math.PI / 2;
    logo.position.set(0, 0.02, 0);
    logo.name = 'tideLogo';

    this.scene.add(logo);
  }

  private createGrass(): void {
    // Create grass area around the work floor
    const grassGeometry = new THREE.PlaneGeometry(80, 80);
    const grassMaterial = new THREE.MeshStandardMaterial({
      color: 0x2d5a27,
      roughness: 0.9,
      metalness: 0,
    });

    this.grass = new THREE.Mesh(grassGeometry, grassMaterial);
    this.grass.rotation.x = -Math.PI / 2;
    this.grass.position.y = -0.05;
    this.grass.receiveShadow = true;
    this.grass.name = 'grass';

    this.scene.add(this.grass);
  }

  private createTrees(): void {
    const treePositions = [
      { x: -20, z: -18 },
      { x: -22, z: -8 },
      { x: -20, z: 5 },
      { x: -18, z: 18 },
      { x: 18, z: -20 },
      { x: 22, z: -5 },
      { x: 20, z: 10 },
      { x: 18, z: 22 },
      { x: -8, z: -22 },
      { x: 5, z: -20 },
      { x: -5, z: 22 },
      { x: 10, z: 20 },
    ];

    treePositions.forEach((pos, i) => {
      const tree = this.createTree(1 + Math.random() * 0.5);
      tree.position.set(pos.x, 0, pos.z);
      tree.rotation.y = Math.random() * Math.PI * 2;
      tree.name = `tree_${i}`;
      this.trees.push(tree);
      this.scene.add(tree);
    });
  }

  private createTree(scale: number): THREE.Group {
    const tree = new THREE.Group();

    // Trunk
    const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 3, 8);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a3728,
      roughness: 0.9,
    });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = 1.5;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);

    // Foliage layers (cute round style)
    const foliageMaterial = new THREE.MeshStandardMaterial({
      color: 0x2d5a27,
      roughness: 0.8,
    });

    // Bottom layer
    const foliage1 = new THREE.Mesh(
      new THREE.SphereGeometry(2, 8, 6),
      foliageMaterial
    );
    foliage1.position.y = 4;
    foliage1.scale.y = 0.8;
    foliage1.castShadow = true;
    tree.add(foliage1);

    // Top layer
    const foliage2 = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 8, 6),
      foliageMaterial
    );
    foliage2.position.y = 5.5;
    foliage2.castShadow = true;
    tree.add(foliage2);

    tree.scale.setScalar(scale);
    return tree;
  }

  private createBushes(): void {
    const bushPositions = [
      { x: -17, z: -14 },
      { x: -16, z: 0 },
      { x: -17, z: 12 },
      { x: 17, z: -15 },
      { x: 16, z: 3 },
      { x: 17, z: 15 },
      { x: -12, z: -17 },
      { x: 0, z: -17 },
      { x: 12, z: -17 },
      { x: -10, z: 17 },
      { x: 3, z: 17 },
      { x: 14, z: 17 },
      // Near house
      { x: -25, z: 8 },
      { x: -28, z: 12 },
    ];

    const bushMaterial = new THREE.MeshStandardMaterial({
      color: 0x3d6a37,
      roughness: 0.85,
    });

    bushPositions.forEach((pos, i) => {
      const bushGroup = new THREE.Group();

      // Create 2-3 spheres for each bush
      const numSpheres = 2 + Math.floor(Math.random() * 2);
      for (let j = 0; j < numSpheres; j++) {
        const size = 0.6 + Math.random() * 0.4;
        const bushGeometry = new THREE.SphereGeometry(size, 8, 6);
        const bush = new THREE.Mesh(bushGeometry, bushMaterial);
        bush.position.set(
          (Math.random() - 0.5) * 0.8,
          size * 0.7,
          (Math.random() - 0.5) * 0.8
        );
        bush.scale.y = 0.7 + Math.random() * 0.2;
        bush.castShadow = true;
        bush.receiveShadow = true;
        bushGroup.add(bush);
      }

      bushGroup.position.set(pos.x, 0, pos.z);
      bushGroup.name = `bush_${i}`;
      this.bushes.push(bushGroup);
      this.scene.add(bushGroup);
    });
  }

  private createHouse(): void {
    const house = new THREE.Group();

    // Main body
    const bodyGeometry = new THREE.BoxGeometry(6, 4, 5);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xd4a574,
      roughness: 0.8,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 2;
    body.castShadow = true;
    body.receiveShadow = true;
    house.add(body);

    // Roof
    const roofGeometry = new THREE.ConeGeometry(5, 3, 4);
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.7,
    });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = 5.5;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    house.add(roof);

    // Door
    const doorGeometry = new THREE.BoxGeometry(1.2, 2, 0.1);
    const doorMaterial = new THREE.MeshStandardMaterial({
      color: 0x5c4033,
      roughness: 0.6,
    });
    const door = new THREE.Mesh(doorGeometry, doorMaterial);
    door.position.set(0, 1, 2.55);
    house.add(door);

    // Windows (emissive at night)
    const windowGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.1);
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffaa,
      emissive: 0xffaa44,
      emissiveIntensity: 0.5,
      roughness: 0.3,
    });
    this.windowMaterials.push(windowMaterial);

    const window1 = new THREE.Mesh(windowGeometry, windowMaterial);
    window1.position.set(-1.5, 2.5, 2.55);
    house.add(window1);

    const window2 = new THREE.Mesh(windowGeometry, windowMaterial);
    window2.position.set(1.5, 2.5, 2.55);
    house.add(window2);

    // Chimney
    const chimneyGeometry = new THREE.BoxGeometry(0.8, 2, 0.8);
    const chimneyMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.8,
    });
    const chimney = new THREE.Mesh(chimneyGeometry, chimneyMaterial);
    chimney.position.set(1.5, 6, -1);
    chimney.castShadow = true;
    house.add(chimney);

    // Position house outside work floor
    house.position.set(-25, 0, 10);
    house.rotation.y = Math.PI / 6;
    house.name = 'house';

    this.house = house;
    this.scene.add(house);
  }

  private createStreetLamps(): void {
    const lampPositions = [
      { x: -16, z: -16 },
      { x: 16, z: -16 },
      { x: -16, z: 16 },
      { x: 16, z: 16 },
    ];

    lampPositions.forEach((pos, i) => {
      const lamp = this.createStreetLamp();
      lamp.position.set(pos.x, 0, pos.z);
      lamp.name = `streetLamp_${i}`;
      this.lamps.push(lamp);
      this.scene.add(lamp);

      // Add point light for each lamp (intensity controlled by time)
      const light = new THREE.PointLight(0xffaa55, 1.5, 15);
      light.position.set(pos.x, 5, pos.z);
      light.castShadow = true;
      light.shadow.mapSize.width = 512;
      light.shadow.mapSize.height = 512;
      this.lampLights.push(light);
      this.scene.add(light);
    });
  }

  private createStreetLamp(): THREE.Group {
    const lamp = new THREE.Group();

    // Pole
    const poleGeometry = new THREE.CylinderGeometry(0.1, 0.15, 5, 8);
    const poleMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.5,
      metalness: 0.5,
    });
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.y = 2.5;
    pole.castShadow = true;
    lamp.add(pole);

    // Arm
    const armGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
    const arm = new THREE.Mesh(armGeometry, poleMaterial);
    arm.position.set(0.4, 4.8, 0);
    arm.rotation.z = Math.PI / 2;
    lamp.add(arm);

    // Lamp housing
    const housingGeometry = new THREE.CylinderGeometry(0.4, 0.3, 0.6, 8);
    const housingMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.4,
      metalness: 0.6,
    });
    const housing = new THREE.Mesh(housingGeometry, housingMaterial);
    housing.position.set(0.8, 4.8, 0);
    lamp.add(housing);

    // Light bulb (glowing)
    const bulbGeometry = new THREE.SphereGeometry(0.25, 16, 16);
    const bulbMaterial = new THREE.MeshStandardMaterial({
      color: 0xffeeaa,
      emissive: 0xffaa44,
      emissiveIntensity: 2,
      roughness: 0.2,
    });
    const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
    bulb.position.set(0.8, 4.5, 0);
    lamp.add(bulb);

    return lamp;
  }

  private createFog(): void {
    // Fog will be configured by time of day
    this.scene.fog = new THREE.FogExp2(0x101020, 0.01);
    this.scene.background = new THREE.Color(0x101020);
  }

  private createSun(): void {
    // Create sun sprite
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 512;
    canvas.height = 512;

    const centerX = 256;
    const centerY = 256;

    // Outer glow - warm yellow/white
    const outerGlow = ctx.createRadialGradient(centerX, centerY, 50, centerX, centerY, 256);
    outerGlow.addColorStop(0, 'rgba(255, 255, 200, 1)');
    outerGlow.addColorStop(0.2, 'rgba(255, 240, 150, 0.8)');
    outerGlow.addColorStop(0.4, 'rgba(255, 220, 100, 0.4)');
    outerGlow.addColorStop(0.7, 'rgba(255, 200, 80, 0.1)');
    outerGlow.addColorStop(1, 'rgba(255, 180, 50, 0)');

    ctx.fillStyle = outerGlow;
    ctx.fillRect(0, 0, 512, 512);

    // Inner bright core
    const innerGlow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 80);
    innerGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    innerGlow.addColorStop(0.5, 'rgba(255, 255, 220, 1)');
    innerGlow.addColorStop(1, 'rgba(255, 240, 150, 0.8)');

    ctx.fillStyle = innerGlow;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 80, 0, Math.PI * 2);
    ctx.fill();

    // Sun surface - bright white/yellow
    ctx.beginPath();
    ctx.arc(centerX, centerY, 60, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffee';
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.sun = new THREE.Sprite(material);
    this.sun.position.set(30, 50, -30);
    this.sun.scale.set(50, 50, 1);
    this.sun.name = 'sun';
    this.sun.visible = false; // Will be controlled by time

    this.scene.add(this.sun);
  }

  private createMoon(): void {
    // Create moon sprite - larger canvas for more detail
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 512;
    canvas.height = 512;

    const centerX = 256;
    const centerY = 256;

    // Outer glow - silver/blue
    const outerGlow = ctx.createRadialGradient(centerX, centerY, 60, centerX, centerY, 256);
    outerGlow.addColorStop(0, 'rgba(200, 220, 255, 1)');
    outerGlow.addColorStop(0.2, 'rgba(180, 200, 240, 0.8)');
    outerGlow.addColorStop(0.4, 'rgba(150, 180, 220, 0.5)');
    outerGlow.addColorStop(0.7, 'rgba(120, 150, 200, 0.2)');
    outerGlow.addColorStop(1, 'rgba(100, 130, 180, 0)');

    ctx.fillStyle = outerGlow;
    ctx.fillRect(0, 0, 512, 512);

    // Inner bright glow
    const innerGlow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 100);
    innerGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    innerGlow.addColorStop(0.5, 'rgba(230, 240, 255, 0.9)');
    innerGlow.addColorStop(1, 'rgba(200, 220, 255, 0.3)');

    ctx.fillStyle = innerGlow;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 100, 0, Math.PI * 2);
    ctx.fill();

    // Moon surface - pale silver
    ctx.beginPath();
    ctx.arc(centerX, centerY, 70, 0, Math.PI * 2);
    ctx.fillStyle = '#e8eeff';
    ctx.fill();

    // Subtle crater details
    ctx.fillStyle = 'rgba(180, 190, 210, 0.6)';
    ctx.beginPath();
    ctx.arc(centerX - 25, centerY - 20, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(centerX + 25, centerY + 15, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(centerX - 5, centerY + 30, 10, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.moon = new THREE.Sprite(material);
    this.moon.position.set(-30, 35, -50);
    this.moon.scale.set(40, 40, 1);
    this.moon.name = 'moon';

    this.scene.add(this.moon);
  }

  private createStars(): void {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 300;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      // Spread stars in a dome around the scene
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5; // Upper hemisphere only
      const radius = 80 + Math.random() * 40;

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi) + 20; // Offset up
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      transparent: true,
      opacity: 0.8,
    });

    this.stars = new THREE.Points(starGeometry, starMaterial);
    this.stars.name = 'stars';
    this.scene.add(this.stars);
  }

  private createLighting(): void {
    // Ambient light
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambientLight);

    // Hemisphere light
    this.hemiLight = new THREE.HemisphereLight(0xffffcc, 0x444466, 0.6);
    this.hemiLight.position.set(0, 20, 0);
    this.scene.add(this.hemiLight);

    // Main directional light (sun/moon)
    this.mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.mainLight.position.set(30, 50, -30);
    this.mainLight.castShadow = true;
    this.mainLight.shadow.mapSize.width = 2048;
    this.mainLight.shadow.mapSize.height = 2048;
    this.mainLight.shadow.camera.near = 0.5;
    this.mainLight.shadow.camera.far = 150;
    this.mainLight.shadow.camera.left = -35;
    this.mainLight.shadow.camera.right = 35;
    this.mainLight.shadow.camera.top = 35;
    this.mainLight.shadow.camera.bottom = -35;
    this.scene.add(this.mainLight);

    // Fill light
    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    this.fillLight.position.set(-10, 15, 10);
    this.scene.add(this.fillLight);
  }
}
