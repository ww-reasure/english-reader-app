export class HomeRequestGate {
  constructor() {
    this.version = 0;
  }

  begin() {
    this.version += 1;
    return this.version;
  }

  invalidate() {
    return this.begin();
  }

  isCurrent(version) {
    return this.version === version;
  }
}
