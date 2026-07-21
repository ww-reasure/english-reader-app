export class TooltipSession {
  currentId = 0;

  begin() {
    this.currentId += 1;
    return this.currentId;
  }

  dismiss() {
    this.currentId += 1;
  }

  isCurrent(id) {
    return id === this.currentId;
  }
}
