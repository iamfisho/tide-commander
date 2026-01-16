import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Agent, DrawingArea } from '../../shared/types';
import { store } from '../store';
import { saveCameraState, loadCameraState } from '../utils/camera';
import { CAMERA_SAVE_INTERVAL } from './config';

// Import modules
import { CharacterLoader, CharacterFactory, type AgentMeshData } from './characters';
import { MovementAnimator, EffectsManager, ANIMATIONS } from './animation';
import { Battlefield } from './environment';
import { InputHandler } from './input';
import { DrawingManager } from './drawing';

/**
 * Main scene orchestrator that coordinates all subsystems.
 */
export class SceneManager {
  // Core Three.js
  private canvas: HTMLCanvasElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;

  // Modules
  private characterLoader: CharacterLoader;
  private characterFactory: CharacterFactory;
  private movementAnimator: MovementAnimator;
  private effectsManager: EffectsManager;
  private battlefield: Battlefield;
  private inputHandler: InputHandler;
  private drawingManager: DrawingManager;

  // State
  private agentMeshes = new Map<string, AgentMeshData>();
  private lastCameraSave = 0;
  private lastTimeUpdate = 0;
  private lastFrameTime = 0;
  private lastIdleTimerUpdate = 0;
  private characterScale = 0.5;
  private indicatorScale = 1.0;

  constructor(canvas: HTMLCanvasElement, selectionBox: HTMLDivElement) {
    this.canvas = canvas;

    // Initialize Three.js core
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a12);

    this.camera = this.createCamera();
    this.renderer = this.createRenderer();
    this.controls = this.createControls();

    // Initialize modules
    this.characterLoader = new CharacterLoader();
    this.characterFactory = new CharacterFactory(this.characterLoader);
    this.movementAnimator = new MovementAnimator();
    this.effectsManager = new EffectsManager(this.scene);
    this.battlefield = new Battlefield(this.scene);
    this.drawingManager = new DrawingManager(this.scene);

    this.inputHandler = new InputHandler(
      canvas,
      this.camera,
      this.controls,
      selectionBox,
      {
        onAgentClick: this.handleAgentClick.bind(this),
        onAgentDoubleClick: this.handleAgentDoubleClick.bind(this),
        onGroundClick: this.handleGroundClick.bind(this),
        onMoveCommand: this.handleMoveCommand.bind(this),
        onSelectionBox: this.handleSelectionBox.bind(this),
        onDrawStart: this.handleDrawStart.bind(this),
        onDrawMove: this.handleDrawMove.bind(this),
        onDrawEnd: this.handleDrawEnd.bind(this),
        onAreaRightClick: this.handleAreaRightClick.bind(this),
        onResizeStart: this.handleResizeStart.bind(this),
        onResizeMove: this.handleResizeMove.bind(this),
        onResizeEnd: this.handleResizeEnd.bind(this),
      }
    );

    // Set up drawing mode checker
    this.inputHandler.setDrawingModeChecker(() => this.drawingManager.isInDrawingMode());

    // Set up resize handlers
    this.inputHandler.setResizeHandlers(
      () => this.drawingManager.getResizeHandles(),
      () => this.drawingManager.isCurrentlyResizing()
    );

    // Create environment
    this.battlefield.create();

    // Event listeners
    window.addEventListener('resize', this.onWindowResize);

    // Start render loop
    this.animate();
  }

  // ============================================
  // Initialization
  // ============================================

  private createCamera(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(
      60,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1,
      1000
    );

    const savedCamera = loadCameraState();
    if (savedCamera) {
      camera.position.set(savedCamera.position.x, savedCamera.position.y, savedCamera.position.z);
      camera.lookAt(savedCamera.target.x, savedCamera.target.y, savedCamera.target.z);
    } else {
      camera.position.set(0, 15, 15);
      camera.lookAt(0, 0, 0);
    }

    return camera;
  }

  private createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    return renderer;
  }

  private createControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 50;
    controls.maxPolarAngle = Math.PI / 2.2;

    const savedCamera = loadCameraState();
    if (savedCamera) {
      controls.target.set(savedCamera.target.x, savedCamera.target.y, savedCamera.target.z);
    }

    controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: null as unknown as THREE.MOUSE,
    };
    controls.enablePan = true;
    controls.screenSpacePanning = true;

    return controls;
  }

  // ============================================
  // Public API - Character Models
  // ============================================

  async loadCharacterModels(): Promise<void> {
    await this.characterLoader.loadAll();
  }

  upgradeAgentModels(): void {
    if (!this.characterLoader.isLoaded) return;

    const state = store.getState();
    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (!agent) continue;

      // Check if using fallback capsule
      const body = meshData.group.getObjectByName('characterBody');
      if (body instanceof THREE.Mesh && body.geometry instanceof THREE.CapsuleGeometry) {
        // Preserve current mesh position (might be mid-animation)
        const currentPosition = meshData.group.position.clone();

        // Create new mesh data with proper model
        const newMeshData = this.characterFactory.createAgentMesh(agent);

        // Use current mesh position, not stored agent position (handles animation)
        newMeshData.group.position.copy(currentPosition);

        // Apply current character scale
        const newBody = newMeshData.group.getObjectByName('characterBody');
        if (newBody) {
          newBody.scale.setScalar(this.characterScale);
        }

        // Replace in scene
        this.scene.remove(meshData.group);
        this.scene.add(newMeshData.group);
        this.agentMeshes.set(agentId, newMeshData);

        // Start status-based animation (sit if idle)
        this.updateStatusAnimation(agent, newMeshData);

        console.log(`[SceneManager] Upgraded ${agent.name} to character model`);
      }
    }

    // Update input handler references
    this.inputHandler.setReferences(this.battlefield.getGround(), this.agentMeshes);
  }

  // ============================================
  // Public API - Agent Management
  // ============================================

  addAgent(agent: Agent): void {
    // Remove existing mesh if present (prevent duplicates)
    const existing = this.agentMeshes.get(agent.id);
    if (existing) {
      this.scene.remove(existing.group);
      this.agentMeshes.delete(agent.id);
    }

    const meshData = this.characterFactory.createAgentMesh(agent);
    this.scene.add(meshData.group);
    this.agentMeshes.set(agent.id, meshData);

    // Apply current character scale
    const body = meshData.group.getObjectByName('characterBody');
    if (body) {
      body.scale.setScalar(this.characterScale);
    }

    // Set animation based on agent's current status
    this.updateStatusAnimation(agent, meshData);

    // Update input handler references
    this.inputHandler.setReferences(this.battlefield.getGround(), this.agentMeshes);
  }

  removeAgent(agentId: string): void {
    const meshData = this.agentMeshes.get(agentId);
    if (meshData) {
      this.scene.remove(meshData.group);
      this.agentMeshes.delete(agentId);
    }

    // Clean up all visual effects for this agent (zzz bubble, speech bubbles, etc.)
    this.effectsManager.removeAgentEffects(agentId);

    this.inputHandler.setReferences(this.battlefield.getGround(), this.agentMeshes);
  }

  updateAgent(agent: Agent, animatePosition = false): void {
    const meshData = this.agentMeshes.get(agent.id);
    if (!meshData) return;

    const state = store.getState();
    const isSelected = state.selectedAgentIds.has(agent.id);

    if (animatePosition) {
      const currentPos = meshData.group.position;
      const posChanged =
        Math.abs(currentPos.x - agent.position.x) > 0.01 ||
        Math.abs(currentPos.z - agent.position.z) > 0.01;

      if (posChanged) {
        this.movementAnimator.startMovement(agent.id, meshData, agent.position);
      }
    } else if (!this.movementAnimator.isMoving(agent.id)) {
      meshData.group.position.set(agent.position.x, agent.position.y, agent.position.z);
    }

    // Always update animation based on status
    if (!this.movementAnimator.isMoving(agent.id)) {
      this.updateStatusAnimation(agent, meshData);
    }

    // Update visuals
    this.characterFactory.updateVisuals(meshData.group, agent, isSelected);
  }

  /**
   * Update agent animation based on status
   */
  private updateStatusAnimation(agent: Agent, meshData: AgentMeshData): void {
    // Map status to animation
    const statusAnimations: Record<string, string> = {
      idle: ANIMATIONS.SIT,       // Sitting/resting when idle
      working: ANIMATIONS.WALK,   // Active movement when working
      waiting: ANIMATIONS.IDLE,   // Standing when waiting
      error: ANIMATIONS.EMOTE_NO, // Error shake
      offline: ANIMATIONS.STATIC, // Static when offline
    };

    const animation = statusAnimations[agent.status] || ANIMATIONS.IDLE;
    const currentClipName = meshData.currentAction?.getClip()?.name?.toLowerCase();

    console.log(`[SceneManager] Agent ${agent.name} status=${agent.status}, animation=${animation}, current=${currentClipName}, hasAnimations=${meshData.animations.size}`);
    console.log(`[SceneManager] Available animations:`, Array.from(meshData.animations.keys()));

    // Always play animation if status is idle (to ensure sit), or if animation changed
    const shouldPlay = agent.status === 'idle' || currentClipName !== animation;

    if (shouldPlay) {
      const options = agent.status === 'working'
        ? { timeScale: 1.5 }
        : agent.status === 'error'
          ? { loop: false }
          : {};
      console.log(`[SceneManager] Playing animation: ${animation}`);
      this.movementAnimator.playAnimation(meshData, animation, options);
    }

    // Update effects manager reference (sleeping effect disabled, using status dot instead)
    this.effectsManager.setAgentMeshes(this.agentMeshes);
  }

  syncAgents(agents: Agent[]): void {
    // Clear existing
    for (const meshData of this.agentMeshes.values()) {
      this.scene.remove(meshData.group);
    }
    this.agentMeshes.clear();

    // Add new
    for (const agent of agents) {
      this.addAgent(agent);
    }
  }

  refreshSelectionVisuals(): void {
    const state = store.getState();
    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent) {
        const isSelected = state.selectedAgentIds.has(agentId);
        this.characterFactory.updateVisuals(meshData.group, agent, isSelected);
      }
    }
  }

  // ============================================
  // Public API - Effects
  // ============================================

  createMoveOrderEffect(position: THREE.Vector3): void {
    this.effectsManager.createMoveOrderEffect(position);
  }

  /**
   * Show a speech bubble above an agent when using a tool.
   */
  showToolBubble(agentId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    this.effectsManager.setAgentMeshes(this.agentMeshes);
    this.effectsManager.createSpeechBubble(agentId, toolName, toolInput);
  }

  // ============================================
  // Public API - Camera
  // ============================================

  focusAgent(agentId: string): void {
    const state = store.getState();
    const agent = state.agents.get(agentId);
    if (!agent) return;

    const offset = this.camera.position.clone().sub(this.controls.target);
    const newTarget = new THREE.Vector3(agent.position.x, agent.position.y, agent.position.z);
    this.controls.target.copy(newTarget);
    this.camera.position.copy(newTarget).add(offset);
  }

  // ============================================
  // Public API - Drawing
  // ============================================

  /**
   * Set the active drawing tool.
   */
  setDrawingTool(tool: 'rectangle' | 'circle' | 'select' | null): void {
    this.drawingManager.setTool(tool);
    store.setActiveTool(tool);
  }

  /**
   * Sync areas from store (after loading from localStorage).
   */
  syncAreas(): void {
    this.drawingManager.syncFromStore();
  }

  /**
   * Highlight an area (when selected in toolbox).
   */
  highlightArea(areaId: string | null): void {
    this.drawingManager.highlightArea(areaId);
  }

  // ============================================
  // Public API - Config
  // ============================================

  /**
   * Set character scale.
   */
  setCharacterScale(scale: number): void {
    this.characterScale = scale;
    // Update all existing character models
    for (const meshData of this.agentMeshes.values()) {
      const body = meshData.group.getObjectByName('characterBody');
      if (body) {
        body.scale.setScalar(scale);
      }
    }
  }

  /**
   * Set indicator scale (status orbs, labels, bubbles).
   */
  setIndicatorScale(scale: number): void {
    this.indicatorScale = scale;
    // Also update effects manager
    this.effectsManager.setIndicatorScale(scale);
  }

  /**
   * Set grid visibility.
   */
  setGridVisible(visible: boolean): void {
    this.battlefield.setGridVisible(visible);
  }

  /**
   * Set debug time override for testing day/night cycle.
   * @param hour - Hour (0-24) or null to use real time
   */
  setDebugTime(hour: number | null): void {
    this.battlefield.setDebugTime(hour);
  }

  /**
   * Set time mode for the environment.
   * @param mode - 'auto' for real time, or 'day'/'night'/'dawn'/'dusk' for fixed time
   */
  setTimeMode(mode: string): void {
    this.battlefield.setTimeMode(mode);
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
    this.battlefield.setTerrainConfig(config);
  }

  /**
   * Set floor texture style.
   */
  setFloorStyle(style: string, force = false): void {
    this.battlefield.setFloorStyle(style as import('./environment/Battlefield').FloorStyle, force);
  }

  // ============================================
  // Input Handlers
  // ============================================

  private handleAgentClick(agentId: string, shiftKey: boolean): void {
    if (shiftKey) {
      store.addToSelection(agentId);
    } else {
      store.selectAgent(agentId);
    }
    this.refreshSelectionVisuals();
  }

  private handleGroundClick(): void {
    store.selectAgent(null);
    this.refreshSelectionVisuals();
  }

  private handleMoveCommand(position: THREE.Vector3, agentIds: string[]): void {
    this.effectsManager.createMoveOrderEffect(position.clone());

    const positions = this.inputHandler.calculateFormationPositions(position, agentIds.length);

    agentIds.forEach((agentId, index) => {
      const pos = positions[index];
      const meshData = this.agentMeshes.get(agentId);

      store.moveAgent(agentId, pos);

      if (meshData) {
        this.movementAnimator.startMovement(agentId, meshData, pos);
      }
    });
  }

  private handleSelectionBox(agentIds: string[]): void {
    if (agentIds.length > 0) {
      store.selectMultiple(agentIds);
    } else {
      store.selectAgent(null);
    }
    this.refreshSelectionVisuals();
  }

  private handleAgentDoubleClick(agentId: string): void {
    // Select the agent and open terminal
    store.selectAgent(agentId);
    this.refreshSelectionVisuals();
    store.toggleTerminal(agentId);
  }

  // Drawing handlers
  private handleDrawStart(pos: { x: number; z: number }): void {
    this.drawingManager.startDrawing(pos);
  }

  private handleDrawMove(pos: { x: number; z: number }): void {
    this.drawingManager.updateDrawing(pos);
  }

  private handleDrawEnd(pos: { x: number; z: number }): void {
    this.drawingManager.finishDrawing(pos);
  }

  private handleAreaRightClick(pos: { x: number; z: number }): void {
    // Check if clicking on an area
    const area = this.drawingManager.getAreaAtPosition(pos);
    if (area) {
      // Assign selected agents to this area
      const state = store.getState();
      for (const agentId of state.selectedAgentIds) {
        store.assignAgentToArea(agentId, area.id);

        // Move agent to area center
        const agent = state.agents.get(agentId);
        if (agent) {
          const meshData = this.agentMeshes.get(agentId);
          const targetPos = { x: area.center.x, y: 0, z: area.center.z };
          store.moveAgent(agentId, targetPos);
          if (meshData) {
            this.movementAnimator.startMovement(agentId, meshData, targetPos);
          }
        }
      }
    }
  }

  // Resize handlers
  private handleResizeStart(handle: THREE.Mesh, pos: { x: number; z: number }): void {
    this.drawingManager.startResize(handle, pos);
  }

  private handleResizeMove(pos: { x: number; z: number }): void {
    this.drawingManager.updateResize(pos);
  }

  private handleResizeEnd(): void {
    this.drawingManager.finishResize();
  }

  // ============================================
  // Animation Loop
  // ============================================

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    this.controls.update();

    // Calculate delta time
    const now = Date.now();
    const deltaTime = this.lastFrameTime ? (now - this.lastFrameTime) / 1000 : 0.016;
    this.lastFrameTime = now;

    // Save camera periodically
    if (now - this.lastCameraSave > CAMERA_SAVE_INTERVAL) {
      saveCameraState(
        { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
        { x: this.controls.target.x, y: this.controls.target.y, z: this.controls.target.z }
      );
      this.lastCameraSave = now;
    }

    // Update time of day every minute
    if (now - this.lastTimeUpdate > 60000) {
      this.battlefield.updateTimeOfDay();
      this.lastTimeUpdate = now;
    }

    // Update galactic floor animation
    this.battlefield.updateGalacticAnimation(deltaTime);

    // Update animations
    const completedMovements = this.movementAnimator.update(this.agentMeshes);
    this.effectsManager.update();

    // Re-apply status animations for agents that just finished moving
    if (completedMovements.length > 0) {
      const state = store.getState();
      for (const agentId of completedMovements) {
        const agent = state.agents.get(agentId);
        const meshData = this.agentMeshes.get(agentId);
        if (agent && meshData) {
          this.updateStatusAnimation(agent, meshData);
        }
      }
    }

    // Animate working agents
    this.animateWorkingAgents(now);

    // Update idle timers every second
    if (now - this.lastIdleTimerUpdate > 1000) {
      this.updateIdleTimers();
      this.lastIdleTimerUpdate = now;
    }

    this.renderer.render(this.scene, this.camera);
  };

  private updateIdleTimers(): void {
    const state = store.getState();
    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent && agent.status === 'idle') {
        this.characterFactory.updateIdleTimer(meshData.group, agent.status, agent.lastActivity);
      }
    }
  }

  private animateWorkingAgents(now: number): void {
    const state = store.getState();
    const time = now * 0.001;

    for (const [id, agent] of state.agents) {
      const meshData = this.agentMeshes.get(id);
      if (!meshData) continue;

      const isMoving = this.movementAnimator.isMoving(id);

      // Calculate zoom-based scale for indicators
      const indicatorScale = this.calculateIndicatorScale(meshData.group.position);

      // Animate and scale status orb
      const statusOrb = meshData.group.getObjectByName('statusOrb') as THREE.Mesh;
      if (statusOrb) {
        if (!isMoving) {
          statusOrb.position.y = 2.8 + Math.sin(time * 2 + parseFloat(id)) * 0.08;
        }
        statusOrb.scale.setScalar(indicatorScale);
      }

      // Scale name label
      const nameLabel = meshData.group.getObjectByName('nameLabel') as THREE.Sprite;
      if (nameLabel) {
        nameLabel.scale.set(1.2 * indicatorScale, 0.6 * indicatorScale, 1);
      }

      // Scale mana bar
      const manaBar = meshData.group.getObjectByName('manaBar') as THREE.Sprite;
      if (manaBar) {
        manaBar.scale.set(0.9 * indicatorScale, 0.14 * indicatorScale, 1);
      }
    }

    // Update effects manager with camera for zoom-based scaling
    this.effectsManager.updateWithCamera(this.camera);
  }

  /**
   * Calculate scale factor for indicators based on camera distance and user config.
   * Closer = smaller indicators, farther = larger indicators (to remain visible).
   */
  private calculateIndicatorScale(objectPosition: THREE.Vector3): number {
    const distance = this.camera.position.distanceTo(objectPosition);

    // Base distance where scale is 1.0 (comfortable viewing distance)
    const baseDistance = 15;

    // Scale factor: at baseDistance = 1.0, farther = larger, closer = smaller
    // Clamp between 0.5 and 2.5 to avoid extreme sizes
    const zoomScale = Math.max(0.5, Math.min(2.5, distance / baseDistance));

    // Apply user's indicator scale setting
    return zoomScale * this.indicatorScale;
  }

  // ============================================
  // Event Handlers
  // ============================================

  private onWindowResize = (): void => {
    this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
  };

  // ============================================
  // HMR Support
  // ============================================

  reattach(canvas: HTMLCanvasElement, selectionBox: HTMLDivElement): void {
    // Remove old event listeners
    this.canvas = canvas;

    // Update renderer
    this.renderer.dispose();
    this.renderer = this.createRenderer();

    // Reconnect controls
    this.controls.dispose();
    this.controls = this.createControls();

    // Reattach input handler with new controls
    this.inputHandler.reattach(canvas, selectionBox, this.controls);
    this.inputHandler.setReferences(this.battlefield.getGround(), this.agentMeshes);

    // Trigger resize
    this.onWindowResize();
  }

  // ============================================
  // Cleanup
  // ============================================

  dispose(): void {
    window.removeEventListener('resize', this.onWindowResize);
    this.inputHandler.dispose();
    this.drawingManager.dispose();
    this.effectsManager.clear();
    this.renderer.dispose();
    this.controls.dispose();
  }
}
