import type { AgentClass } from '../../shared/types';

// Agent class visual configuration
export const AGENT_CLASS_CONFIG: Record<AgentClass, { icon: string; color: number; description: string }> = {
  scout: { icon: '🔍', color: 0x4a9eff, description: 'Explores and searches codebase' },
  builder: { icon: '🔨', color: 0xff9e4a, description: 'Creates and builds features' },
  debugger: { icon: '🐛', color: 0xff4a4a, description: 'Finds and fixes bugs' },
  architect: { icon: '📐', color: 0x9e4aff, description: 'Plans and designs systems' },
  warrior: { icon: '⚔️', color: 0xff4a9e, description: 'Tackles tough problems' },
  support: { icon: '💚', color: 0x4aff9e, description: 'Helps and assists others' },
};

// Default LOTR names for agents
export const LOTR_NAMES = [
  'Frodo', 'Sam', 'Gandalf', 'Aragorn', 'Legolas', 'Gimli',
  'Boromir', 'Merry', 'Pippin', 'Galadriel', 'Elrond', 'Arwen',
  'Faramir', 'Eowyn', 'Theoden', 'Eomer', 'Treebeard', 'Bilbo',
  'Thorin', 'Balin', 'Dwalin', 'Gloin', 'Bombur', 'Bofur',
  'Celeborn', 'Haldir', 'Glorfindel', 'Cirdan', 'Thranduil',
  'Radagast', 'Saruman', 'Sauron', 'Gollum', 'Shelob',
];

// Character model mapping for each agent class (Kenney Mini Characters)
export const AGENT_CLASS_MODELS: Record<AgentClass, string> = {
  scout: 'character-male-a.glb',
  builder: 'character-male-b.glb',
  debugger: 'character-female-a.glb',
  architect: 'character-male-c.glb',
  warrior: 'character-female-b.glb',
  support: 'character-female-c.glb',
};

// Character model display info for the selector
export const CHARACTER_MODELS: { id: AgentClass; model: string; name: string; gender: string }[] = [
  { id: 'scout', model: 'character-male-a.glb', name: 'Explorer', gender: 'Male' },
  { id: 'builder', model: 'character-male-b.glb', name: 'Crafter', gender: 'Male' },
  { id: 'architect', model: 'character-male-c.glb', name: 'Planner', gender: 'Male' },
  { id: 'debugger', model: 'character-female-a.glb', name: 'Analyst', gender: 'Female' },
  { id: 'warrior', model: 'character-female-b.glb', name: 'Fighter', gender: 'Female' },
  { id: 'support', model: 'character-female-c.glb', name: 'Healer', gender: 'Female' },
];

// Movement settings
export const MOVE_SPEED = 3; // Units per second
export const DRAG_THRESHOLD = 5; // Pixels before considered a drag
export const CAMERA_SAVE_INTERVAL = 1000; // Save camera every 1 second

// Formation settings
export const FORMATION_SPACING = 1.2;
