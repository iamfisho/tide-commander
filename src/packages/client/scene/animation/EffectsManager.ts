import * as THREE from 'three';

/**
 * Move order effect data.
 */
interface MoveOrderEffect {
  group: THREE.Group;
  startTime: number;
  duration: number;
}

/**
 * Speech bubble effect data.
 */
interface SpeechBubbleEffect {
  sprite: THREE.Sprite;
  agentId: string;
  startTime: number;
  duration: number;
  baseY: number;
}

/**
 * Sleeping ZZZ effect data.
 */
interface SleepingEffect {
  sprites: THREE.Sprite[];
  agentId: string;
  startTime: number;
}

/**
 * Tool icons for common tools
 */
const TOOL_ICONS: Record<string, string> = {
  WebSearch: '🔍',
  WebFetch: '🌐',
  Read: '📖',
  Write: '✏️',
  Edit: '📝',
  Bash: '💻',
  Grep: '🔎',
  Glob: '📁',
  Task: '📋',
  TodoWrite: '✅',
};

/**
 * Manages visual effects like move order indicators.
 */
export class EffectsManager {
  private scene: THREE.Scene;
  private moveOrderEffects: MoveOrderEffect[] = [];
  private speechBubbles: SpeechBubbleEffect[] = [];
  private sleepingEffects: SleepingEffect[] = [];
  private agentMeshes: Map<string, THREE.Group> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Set reference to agent meshes for tracking positions.
   */
  setAgentMeshes(meshes: Map<string, { group: THREE.Group }>): void {
    this.agentMeshes.clear();
    for (const [id, data] of meshes) {
      this.agentMeshes.set(id, data.group);
    }
  }

  /**
   * Update sleeping ZZZ effect for an agent.
   */
  updateSleepingEffect(agentId: string, isSleeping: boolean): void {
    const existingEffect = this.sleepingEffects.find(e => e.agentId === agentId);

    if (isSleeping && !existingEffect) {
      // Create sleeping effect
      this.createSleepingEffect(agentId);
    } else if (!isSleeping && existingEffect) {
      // Remove sleeping effect
      this.removeSleepingEffect(agentId);
    }
  }

  /**
   * Create a sleeping bubble effect above an agent.
   */
  private createSleepingEffect(agentId: string): void {
    const agentGroup = this.agentMeshes.get(agentId);
    if (!agentGroup) return;

    const sprites: THREE.Sprite[] = [];

    // Create compact sleep bubble
    const bubbleCanvas = document.createElement('canvas');
    const bubbleCtx = bubbleCanvas.getContext('2d')!;
    bubbleCanvas.width = 128;
    bubbleCanvas.height = 128;

    // Draw thought bubble background - compact
    bubbleCtx.fillStyle = 'rgba(40, 42, 54, 0.95)';
    bubbleCtx.strokeStyle = '#bd93f9'; // Dracula purple
    bubbleCtx.lineWidth = 2;

    // Main bubble - centered, smaller
    const bubbleX = 64, bubbleY = 50, bubbleR = 40;
    bubbleCtx.beginPath();
    bubbleCtx.arc(bubbleX, bubbleY, bubbleR, 0, Math.PI * 2);
    bubbleCtx.fill();
    bubbleCtx.stroke();

    // Small connector bubbles - scaled down
    bubbleCtx.beginPath();
    bubbleCtx.arc(30, 95, 10, 0, Math.PI * 2);
    bubbleCtx.fill();
    bubbleCtx.stroke();

    bubbleCtx.beginPath();
    bubbleCtx.arc(18, 115, 6, 0, Math.PI * 2);
    bubbleCtx.fill();
    bubbleCtx.stroke();

    // Draw ZZZ text - smaller
    bubbleCtx.fillStyle = '#8be9fd'; // Dracula cyan
    bubbleCtx.font = 'bold 28px Arial';
    bubbleCtx.textAlign = 'center';
    bubbleCtx.textBaseline = 'middle';
    bubbleCtx.shadowColor = '#8be9fd';
    bubbleCtx.shadowBlur = 4;
    bubbleCtx.fillText('ZZZ', bubbleX, bubbleY);

    // Create bubble sprite with high quality filtering
    const bubbleTexture = new THREE.CanvasTexture(bubbleCanvas);
    bubbleTexture.minFilter = THREE.LinearFilter;
    bubbleTexture.magFilter = THREE.LinearFilter;
    bubbleTexture.needsUpdate = true;

    const bubbleMaterial = new THREE.SpriteMaterial({
      map: bubbleTexture,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });

    const bubbleSprite = new THREE.Sprite(bubbleMaterial);
    // Tiny size
    bubbleSprite.scale.set(0.12, 0.12, 1);
    bubbleSprite.userData.isBubble = true;

    // Position above and to the side of agent's head
    bubbleSprite.position.copy(agentGroup.position);
    bubbleSprite.position.y = 2.3;
    bubbleSprite.position.x += 0.15;

    this.scene.add(bubbleSprite);
    sprites.push(bubbleSprite);

    this.sleepingEffects.push({
      sprites,
      agentId,
      startTime: performance.now(),
    });
  }

  /**
   * Remove sleeping effect for an agent.
   */
  private removeSleepingEffect(agentId: string): void {
    const index = this.sleepingEffects.findIndex(e => e.agentId === agentId);
    if (index !== -1) {
      const effect = this.sleepingEffects[index];
      for (const sprite of effect.sprites) {
        this.scene.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
      this.sleepingEffects.splice(index, 1);
    }
  }

  /**
   * Create a speech bubble effect above an agent.
   */
  createSpeechBubble(agentId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    const agentGroup = this.agentMeshes.get(agentId);
    if (!agentGroup) return;

    // Remove existing bubble for this agent
    this.removeSpeechBubble(agentId);

    // Get tool icon
    const icon = TOOL_ICONS[toolName] || '🔧';

    // Extract key parameter to display
    const paramText = this.formatToolParams(toolName, toolInput);

    // Create compact canvas - 3:1 aspect ratio for tighter bubble
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const hasParams = !!paramText;
    canvas.width = 420;
    canvas.height = 140;

    // Draw speech bubble background
    ctx.fillStyle = 'rgba(15, 15, 25, 0.95)';
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 2;

    // Rounded rectangle with pointer - minimal padding
    const padding = 8;
    const x = padding, y = padding;
    const w = canvas.width - padding * 2;
    const h = canvas.height - padding * 2 - 16; // Small pointer
    const r = 8;

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + w / 2 + 12, y + h);
    // Pointer
    ctx.lineTo(x + w / 2, y + h + 16);
    ctx.lineTo(x + w / 2 - 12, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw tool name with icon - compact
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const titleY = hasParams ? 38 : 54;
    ctx.fillText(`${icon} ${toolName}`, canvas.width / 2, titleY);

    // Draw parameter text if available - closer to title
    if (paramText) {
      ctx.fillStyle = '#88aacc';
      ctx.font = '18px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Truncate if too long
      const maxWidth = canvas.width - 24;
      let displayText = paramText;
      while (ctx.measureText(displayText).width > maxWidth && displayText.length > 3) {
        displayText = displayText.slice(0, -4) + '...';
      }
      ctx.fillText(displayText, canvas.width / 2, 78);
    }

    // Create sprite with high quality filtering
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
    });

    const sprite = new THREE.Sprite(material);
    // Match sprite scale to canvas aspect ratio (3:1) - compact size
    sprite.scale.set(2.1, 0.7, 1);

    // Position above agent
    const baseY = 3.5;
    sprite.position.copy(agentGroup.position);
    sprite.position.y = baseY;

    this.scene.add(sprite);

    this.speechBubbles.push({
      sprite,
      agentId,
      startTime: performance.now(),
      duration: 4000, // Longer duration for reading params
      baseY,
    });
  }

  /**
   * Format tool parameters for display.
   */
  private formatToolParams(toolName: string, input?: Record<string, unknown>): string {
    if (!input) return '';

    // Extract the most relevant parameter based on tool type
    switch (toolName) {
      case 'WebSearch':
        return input.query as string || '';
      case 'WebFetch':
        return input.url as string || '';
      case 'Read':
      case 'Write':
      case 'Edit':
        const filePath = (input.file_path || input.path) as string || '';
        // Show just filename for long paths
        if (filePath.length > 40) {
          const parts = filePath.split('/');
          return '.../' + parts.slice(-2).join('/');
        }
        return filePath;
      case 'Bash':
        const cmd = (input.command as string || '').slice(0, 60);
        return cmd + (cmd.length >= 60 ? '...' : '');
      case 'Grep':
        return `"${input.pattern || ''}"`;
      case 'Glob':
        return input.pattern as string || '';
      case 'Task':
        return (input.description as string || '').slice(0, 50);
      default:
        // Try to find any string parameter
        for (const [key, value] of Object.entries(input)) {
          if (typeof value === 'string' && value.length > 0 && value.length < 100) {
            return value.slice(0, 50);
          }
        }
        return '';
    }
  }

  /**
   * Remove speech bubble for an agent.
   */
  private removeSpeechBubble(agentId: string): void {
    const index = this.speechBubbles.findIndex(b => b.agentId === agentId);
    if (index !== -1) {
      const bubble = this.speechBubbles[index];
      this.scene.remove(bubble.sprite);
      bubble.sprite.material.map?.dispose();
      bubble.sprite.material.dispose();
      this.speechBubbles.splice(index, 1);
    }
  }

  /**
   * Create a move order effect at a position.
   */
  createMoveOrderEffect(position: THREE.Vector3): void {
    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y = 0.05;

    // Ground ring
    const ringGeometry = new THREE.RingGeometry(0.3, 0.4, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x4aff9e,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.name = 'ring';
    group.add(ring);

    // Pulse ring
    const pulseGeometry = new THREE.RingGeometry(0.1, 0.2, 32);
    const pulseMaterial = new THREE.MeshBasicMaterial({
      color: 0x4aff9e,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });
    const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial);
    pulse.rotation.x = -Math.PI / 2;
    pulse.name = 'pulse';
    group.add(pulse);

    // Chevrons
    const chevronShape = new THREE.Shape();
    chevronShape.moveTo(0, 0.15);
    chevronShape.lineTo(0.12, 0.35);
    chevronShape.lineTo(0.08, 0.35);
    chevronShape.lineTo(0, 0.2);
    chevronShape.lineTo(-0.08, 0.35);
    chevronShape.lineTo(-0.12, 0.35);
    chevronShape.closePath();

    const chevronGeometry = new THREE.ShapeGeometry(chevronShape);

    for (let i = 0; i < 3; i++) {
      const chevronMaterial = new THREE.MeshBasicMaterial({
        color: 0x4aff9e,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      });
      const chevron = new THREE.Mesh(chevronGeometry, chevronMaterial);
      chevron.rotation.x = -Math.PI / 2;
      chevron.position.y = 0.5 + i * 0.25;
      chevron.name = `chevron${i}`;
      group.add(chevron);
    }

    this.scene.add(group);
    this.moveOrderEffects.push({
      group,
      startTime: performance.now(),
      duration: 800,
    });
  }

  // Reference to camera for zoom-based scaling
  private camera: THREE.Camera | null = null;
  // User-configurable indicator scale
  private indicatorScale = 1.0;

  /**
   * Set user-configurable indicator scale.
   */
  setIndicatorScale(scale: number): void {
    this.indicatorScale = scale;
  }

  /**
   * Update all active effects.
   */
  update(): void {
    const now = performance.now();

    // Update move order effects
    this.updateMoveOrderEffects(now);

    // Update speech bubbles
    this.updateSpeechBubbles(now);

    // Update sleeping effects
    this.updateSleepingEffects();
  }

  /**
   * Update effects with camera reference for zoom-based scaling.
   */
  updateWithCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /**
   * Calculate zoom-based scale factor for an effect at a position.
   */
  private calculateZoomScale(position: THREE.Vector3): number {
    if (!this.camera) return this.indicatorScale;

    const distance = this.camera.position.distanceTo(position);
    const baseDistance = 15;

    // Scale factor: farther = larger, closer = smaller
    // Clamp between 0.5 and 2.5
    const zoomScale = Math.max(0.5, Math.min(2.5, distance / baseDistance));

    // Apply user's indicator scale setting
    return zoomScale * this.indicatorScale;
  }

  /**
   * Update sleeping effects animation.
   */
  private updateSleepingEffects(): void {
    const now = performance.now();

    for (const effect of this.sleepingEffects) {
      const agentGroup = this.agentMeshes.get(effect.agentId);
      if (!agentGroup) continue;

      const elapsed = now - effect.startTime;

      // Calculate zoom-based scale
      const zoomScale = this.calculateZoomScale(agentGroup.position);

      for (const sprite of effect.sprites) {
        // Follow agent position
        sprite.position.x = agentGroup.position.x + 0.25 * zoomScale;
        sprite.position.z = agentGroup.position.z;

        // Gentle floating animation
        const floatSpeed = 0.002;
        const floatAmount = 0.04 * zoomScale;
        sprite.position.y = 2.6 + Math.sin(elapsed * floatSpeed) * floatAmount;

        // Gentle scale pulse with zoom-based scaling - small but visible
        const scaleBase = 0.35 * zoomScale;
        const scalePulse = Math.sin(elapsed * 0.003) * 0.015 * zoomScale;
        sprite.scale.set(scaleBase + scalePulse, scaleBase + scalePulse, 1);

        // Fade in on creation
        const fadeIn = Math.min(elapsed / 500, 1);
        sprite.material.opacity = 0.95 * fadeIn;
      }
    }
  }

  /**
   * Update move order effects.
   */
  private updateMoveOrderEffects(now: number): void {
    const toRemove: number[] = [];

    for (let i = 0; i < this.moveOrderEffects.length; i++) {
      const effect = this.moveOrderEffects[i];
      const elapsed = now - effect.startTime;
      const t = Math.min(elapsed / effect.duration, 1);
      const opacity = 1 - t;

      const ring = effect.group.getObjectByName('ring') as THREE.Mesh;
      if (ring) {
        ring.scale.setScalar(1 + t * 1.5);
        (ring.material as THREE.MeshBasicMaterial).opacity = opacity * 0.8;
      }

      const pulse = effect.group.getObjectByName('pulse') as THREE.Mesh;
      if (pulse) {
        const pulseT = (Math.sin(t * Math.PI * 4) + 1) / 2;
        pulse.scale.setScalar(0.8 + pulseT * 0.4);
        (pulse.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
      }

      for (let j = 0; j < 3; j++) {
        const chevron = effect.group.getObjectByName(`chevron${j}`) as THREE.Mesh;
        if (chevron) {
          const delay = j * 0.15;
          const chevronT = Math.max(0, Math.min((t - delay) / (1 - delay), 1));
          chevron.position.y = 0.5 + j * 0.25 - chevronT * (0.4 + j * 0.15);
          (chevron.material as THREE.MeshBasicMaterial).opacity = (1 - chevronT) * 0.9;
        }
      }

      if (t >= 1) {
        toRemove.push(i);
      }
    }

    // Remove completed effects
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      this.disposeEffect(this.moveOrderEffects[idx]);
      this.moveOrderEffects.splice(idx, 1);
    }
  }

  /**
   * Update speech bubble effects.
   */
  private updateSpeechBubbles(now: number): void {
    const toRemove: number[] = [];

    for (let i = 0; i < this.speechBubbles.length; i++) {
      const bubble = this.speechBubbles[i];
      const elapsed = now - bubble.startTime;
      const t = Math.min(elapsed / bubble.duration, 1);

      // Follow agent position
      const agentGroup = this.agentMeshes.get(bubble.agentId);
      if (agentGroup) {
        bubble.sprite.position.x = agentGroup.position.x;
        bubble.sprite.position.z = agentGroup.position.z;

        // Calculate zoom-based scale
        const zoomScale = this.calculateZoomScale(agentGroup.position);

        // Apply zoom-based scaling (3:1 aspect ratio maintained)
        bubble.sprite.scale.set(2.1 * zoomScale, 0.7 * zoomScale, 1);
      }

      // Fade in/out and bob animation
      const fadeIn = Math.min(elapsed / 200, 1);
      const fadeOut = t > 0.7 ? 1 - ((t - 0.7) / 0.3) : 1;
      bubble.sprite.material.opacity = fadeIn * fadeOut;

      // Gentle bobbing
      const bob = Math.sin(elapsed * 0.003) * 0.05;
      bubble.sprite.position.y = bubble.baseY + bob;

      if (t >= 1) {
        toRemove.push(i);
      }
    }

    // Remove completed bubbles
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      const bubble = this.speechBubbles[idx];
      this.scene.remove(bubble.sprite);
      bubble.sprite.material.map?.dispose();
      bubble.sprite.material.dispose();
      this.speechBubbles.splice(idx, 1);
    }
  }

  /**
   * Dispose of an effect and its resources.
   */
  private disposeEffect(effect: MoveOrderEffect): void {
    this.scene.remove(effect.group);
    effect.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
  }

  /**
   * Remove all effects for a specific agent.
   */
  removeAgentEffects(agentId: string): void {
    // Remove sleeping effect
    this.removeSleepingEffect(agentId);

    // Remove speech bubble
    this.removeSpeechBubble(agentId);

    // Remove from agent meshes reference
    this.agentMeshes.delete(agentId);
  }

  /**
   * Clear all effects.
   */
  clear(): void {
    for (const effect of this.moveOrderEffects) {
      this.disposeEffect(effect);
    }
    this.moveOrderEffects = [];

    // Clear sleeping effects
    for (const effect of this.sleepingEffects) {
      for (const sprite of effect.sprites) {
        this.scene.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
    }
    this.sleepingEffects = [];
  }
}
