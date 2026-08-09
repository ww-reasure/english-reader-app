import { App } from '@capacitor/app';
import { AppShell } from './app-shell.js';
import { Tooltip } from './tooltip.js';
import { Modal } from './modal.js';
import { WordStudyDetail } from './word-study-detail.js';

const isOpen = element => element && element.style.display !== 'none';

function dismissTransient() {
  if (AppShell.closeDrawer()) return true;
  if (WordStudyDetail.close()) return true;
  if (Tooltip.isVisible()) {
    Tooltip.hide();
    return true;
  }
  const visibleOverlay = [...document.querySelectorAll('.modal-overlay')]
    .reverse()
    .find(isOpen);
  if (!visibleOverlay) return false;
  if (visibleOverlay.id === 'apiKeyModal') Modal.hideApiSettings();
  else if (visibleOverlay.id === 'importModal') Modal.hideImport();
  else if (visibleOverlay.id === 'readingSummary') visibleOverlay.style.display = 'none';
  else if (visibleOverlay.id === 'examAnswerCardOverlay') visibleOverlay.querySelector('#examAnswerCardClose')?.click();
  else visibleOverlay.remove();
  return true;
}

export async function installNativeNavigation(router) {
  const handle = await App.addListener('backButton', async () => {
    if (dismissTransient()) return;
    if (router.back()) return;
    await App.minimizeApp();
  });
  return () => handle.remove();
}
