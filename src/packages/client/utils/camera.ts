const CAMERA_STORAGE_KEY = 'tide-camera-state';

export interface CameraState {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export function saveCameraState(
  position: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number }
): void {
  const state: CameraState = { position, target };
  localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(state));
}

export function loadCameraState(): CameraState | null {
  const saved = localStorage.getItem(CAMERA_STORAGE_KEY);
  if (!saved) return null;

  try {
    return JSON.parse(saved) as CameraState;
  } catch {
    return null;
  }
}
