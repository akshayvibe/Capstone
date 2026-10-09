function risky() {
  try {
    throw new Error('boom');
  } catch {
    // silently ignored
  }
}
