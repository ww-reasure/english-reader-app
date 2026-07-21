export class RouteHistory {
  constructor(initialRoute = '#/chat') {
    this.entries = [initialRoute || '#/chat'];
    this.index = 0;
  }

  current() {
    return this.entries[this.index] || null;
  }

  record(route) {
    const next = route || '#/chat';
    if (next === this.current()) return this.current();
    const priorIndex = this.entries.slice(0, this.index + 1).lastIndexOf(next);
    if (priorIndex >= 0) {
      this.index = priorIndex;
      return this.current();
    }
    this.entries = [...this.entries.slice(0, this.index + 1), next];
    this.index = this.entries.length - 1;
    return this.current();
  }

  previous() {
    if (this.index === 0) return null;
    this.index -= 1;
    return this.current();
  }
}
