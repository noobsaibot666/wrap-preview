import { invoke, convertFileSrc } from "@tauri-apps/api/core";

export { convertFileSrc };

export function isTauriReloading(): boolean {
  if (typeof window === "undefined") return false;
  return window.__TAURI_RELOADING__ === true;
}

export async function invokeGuarded<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isTauriReloading()) {
    throw new Error("tauri reloading");
  }
  const result = await invoke<T>(command, args);
  if (isTauriReloading()) {
    throw new Error("tauri reloading");
  }
  return result;
}
