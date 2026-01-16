import * as THREE from 'three';
import type { Agent } from '../../../shared/types';
import { AGENT_CLASS_CONFIG } from '../config';
import { CharacterLoader } from './CharacterLoader';

/**
 * Status colors for agent state visualization.
 */
const STATUS_COLORS: Record<string, number> = {
  idle: 0x4aff9e,
  working: 0x4a9eff,
  waiting: 0xff9e4a,
  error: 0xff4a4a,
  default: 0x888888,
};

/**
 * Agent mesh data including animations.
 */
export interface AgentMeshData {
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  animations: Map<string, THREE.AnimationClip>;
  currentAction: THREE.AnimationAction | null;
}

/**
 * Creates and manages agent mesh groups with all visual components.
 */
export class CharacterFactory {
  constructor(private characterLoader: CharacterLoader) {}

  /**
   * Create a complete agent mesh group with character model and indicators.
   */
  createAgentMesh(agent: Agent): AgentMeshData {
    const group = new THREE.Group();
    group.userData.agentId = agent.id;

    const classConfig = AGENT_CLASS_CONFIG[agent.class];

    // Character body (3D model or fallback capsule)
    const { body, mixer, animations } = this.createCharacterBody(agent, classConfig.color);
    group.add(body);

    // Selection ring (shows when agent is selected)
    const selectionRing = this.createSelectionRing(classConfig.color);
    group.add(selectionRing);

    // Status orb
    const statusOrb = this.createStatusOrb(agent.status);
    group.add(statusOrb);

    // Name label
    const nameLabel = this.createNameLabel(agent.name, classConfig.color);
    group.add(nameLabel);

    // Mana bar with status indicator (context remaining + status dot + task count)
    const manaBar = this.createManaBar(agent.contextUsed, agent.contextLimit, agent.status, agent.taskCount || 0);
    group.add(manaBar);

    // Idle timer indicator (shows when agent is idle)
    const idleTimer = this.createIdleTimer(agent.status, agent.lastActivity);
    group.add(idleTimer);

    // Store agent metadata for updates
    group.userData.agentName = agent.name;
    group.userData.agentClass = agent.class;

    // Set initial position
    group.position.set(agent.position.x, agent.position.y, agent.position.z);

    return {
      group,
      mixer,
      animations,
      currentAction: null,
    };
  }

  /**
   * Create the character body - either loaded model or fallback capsule.
   */
  private createCharacterBody(
    agent: Agent,
    fallbackColor: number
  ): {
    body: THREE.Object3D;
    mixer: THREE.AnimationMixer | null;
    animations: Map<string, THREE.AnimationClip>;
  } {
    // Try to use loaded character model
    const cloneResult = this.characterLoader.clone(agent.class);

    if (cloneResult) {
      cloneResult.mesh.name = 'characterBody';

      // Create animation mixer
      const mixer = new THREE.AnimationMixer(cloneResult.mesh);

      // Map animations by name (lowercase for consistent lookup)
      const animations = new Map<string, THREE.AnimationClip>();
      for (const clip of cloneResult.animations) {
        // Normalize to lowercase to match ANIMATIONS constants
        const normalizedName = clip.name.toLowerCase();
        animations.set(normalizedName, clip);
      }
      console.log(`[CharacterFactory] Available animations for ${agent.name}:`, Array.from(animations.keys()));

      return {
        body: cloneResult.mesh,
        mixer,
        animations,
      };
    }

    // Fallback to capsule if model not loaded
    const geometry = new THREE.CapsuleGeometry(0.5, 1.0, 4, 16);
    const material = new THREE.MeshStandardMaterial({
      color: fallbackColor,
      roughness: 0.4,
      metalness: 0.3,
    });

    const body = new THREE.Mesh(geometry, material);
    body.position.y = 1.0;
    body.castShadow = true;
    body.receiveShadow = true;
    body.name = 'characterBody';

    return {
      body,
      mixer: null,
      animations: new Map(),
    };
  }

  /**
   * Create the selection ring indicator.
   */
  private createSelectionRing(color: number): THREE.Mesh {
    const geometry = new THREE.RingGeometry(0.8, 0.95, 32);
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });

    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.name = 'selectionRing';

    return ring;
  }

  /**
   * Create the status orb indicator.
   */
  private createStatusOrb(status: string): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(0.15, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: this.getStatusColor(status),
    });

    const orb = new THREE.Mesh(geometry, material);
    orb.position.y = 2.8; // Above the name label
    orb.name = 'statusOrb';

    return orb;
  }

  /**
   * Create a text sprite for the agent's name.
   */
  private createNameLabel(name: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;

    // High resolution canvas (2:1 aspect ratio) for crisp text
    canvas.width = 512;
    canvas.height = 256;

    // Clear canvas
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Set font first to measure text - larger for high-res canvas
    context.font = 'bold 72px Arial';
    const measuredWidth = context.measureText(name).width;
    const padding = 32;
    const bgWidth = Math.min(measuredWidth + padding * 2, canvas.width - 16);
    const bgHeight = 100;
    const bgX = (canvas.width - bgWidth) / 2;
    const bgY = (canvas.height - bgHeight) / 2;

    // Draw background (semi-transparent dark with rounded corners)
    context.fillStyle = 'rgba(0, 0, 0, 0.8)';
    context.beginPath();
    context.roundRect(bgX, bgY, bgWidth, bgHeight, 12);
    context.fill();

    // Draw text
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, canvas.width / 2, canvas.height / 2);

    // Create texture with high quality filtering
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    // Create sprite material
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    // Create sprite - proper 2:1 aspect ratio matching canvas
    const sprite = new THREE.Sprite(material);
    sprite.position.y = -0.3; // Below the character (at feet level)
    sprite.scale.set(1.2, 0.6, 1); // Larger size, maintains 2:1 aspect ratio
    sprite.name = 'nameLabel';

    return sprite;
  }

  /**
   * Create a mana bar showing context remaining with status indicator and task count.
   */
  private createManaBar(contextUsed: number, contextLimit: number, status: string, taskCount: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // Higher resolution for crisp rendering
    canvas.width = 400;
    canvas.height = 64;

    this.drawManaBar(ctx, canvas.width, canvas.height, contextUsed, contextLimit, status, taskCount);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.y = 2.0; // Below the name label
    sprite.scale.set(1.1, 0.18, 1); // Wider to fit status dot + bar
    sprite.name = 'manaBar';

    return sprite;
  }

  /**
   * Draw the mana bar on a canvas context with status indicator and task count.
   */
  private drawManaBar(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    contextUsed: number,
    contextLimit: number,
    status: string,
    taskCount: number
  ): void {
    // Calculate percentage remaining
    const used = contextUsed || 0;
    const limit = contextLimit || 200000;
    const remaining = Math.max(0, limit - used);
    const percentage = remaining / limit;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Scale factors based on canvas size
    const scale = height / 32; // Base scale on height (32 was original)
    const dotSize = 20 * scale; // Status dot size
    const dotMargin = 6 * scale;
    const barX = dotSize + dotMargin + 4 * scale; // Start after the dot
    const barY = 6 * scale;
    const barWidth = width - barX - 10 * scale;
    const barHeight = height - 12 * scale;
    const borderRadius = 6 * scale;

    // Draw status dot (left side)
    const dotColor = status === 'working' ? '#4a9eff' : '#ff5555'; // blue if working, red if idle
    const dotX = dotSize / 2 + 4 * scale;
    const dotY = height / 2;

    ctx.beginPath();
    ctx.arc(dotX, dotY, dotSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    // Dot glow
    ctx.shadowColor = dotColor;
    ctx.shadowBlur = 8 * scale;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Dot border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    // Background (solid black)
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, borderRadius);
    ctx.fill();

    // Bright border
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    // Mana fill - bright saturated colors
    const fillWidth = Math.max(0, (barWidth - 4 * scale) * percentage);
    if (fillWidth > 0) {
      // Solid bright colors based on percentage
      let fillColor: string;
      let glowColor: string;

      if (percentage > 0.5) {
        fillColor = '#00ffff'; // Bright cyan
        glowColor = '#00ffff';
      } else if (percentage > 0.2) {
        fillColor = '#ffff00'; // Bright yellow
        glowColor = '#ffff00';
      } else {
        fillColor = '#ff0000'; // Bright red
        glowColor = '#ff0000';
      }

      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.roundRect(barX + 2 * scale, barY + 2 * scale, fillWidth, barHeight - 4 * scale, borderRadius - 2);
      ctx.fill();

      // Strong glow effect
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 8 * scale;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Percentage text - scale font size
    const percentText = `${Math.round(percentage * 100)}%`;
    ctx.font = `bold ${Math.round(32 * scale)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Thick black outline
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5 * scale;
    ctx.strokeText(percentText, width / 2, height / 2);

    // Bright white fill
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 2 * scale;
    ctx.fillText(percentText, width / 2, height / 2);
    ctx.shadowBlur = 0;

    // Task count badge (right side of the bar)
    if (taskCount > 0) {
      const badgeX = width - 30 * scale;
      const badgeY = height / 2;
      const badgeRadius = 14 * scale;

      // Badge background (orange/gold)
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#ff9900';
      ctx.fill();

      // Badge glow
      ctx.shadowColor = '#ff9900';
      ctx.shadowBlur = 6 * scale;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Badge border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2 * scale;
      ctx.stroke();

      // Task count text
      const countText = taskCount > 99 ? '99+' : String(taskCount);
      ctx.font = `bold ${Math.round(18 * scale)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000000';
      ctx.fillText(countText, badgeX, badgeY);
    }
  }

  /**
   * Create an idle timer indicator showing time since last activity.
   */
  private createIdleTimer(status: string, lastActivity: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // Larger canvas size for better visibility
    canvas.width = 400;
    canvas.height = 80;

    this.drawIdleTimer(ctx, canvas.width, canvas.height, status, lastActivity);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.y = 2.5; // Above mana bar (name is now below character)
    sprite.scale.set(2.0, 0.4, 1); // Large scale for good visibility
    sprite.name = 'idleTimer';

    return sprite;
  }

  /**
   * Get color for idle timer based on duration.
   * Uses a smooth gradient from green (0 min) to red (1+ hour).
   */
  private getIdleTimerColor(idleSeconds: number): { text: string; border: string } {
    // Gradual color transition from green to red over 1 hour
    // 0 min = green (120° hue), 60 min = red (0° hue)
    const maxMinutes = 60;
    const minutes = Math.min(idleSeconds / 60, maxMinutes);

    // Calculate hue: 120 (green) -> 0 (red)
    // Use a slight curve to stay green longer, then transition faster to red
    const progress = minutes / maxMinutes;
    const curvedProgress = Math.pow(progress, 0.7); // Slower start, faster end
    const hue = 120 * (1 - curvedProgress);

    // Keep saturation high and lightness at a good visible level
    const saturation = 80 + (20 * curvedProgress); // 80% -> 100% as it gets redder
    const lightness = 60 - (10 * curvedProgress);  // 60% -> 50% (slightly darker for red)

    const color = `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
    return { text: color, border: color };
  }

  /**
   * Draw the idle timer on a canvas context.
   */
  private drawIdleTimer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    status: string,
    lastActivity: number
  ): void {
    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Only show for idle agents with activity
    if (status !== 'idle' || lastActivity <= 0) {
      return;
    }

    // Calculate idle time
    const idleSeconds = Math.floor((Date.now() - lastActivity) / 1000);
    const idleText = this.formatIdleTimeShort(idleSeconds);
    const colors = this.getIdleTimerColor(idleSeconds);

    // Scale factor based on new height (80 is the base)
    const scale = height / 80;

    // Background pill - larger and more visible
    const padding = 24 * scale;
    ctx.font = `bold ${Math.round(44 * scale)}px Arial`;
    const textWidth = ctx.measureText(`⏱ ${idleText}`).width;
    const bgWidth = textWidth + padding * 2;
    const bgHeight = height - 12 * scale;
    const bgX = (width - bgWidth) / 2;
    const bgY = 6 * scale;

    // Draw background - more opaque
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.beginPath();
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 10 * scale);
    ctx.fill();

    // Border - color based on idle duration
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 3 * scale;
    ctx.stroke();

    // Draw text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Text outline - thicker
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4 * scale;
    ctx.strokeText(`⏱ ${idleText}`, width / 2, height / 2);

    // Text fill - color based on idle duration
    ctx.fillStyle = colors.text;
    ctx.fillText(`⏱ ${idleText}`, width / 2, height / 2);
  }

  /**
   * Format idle time for display in short format.
   */
  private formatIdleTimeShort(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      const secs = seconds % 60;
      return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  /**
   * Update the idle timer for an agent.
   */
  updateIdleTimer(group: THREE.Group, status: string, lastActivity: number): void {
    const idleTimer = group.getObjectByName('idleTimer') as THREE.Sprite;
    if (!idleTimer) return;

    const material = idleTimer.material as THREE.SpriteMaterial;
    if (!material.map) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    // Match the larger canvas size from createIdleTimer
    canvas.width = 400;
    canvas.height = 80;

    this.drawIdleTimer(ctx, canvas.width, canvas.height, status, lastActivity);

    // Update texture
    material.map.image = canvas;
    material.map.needsUpdate = true;
  }

  /**
   * Update the mana bar for an agent.
   */
  updateManaBar(group: THREE.Group, contextUsed: number, contextLimit: number, status: string, taskCount: number): void {
    const manaBar = group.getObjectByName('manaBar') as THREE.Sprite;
    if (!manaBar) return;

    const material = manaBar.material as THREE.SpriteMaterial;
    if (!material.map) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    // Match the higher resolution from createManaBar
    canvas.width = 400;
    canvas.height = 64;

    this.drawManaBar(ctx, canvas.width, canvas.height, contextUsed, contextLimit, status, taskCount);

    // Update texture
    material.map.image = canvas;
    material.map.needsUpdate = true;
  }

  /**
   * Get color for a status string.
   */
  getStatusColor(status: string): number {
    return STATUS_COLORS[status] ?? STATUS_COLORS.default;
  }

  /**
   * Upgrade an agent's capsule body to a character model.
   * Returns the new AgentMeshData if upgrade was performed, null otherwise.
   */
  upgradeToCharacterModel(group: THREE.Group, agent: Agent): AgentMeshData | null {
    const existingBody = group.getObjectByName('characterBody');

    // Check if using fallback capsule
    if (!(existingBody instanceof THREE.Mesh)) return null;
    if (!(existingBody.geometry instanceof THREE.CapsuleGeometry)) return null;

    // Try to get character model
    const cloneResult = this.characterLoader.clone(agent.class);
    if (!cloneResult) return null;

    // Replace capsule with character model
    group.remove(existingBody);
    existingBody.geometry.dispose();
    (existingBody.material as THREE.Material).dispose();

    cloneResult.mesh.name = 'characterBody';
    group.add(cloneResult.mesh);

    // Create mixer for animations
    const mixer = new THREE.AnimationMixer(cloneResult.mesh);
    const animations = new Map<string, THREE.AnimationClip>();
    for (const clip of cloneResult.animations) {
      // Normalize to lowercase to match ANIMATIONS constants
      const normalizedName = clip.name.toLowerCase();
      animations.set(normalizedName, clip);
    }

    console.log(`[CharacterFactory] Upgraded ${agent.name} to character model, animations:`, Array.from(animations.keys()));

    return {
      group,
      mixer,
      animations,
      currentAction: null,
    };
  }

  /**
   * Update visual state of an agent mesh.
   */
  updateVisuals(group: THREE.Group, agent: Agent, isSelected: boolean): void {
    // Update name label if name changed
    if (group.userData.agentName !== agent.name) {
      this.updateNameLabel(group, agent.name, agent.class);
      group.userData.agentName = agent.name;
    }

    // Update status orb color
    const statusOrb = group.getObjectByName('statusOrb') as THREE.Mesh;
    if (statusOrb) {
      (statusOrb.material as THREE.MeshBasicMaterial).color.setHex(
        this.getStatusColor(agent.status)
      );
    }

    // Update selection ring visibility
    const selectionRing = group.getObjectByName('selectionRing') as THREE.Mesh;
    if (selectionRing) {
      (selectionRing.material as THREE.MeshBasicMaterial).opacity = isSelected ? 0.8 : 0;
    }

    // Update mana bar (includes status dot and task count)
    this.updateManaBar(group, agent.contextUsed, agent.contextLimit, agent.status, agent.taskCount || 0);

    // Update idle timer
    this.updateIdleTimer(group, agent.status, agent.lastActivity);
  }

  /**
   * Update the name label for an agent.
   */
  private updateNameLabel(group: THREE.Group, name: string, agentClass: string): void {
    const oldLabel = group.getObjectByName('nameLabel') as THREE.Sprite;
    if (oldLabel) {
      // Dispose old texture and material
      oldLabel.material.map?.dispose();
      oldLabel.material.dispose();
      group.remove(oldLabel);
    }

    // Create new label with class color
    const classConfig = AGENT_CLASS_CONFIG[agentClass as keyof typeof AGENT_CLASS_CONFIG];
    const color = classConfig?.color ?? 0xffffff;
    const newLabel = this.createNameLabel(name, color);
    group.add(newLabel);
  }
}
