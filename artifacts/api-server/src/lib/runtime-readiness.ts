let ready = false;

export function markRuntimeReady(): void {
  ready = true;
}

export function markRuntimeNotReady(): void {
  ready = false;
}

export function isRuntimeReady(): boolean {
  return ready;
}