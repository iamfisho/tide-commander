import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { store } from '../../store';
import { DRAG_THRESHOLD, FORMATION_SPACING } from '../config';
import type { AgentMeshData } from '../characters/CharacterFactory';

/**
 * Callbacks for input events.
 */
export interface InputCallbacks {
  onAgentClick: (agentId: string, shiftKey: boolean) => void;
  onAgentDoubleClick: (agentId: string) => void;
  onGroundClick: () => void;
  onMoveCommand: (position: THREE.Vector3, agentIds: string[]) => void;
  onSelectionBox: (agentIds: string[]) => void;
  // Drawing callbacks
  onDrawStart?: (pos: { x: number; z: number }) => void;
  onDrawMove?: (pos: { x: number; z: number }) => void;
  onDrawEnd?: (pos: { x: number; z: number }) => void;
  onAreaRightClick?: (pos: { x: number; z: number }) => void;
  // Resize callbacks
  onResizeStart?: (handle: THREE.Mesh, pos: { x: number; z: number }) => void;
  onResizeMove?: (pos: { x: number; z: number }) => void;
  onResizeEnd?: () => void;
}

/**
 * Drawing mode checker function type.
 */
export type DrawingModeChecker = () => boolean;

/**
 * Resize handles getter function type.
 */
export type ResizeHandlesGetter = () => THREE.Mesh[];

/**
 * Resize mode checker function type.
 */
export type ResizeModeChecker = () => boolean;

/**
 * Handles all mouse and keyboard input for the scene.
 */
export class InputHandler {
  private canvas: HTMLCanvasElement;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private selectionBox: HTMLDivElement;

  // Drag selection state
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private dragCurrent = { x: 0, y: 0 };

  // Right-click drag state
  private isRightDragging = false;
  private rightDragStart = { x: 0, y: 0 };

  // Drawing state
  private isDrawing = false;
  private drawingModeChecker: DrawingModeChecker = () => false;

  // Resize state
  private isResizing = false;
  private resizeHandlesGetter: ResizeHandlesGetter = () => [];
  private resizeModeChecker: ResizeModeChecker = () => false;

  // Double-click detection
  private lastClickTime = 0;
  private lastClickAgentId: string | null = null;
  private doubleClickThreshold = 300; // ms
  private singleClickTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingClickEvent: { agentId: string; shiftKey: boolean } | null = null;

  private callbacks: InputCallbacks;
  private ground: THREE.Object3D | null = null;
  private agentMeshes: Map<string, AgentMeshData> = new Map();

  constructor(
    canvas: HTMLCanvasElement,
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    selectionBox: HTMLDivElement,
    callbacks: InputCallbacks
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.controls = controls;
    this.selectionBox = selectionBox;
    this.callbacks = callbacks;

    this.setupEventListeners();
  }

  /**
   * Update references for raycasting.
   */
  setReferences(ground: THREE.Object3D | null, agentMeshes: Map<string, AgentMeshData>): void {
    this.ground = ground;
    this.agentMeshes = agentMeshes;
  }

  /**
   * Set the drawing mode checker function.
   */
  setDrawingModeChecker(checker: DrawingModeChecker): void {
    this.drawingModeChecker = checker;
  }

  /**
   * Set the resize handles getter and mode checker.
   */
  setResizeHandlers(getter: ResizeHandlesGetter, checker: ResizeModeChecker): void {
    this.resizeHandlesGetter = getter;
    this.resizeModeChecker = checker;
  }

  /**
   * Raycast to ground and return world position.
   */
  raycastGround(event: MouseEvent): { x: number; z: number } | null {
    if (!this.ground) return null;

    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObject(this.ground);
    if (intersects.length > 0) {
      const point = intersects[0].point;
      return { x: point.x, z: point.z };
    }
    return null;
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown, true);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  /**
   * Remove event listeners.
   */
  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown, true);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    if (this.singleClickTimer) {
      clearTimeout(this.singleClickTimer);
      this.singleClickTimer = null;
    }
  }

  /**
   * Reattach to new canvas element and controls.
   */
  reattach(canvas: HTMLCanvasElement, selectionBox: HTMLDivElement, controls: OrbitControls): void {
    this.dispose();
    this.canvas = canvas;
    this.selectionBox = selectionBox;
    this.controls = controls;
    this.setupEventListeners();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) {
      this.controls.mouseButtons.LEFT = null as unknown as THREE.MOUSE;

      // Check if clicking on a resize handle first
      const resizeHandle = this.checkResizeHandleClick(event);
      if (resizeHandle) {
        const groundPos = this.raycastGround(event);
        if (groundPos) {
          this.isResizing = true;
          this.callbacks.onResizeStart?.(resizeHandle, groundPos);
        }
        return;
      }

      // Check if in drawing mode
      if (this.drawingModeChecker()) {
        const groundPos = this.raycastGround(event);
        if (groundPos) {
          this.isDrawing = true;
          this.callbacks.onDrawStart?.(groundPos);
        }
        return;
      }

      this.isDragging = false;
      this.dragStart = { x: event.clientX, y: event.clientY };
      this.dragCurrent = { x: event.clientX, y: event.clientY };
    }

    if (event.button === 2) {
      if (event.altKey) {
        this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
      } else {
        this.controls.mouseButtons.RIGHT = null as unknown as THREE.MOUSE;
      }
      this.isRightDragging = false;
      this.rightDragStart = { x: event.clientX, y: event.clientY };
    }
  };

  /**
   * Check if clicking on a resize handle.
   */
  private checkResizeHandleClick(event: PointerEvent): THREE.Mesh | null {
    const handles = this.resizeHandlesGetter();
    if (handles.length === 0) return null;

    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObjects(handles);
    if (intersects.length > 0) {
      return intersects[0].object as THREE.Mesh;
    }
    return null;
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (event.buttons & 1) {
      // Handle resize mode
      if (this.isResizing) {
        const groundPos = this.raycastGround(event);
        if (groundPos) {
          this.callbacks.onResizeMove?.(groundPos);
        }
        return;
      }

      // Handle drawing mode
      if (this.isDrawing) {
        const groundPos = this.raycastGround(event);
        if (groundPos) {
          this.callbacks.onDrawMove?.(groundPos);
        }
        return;
      }

      const dx = event.clientX - this.dragStart.x;
      const dy = event.clientY - this.dragStart.y;

      if (!this.isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        this.isDragging = true;
        this.selectionBox.classList.add('active');
      }

      if (this.isDragging) {
        this.dragCurrent = { x: event.clientX, y: event.clientY };
        this.updateSelectionBox();
      }
    }

    if (event.buttons & 2) {
      const dx = event.clientX - this.rightDragStart.x;
      const dy = event.clientY - this.rightDragStart.y;

      if (!this.isRightDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        this.isRightDragging = true;
      }
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button === 0) {
      this.controls.mouseButtons.LEFT = null as unknown as THREE.MOUSE;

      // Handle resize mode
      if (this.isResizing) {
        this.callbacks.onResizeEnd?.();
        this.isResizing = false;
        return;
      }

      // Handle drawing mode
      if (this.isDrawing) {
        const groundPos = this.raycastGround(event);
        if (groundPos) {
          this.callbacks.onDrawEnd?.(groundPos);
        }
        this.isDrawing = false;
        return;
      }

      if (this.isDragging) {
        this.isDragging = false;
        this.selectionBox.classList.remove('active');
        this.selectAgentsInBox(this.dragStart, this.dragCurrent);
      } else if (!event.ctrlKey) {
        this.handleSingleClick(event);
      }
    }

    if (event.button === 2) {
      this.controls.mouseButtons.RIGHT = null as unknown as THREE.MOUSE;
      this.isRightDragging = false;
    }
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();

    if (event.altKey) return;

    this.controls.mouseButtons.RIGHT = null as unknown as THREE.MOUSE;

    if (this.isRightDragging) {
      this.isRightDragging = false;
      return;
    }

    const state = store.getState();

    if (!this.ground) return;

    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObject(this.ground);
    if (intersects.length > 0) {
      const point = intersects[0].point;

      // Check if right-clicking on an area (for agent assignment)
      if (state.selectedAgentIds.size > 0 && this.callbacks.onAreaRightClick) {
        this.callbacks.onAreaRightClick({ x: point.x, z: point.z });
      }

      // Move command for selected agents
      if (state.selectedAgentIds.size > 0) {
        const agentIds = Array.from(state.selectedAgentIds);
        this.callbacks.onMoveCommand(point, agentIds);
      }
    }
  };

  private updateSelectionBox(): void {
    const left = Math.min(this.dragStart.x, this.dragCurrent.x);
    const top = Math.min(this.dragStart.y, this.dragCurrent.y);
    const width = Math.abs(this.dragCurrent.x - this.dragStart.x);
    const height = Math.abs(this.dragCurrent.y - this.dragStart.y);

    this.selectionBox.style.left = `${left}px`;
    this.selectionBox.style.top = `${top}px`;
    this.selectionBox.style.width = `${width}px`;
    this.selectionBox.style.height = `${height}px`;
  }

  private handleSingleClick(event: PointerEvent): void {
    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshArray = Array.from(this.agentMeshes.values()).map((d) => d.group);
    const intersects = this.raycaster.intersectObjects(meshArray, true);

    if (intersects.length > 0) {
      let obj: THREE.Object3D | null = intersects[0].object;
      while (obj && !obj.userData.agentId) {
        obj = obj.parent;
      }

      if (obj && obj.userData.agentId) {
        const agentId = obj.userData.agentId;
        const now = performance.now();

        // Check for double-click
        if (
          this.lastClickAgentId === agentId &&
          now - this.lastClickTime < this.doubleClickThreshold
        ) {
          // Double-click detected - cancel pending single click and open terminal
          if (this.singleClickTimer) {
            clearTimeout(this.singleClickTimer);
            this.singleClickTimer = null;
            this.pendingClickEvent = null;
          }
          this.callbacks.onAgentDoubleClick(agentId);
          this.lastClickAgentId = null;
          this.lastClickTime = 0;
        } else {
          // Potential single click - delay to check for double-click
          // Cancel any previous pending click
          if (this.singleClickTimer) {
            clearTimeout(this.singleClickTimer);
          }

          this.lastClickAgentId = agentId;
          this.lastClickTime = now;
          this.pendingClickEvent = { agentId, shiftKey: event.shiftKey };

          this.singleClickTimer = setTimeout(() => {
            if (this.pendingClickEvent) {
              this.callbacks.onAgentClick(this.pendingClickEvent.agentId, this.pendingClickEvent.shiftKey);
              this.pendingClickEvent = null;
            }
            this.singleClickTimer = null;
            // Reset double-click state after timeout - critical for next double-click to work
            this.lastClickAgentId = null;
            this.lastClickTime = 0;
          }, this.doubleClickThreshold);
        }
        return;
      }
    }

    // Clicked on ground - cancel any pending click and reset double-click state
    if (this.singleClickTimer) {
      clearTimeout(this.singleClickTimer);
      this.singleClickTimer = null;
      this.pendingClickEvent = null;
    }
    this.lastClickAgentId = null;
    this.lastClickTime = 0;

    if (!event.shiftKey) {
      this.callbacks.onGroundClick();
    }
  }

  private selectAgentsInBox(
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): void {
    const rect = this.canvas.getBoundingClientRect();
    const boxLeft = Math.min(start.x, end.x);
    const boxRight = Math.max(start.x, end.x);
    const boxTop = Math.min(start.y, end.y);
    const boxBottom = Math.max(start.y, end.y);

    const agentsInBox: string[] = [];

    for (const [agentId, meshData] of this.agentMeshes) {
      const screenPos = meshData.group.position.clone().project(this.camera);
      const screenX = ((screenPos.x + 1) / 2) * rect.width + rect.left;
      const screenY = ((-screenPos.y + 1) / 2) * rect.height + rect.top;

      if (
        screenX >= boxLeft &&
        screenX <= boxRight &&
        screenY >= boxTop &&
        screenY <= boxBottom
      ) {
        agentsInBox.push(agentId);
      }
    }

    this.callbacks.onSelectionBox(agentsInBox);
  }

  private updateMouse(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /**
   * Calculate formation positions for multiple agents.
   */
  calculateFormationPositions(
    center: THREE.Vector3,
    count: number
  ): { x: number; y: number; z: number }[] {
    const positions: { x: number; y: number; z: number }[] = [];

    if (count === 1) {
      return [{ x: center.x, y: 0, z: center.z }];
    }

    if (count <= 6) {
      // Circle formation
      const radius = FORMATION_SPACING * Math.max(1, count / 3);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        positions.push({
          x: center.x + Math.cos(angle) * radius,
          y: 0,
          z: center.z + Math.sin(angle) * radius,
        });
      }
    } else {
      // Grid formation
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const offsetX = ((cols - 1) * FORMATION_SPACING) / 2;
      const offsetZ = ((rows - 1) * FORMATION_SPACING) / 2;

      for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions.push({
          x: center.x + col * FORMATION_SPACING - offsetX,
          y: 0,
          z: center.z + row * FORMATION_SPACING - offsetZ,
        });
      }
    }

    return positions;
  }
}
