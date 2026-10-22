/** The packaged preload owns this handle, shared with the application only. */
export async function shutdownSdk(): Promise<void> {
  const sdk = (globalThis as Record<symbol, { shutdown(): Promise<void> } | undefined>)[Symbol.for('quiver.otel.sdk')];
  await sdk?.shutdown();
}
