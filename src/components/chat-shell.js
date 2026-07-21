/**
 * Keeps the chat page in an immersive, viewport-bound layout without
 * affecting the global navigation used by the rest of the application.
 */
export const ChatShell = {
  className: 'chat-shell-active',

  activate(documentRef = document) {
    documentRef.body.classList.add(this.className);
  },

  deactivate(documentRef = document) {
    documentRef.body.classList.remove(this.className);
  }
};
