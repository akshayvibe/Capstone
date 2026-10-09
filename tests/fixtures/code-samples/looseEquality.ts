function compare(a: unknown, b: unknown) {
  if (a == b) {
    return true;
  }
  return a != null;
}
