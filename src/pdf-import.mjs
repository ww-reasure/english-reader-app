const DEFAULT_TIMEOUTS = Object.freeze({
  loaderMs: 15_000,
  fileMs: 15_000,
  documentMs: 45_000,
  pageMs: 15_000,
  totalMs: 120_000
});

export const PDF_IMPORT_LIMITS = Object.freeze({
  ...DEFAULT_TIMEOUTS,
  maxPages: 500
});

let bundledPdfJsPromise = null;

export class PdfImportError extends Error {
  constructor(message, { code = 'parse_failed', phase = 'unknown', cause = null, page = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PdfImportError';
    this.code = code;
    this.phase = phase;
    if (page !== null && page !== undefined) this.page = page;
  }
}

function positiveTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeTimeouts(timeouts = {}) {
  return {
    loaderMs: positiveTimeout(timeouts.loaderMs, DEFAULT_TIMEOUTS.loaderMs),
    fileMs: positiveTimeout(timeouts.fileMs, DEFAULT_TIMEOUTS.fileMs),
    documentMs: positiveTimeout(timeouts.documentMs, DEFAULT_TIMEOUTS.documentMs),
    pageMs: positiveTimeout(timeouts.pageMs, DEFAULT_TIMEOUTS.pageMs),
    totalMs: positiveTimeout(timeouts.totalMs, DEFAULT_TIMEOUTS.totalMs)
  };
}

function report(progress, event) {
  try {
    progress?.(event);
  } catch {
    // Progress reporting is best effort and must never break PDF parsing.
  }
}

function safeCall(callback) {
  try {
    return callback?.();
  } catch {
    return undefined;
  }
}

function timeoutMessage(phase, page = null) {
  if (phase === 'loader') return 'PDF 解析器初始化超时，请检查网络后重试。';
  if (phase === 'file') return '读取 PDF 文件超时，请重试或选择较小的文件。';
  if (phase === 'document') return 'PDF 文档解析超时，文件可能过大或格式复杂。';
  if (phase === 'page' || phase === 'page_text') {
    return `PDF 第 ${page || '?'} 页读取超时，文件可能过大或格式复杂。`;
  }
  return 'PDF 解析超时，文件可能过大或格式复杂。';
}

function timeoutError(phase, page = null) {
  return new PdfImportError(timeoutMessage(phase, page), {
    code: 'timeout',
    phase,
    page
  });
}

function withTimeout(operation, timeoutMs, error, { onTimeout = null } = {}) {
  let timer = null;
  const pending = Promise.resolve().then(operation);
  const timeout = new Promise((_, reject) => {
    timer = globalThis.setTimeout(() => {
      safeCall(onTimeout);
      reject(error);
    }, timeoutMs);
    timer?.unref?.();
  });
  return Promise.race([pending, timeout]).finally(() => {
    if (timer) globalThis.clearTimeout(timer);
  });
}

function parserFromModule(module) {
  const candidate = module?.default?.getDocument ? module.default : module;
  if (!candidate || typeof candidate.getDocument !== 'function') {
    throw new PdfImportError('PDF 解析器加载失败，请重试。', {
      code: 'loader_failed',
      phase: 'loader'
    });
  }
  return candidate;
}

/**
 * Load the bundled PDF.js runtime and its worker. The imports stay lazy so a
 * normal app startup never pays the PDF parser cost.
 */
export async function loadBundledPdfJs() {
  if (globalThis.pdfjsLib?.getDocument) return globalThis.pdfjsLib;
  if (!bundledPdfJsPromise) {
    bundledPdfJsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.js'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.js?url')
    ]).then(([module, workerModule]) => {
      const pdfjsLib = parserFromModule(module);
      const workerSrc = workerModule?.default || workerModule;
      if (typeof workerSrc === 'string' && pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
      }
      return pdfjsLib;
    }).catch(error => {
      bundledPdfJsPromise = null;
      if (error instanceof PdfImportError) throw error;
      throw new PdfImportError('PDF 解析器加载失败，请重试。', {
        code: 'loader_failed',
        phase: 'loader',
        cause: error
      });
    });
  }
  return bundledPdfJsPromise;
}

function isWorkerFailure(error) {
  return /worker|fake worker|worker_src|setting up/i.test(String(error?.message || error || ''));
}

function normalizeParseError(error, phase, page = null) {
  if (error instanceof PdfImportError) return error;
  const message = String(error?.message || error || '').trim();
  if (/invalid pdf|invalidpdf|pdf structure|missing pdf/i.test(message)) {
    return new PdfImportError('PDF 文件格式无效或无法读取。', {
      code: 'invalid_pdf',
      phase,
      page,
      cause: error
    });
  }
  return new PdfImportError(message || 'PDF 解析失败，请重试。', {
    code: 'parse_failed',
    phase,
    page,
    cause: error
  });
}

export function createPdfImportService({
  loadPdfJs = loadBundledPdfJs,
  timeouts = {},
  maxPages = PDF_IMPORT_LIMITS.maxPages,
  onProgress = null
} = {}) {
  const limits = normalizeTimeouts(timeouts);
  const pageLimit = Math.max(1, Number.parseInt(maxPages, 10) || PDF_IMPORT_LIMITS.maxPages);
  let parserPromise = null;

  const loadParser = () => {
    if (!parserPromise) {
      parserPromise = withTimeout(
        loadPdfJs,
        limits.loaderMs,
        timeoutError('loader')
      ).catch(error => {
        parserPromise = null;
        throw normalizeParseError(error, 'loader');
      });
    }
    return parserPromise;
  };

  const extractText = async (file, { onProgress: progressOverride = null } = {}) => {
    const progress = progressOverride || onProgress;
    let activeCleanup = null;
    const emit = event => report(progress, event);

    const run = async () => {
      emit({ phase: 'loader', message: '正在准备 PDF 解析器…' });
      const pdfjsLib = await loadParser();

      emit({ phase: 'file', message: '正在读取 PDF 文件…' });
      let arrayBuffer;
      try {
        arrayBuffer = await withTimeout(
          () => file?.arrayBuffer?.(),
          limits.fileMs,
          timeoutError('file')
        );
      } catch (error) {
        throw normalizeParseError(error, 'file');
      }
      if (!(arrayBuffer instanceof ArrayBuffer) && !ArrayBuffer.isView(arrayBuffer)) {
        throw new PdfImportError('无法读取 PDF 文件内容。', { code: 'file_failed', phase: 'file' });
      }

      emit({ phase: 'document', message: '正在解析 PDF 文档…' });
      let loadingTask = null;
      let pdf = null;
      const loadDocument = async options => {
        loadingTask = pdfjsLib.getDocument(options);
        activeCleanup = () => {
          safeCall(() => loadingTask?.destroy?.());
          safeCall(() => pdf?.destroy?.());
        };
        return withTimeout(
          () => loadingTask.promise,
          limits.documentMs,
          timeoutError('document'),
          { onTimeout: activeCleanup }
        );
      };

      try {
        try {
          pdf = await loadDocument({ data: arrayBuffer });
        } catch (error) {
          if (!isWorkerFailure(error)) throw error;
          emit({ phase: 'document_fallback', message: '正在切换兼容解析模式…' });
          safeCall(() => loadingTask?.destroy?.());
          loadingTask = null;
          pdf = await loadDocument({ data: arrayBuffer, disableWorker: true });
        }
        if (!pdf || !Number.isSafeInteger(pdf.numPages) || pdf.numPages < 0) {
          throw new PdfImportError('PDF 文档无法读取页数。', { code: 'parse_failed', phase: 'document' });
        }
        if (pdf.numPages > pageLimit) {
          throw new PdfImportError(`PDF 页数过多（最多支持 ${pageLimit} 页）。`, {
            code: 'too_many_pages',
            phase: 'document'
          });
        }

        const pageTexts = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          emit({
            phase: 'page_text',
            page: pageNumber,
            totalPages: pdf.numPages,
            message: `正在读取第 ${pageNumber}/${pdf.numPages} 页…`
          });
          let page = null;
          try {
            page = await withTimeout(
              () => pdf.getPage(pageNumber),
              limits.pageMs,
              timeoutError('page', pageNumber)
            );
            const textContent = await withTimeout(
              () => page.getTextContent(),
              limits.pageMs,
              timeoutError('page_text', pageNumber),
              { onTimeout: () => safeCall(() => page?.cleanup?.()) }
            );
            const items = Array.isArray(textContent?.items) ? textContent.items : [];
            const pageText = items.map(item => String(item?.str || '')).join(' ');
            pageTexts.push(pageText);
          } catch (error) {
            throw normalizeParseError(error, error?.phase || 'page_text', pageNumber);
          } finally {
            safeCall(() => page?.cleanup?.());
          }
        }
        return pageTexts.length ? `${pageTexts.join('\n')}\n` : '';
      } catch (error) {
        throw normalizeParseError(error, error?.phase || 'document');
      } finally {
        activeCleanup = null;
        safeCall(() => pdf?.destroy?.());
      }
    };

    try {
      return await withTimeout(
        run,
        limits.totalMs,
        timeoutError('total'),
        { onTimeout: () => safeCall(() => activeCleanup?.()) }
      );
    } catch (error) {
      throw normalizeParseError(error, error?.phase || 'total');
    }
  };

  return Object.freeze({ extractText, loadParser });
}
