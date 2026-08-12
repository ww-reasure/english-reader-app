/**
 * Article PDF Export
 * Pure client-side A4 PDF generation (English only) via pdf-lib, plus a
 * save/share layer that behaves identically in Android WebView (Capacitor),
 * the HarmonyOS compatibility layer and plain web browsers. No Chinese text
 * is exported, so the built-in Times font family covers everything without
 * embedding a CJK font.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 595.28; // A4 width in points
const PAGE_HEIGHT = 841.89; // A4 height in points
const MARGIN = 56.7; // ~2cm
const TITLE_SIZE = 18;
const META_SIZE = 10;
const BODY_SIZE = 13;
const BODY_LINE_HEIGHT = 1.65;
const FOOTER_SIZE = 9;
const INK = rgb(0.12, 0.16, 0.15);
const MUTED = rgb(0.45, 0.5, 0.48);
const RULE = rgb(0.82, 0.78, 0.7);

const TRACK_LABELS = {
  cet4: 'CET-4',
  cet6: 'CET-6',
  kaoyan1: 'English I',
  kaoyan2: 'English II',
  graduate: 'Postgraduate',
  general: 'General'
};

const slugify = (value = '') => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60) || 'reading';

const pad2 = value => String(value).padStart(2, '0');

const formatDate = (value, now) => {
  const date = value ? new Date(value) : new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

/**
 * Pure layout model shared by rendering and tests: title, meta line, English
 * paragraphs and the sanitized file name. No PDF side effects.
 */
export function buildArticlePdfLayout(article = {}, { track = '', now = null } = {}) {
  const title = String(article?.title || '').trim() || 'Untitled';
  const content = String(article?.content || '');
  const wordCount = Number(article?.wordCount)
    || content.split(/\s+/).filter(Boolean).length;
  const date = formatDate(article?.createdAt || article?.updatedAt, now);
  const trackLabel = TRACK_LABELS[track] || (track ? String(track) : '');
  const meta = [`${wordCount} words`, date, trackLabel].filter(Boolean).join('  ·  ');
  const paragraphs = content.split(/\n\n+/).map(paragraph => paragraph.trim()).filter(Boolean);
  return {
    title,
    meta,
    paragraphs,
    fileName: `${slugify(title)}-${date || formatDate(null, now)}.pdf`
  };
}

function wrapText(text, font, size, maxWidth) {
  const lines = [];
  for (const rawLine of String(text || '').split('\n')) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      // A single word wider than the line is hard-broken by characters.
      let chunk = '';
      for (const character of word) {
        if (chunk && font.widthOfTextAtSize(chunk + character, size) > maxWidth) {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk += character;
        }
      }
      current = chunk;
    }
    if (current) lines.push(current);
  }
  return lines;
}

function toBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function triggerWebDownload(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Render the article to a standalone A4 PDF (Uint8Array). Title centered,
 * meta line and paragraphs left-aligned, page numbers in the footer.
 */
export async function renderArticlePdf(article, { track = '', now = null } = {}) {
  const layout = buildArticlePdfLayout(article, { track, now });
  const doc = await PDFDocument.create();
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const contentWidth = PAGE_WIDTH - MARGIN * 2;
  const firstLineIndent = BODY_SIZE * 2;
  const bodyStep = BODY_SIZE * BODY_LINE_HEIGHT;

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN;

  const ensureSpace = needed => {
    if (cursorY - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      cursorY = PAGE_HEIGHT - MARGIN;
    }
  };

  const titleLines = wrapText(layout.title, timesBold, TITLE_SIZE, contentWidth);
  for (const line of titleLines) {
    ensureSpace(TITLE_SIZE * 1.35);
    page.drawText(line, {
      x: (PAGE_WIDTH - timesBold.widthOfTextAtSize(line, TITLE_SIZE)) / 2,
      y: cursorY - TITLE_SIZE,
      size: TITLE_SIZE,
      font: timesBold,
      color: INK
    });
    cursorY -= TITLE_SIZE * 1.35;
  }

  if (layout.meta) {
    ensureSpace(META_SIZE * 1.8);
    page.drawText(layout.meta, {
      x: (PAGE_WIDTH - times.widthOfTextAtSize(layout.meta, META_SIZE)) / 2,
      y: cursorY - META_SIZE,
      size: META_SIZE,
      font: times,
      color: MUTED
    });
    cursorY -= META_SIZE * 1.8;
  }

  cursorY -= 6;
  ensureSpace(1);
  page.drawLine({
    start: { x: MARGIN, y: cursorY },
    end: { x: PAGE_WIDTH - MARGIN, y: cursorY },
    thickness: 0.6,
    color: RULE
  });
  cursorY -= 14;

  for (const paragraph of layout.paragraphs) {
    const lines = wrapText(paragraph, times, BODY_SIZE, contentWidth - firstLineIndent);
    lines.forEach((line, lineIndex) => {
      if (line) {
        ensureSpace(bodyStep);
        page.drawText(line, {
          x: MARGIN + (lineIndex === 0 ? firstLineIndent : 0),
          y: cursorY - BODY_SIZE,
          size: BODY_SIZE,
          font: times,
          color: INK
        });
      }
      cursorY -= bodyStep;
    });
    cursorY -= bodyStep * 0.55;
  }

  const pages = doc.getPages();
  pages.forEach((pageOfDoc, index) => {
    const label = `Page ${index + 1} of ${pages.length}`;
    pageOfDoc.drawText(label, {
      x: (PAGE_WIDTH - times.widthOfTextAtSize(label, FOOTER_SIZE)) / 2,
      y: 32,
      size: FOOTER_SIZE,
      font: times,
      color: MUTED
    });
  });

  return doc.save();
}

/**
 * Unified entry point: render then save/share. Native platforms write the PDF
 * to the cache directory and open the system share sheet; web triggers a
 * download. Injectable stubs keep the flow unit-testable.
 */
export async function exportArticlePdf(article, {
  track = '',
  platform = 'auto',
  now = null,
  fsImpl = null,
  shareImpl = null,
  downloadImpl = null
} = {}) {
  try {
    const bytes = await renderArticlePdf(article, { track, now });
    const fileName = buildArticlePdfLayout(article, { track, now }).fileName;
    let isNative = platform === 'native';
    if (platform === 'auto') {
      try {
        const { Capacitor } = await import('@capacitor/core');
        isNative = Boolean(Capacitor?.isNativePlatform?.());
      } catch {
        isNative = false;
      }
    }
    if (isNative) {
      const Filesystem = fsImpl || (await import('@capacitor/filesystem')).Filesystem;
      const Directory = (await import('@capacitor/filesystem')).Directory;
      const Share = shareImpl || (await import('@capacitor/share')).Share;
      const written = await Filesystem.writeFile({
        path: fileName,
        data: toBase64(bytes),
        directory: Directory.Cache
      });
      await Share.share({ title: fileName, files: [written.uri], dialogTitle: '导出 PDF' });
      return { ok: true, platform: 'native', path: written.uri, fileName, bytes };
    }
    if (typeof downloadImpl === 'function') {
      downloadImpl(bytes, fileName);
    } else if (typeof document !== 'undefined') {
      triggerWebDownload(bytes, fileName);
    }
    return { ok: true, platform: 'web', fileName, bytes };
  } catch (error) {
    return { ok: false, error: String(error?.message || error || '导出失败') };
  }
}