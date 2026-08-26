const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
]);

const MAX_DIMENSION = 8192;
const TARGET_BYTES = 4 * 1024 * 1024;
const THUMBNAIL_DIMENSION = 320;
const DEFAULT_READABLE_FLOOR = 640;
const QUALITY_STEPS = [0.9, 0.84, 0.78, 0.7];

function processorError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeMimeType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function isBlobLike(value) {
  return Boolean(value && typeof value.size === 'number' && typeof value.arrayBuffer === 'function');
}

function normalizeOrientation(value) {
  const orientation = Number(value);
  return Number.isInteger(orientation) && orientation >= 1 && orientation <= 8 ? orientation : 1;
}

function orientedDimensions(width, height, orientation) {
  const swapsAxes = orientation >= 5 && orientation <= 8;
  return swapsAxes
    ? { width: height, height: width }
    : { width, height };
}

function validDimensions(width, height) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function fitDimensions(width, height, maxDimension) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function nextReducedDimensions(dimensions, targetBytes, actualBytes, readableFloor) {
  const longest = Math.max(dimensions.width, dimensions.height);
  if (longest <= readableFloor) return null;

  const compressionScale = Number.isFinite(actualBytes) && actualBytes > targetBytes
    ? Math.sqrt(targetBytes / actualBytes) * 0.92
    : 0.82;
  const floorScale = readableFloor / longest;
  const scale = Math.max(floorScale, Math.min(0.82, compressionScale));
  const reduced = {
    width: Math.max(1, Math.floor(dimensions.width * scale)),
    height: Math.max(1, Math.floor(dimensions.height * scale))
  };
  if (reduced.width === dimensions.width && reduced.height === dimensions.height) return null;
  return reduced;
}

function outputExtension(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function safeOutputFilename(filename, mimeType) {
  const leaf = String(filename || 'image')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  const stem = (leaf.replace(/\.[^.]+$/, '').trim() || 'image').slice(0, 120);
  return `${stem}.${outputExtension(mimeType)}`;
}

function canvasFor(width, height) {
  if (typeof globalThis.OffscreenCanvas === 'function') {
    return new globalThis.OffscreenCanvas(width, height);
  }
  if (globalThis.document?.createElement) {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw processorError('image_encode_failed');
}

function applyOrientationTransform(context, width, height, orientation) {
  switch (orientation) {
    case 2:
      context.translate(width, 0);
      context.scale(-1, 1);
      break;
    case 3:
      context.translate(width, height);
      context.rotate(Math.PI);
      break;
    case 4:
      context.translate(0, height);
      context.scale(1, -1);
      break;
    case 5:
      context.rotate(Math.PI / 2);
      context.scale(1, -1);
      break;
    case 6:
      context.rotate(Math.PI / 2);
      context.translate(0, -height);
      break;
    case 7:
      context.rotate(Math.PI / 2);
      context.translate(width, -height);
      context.scale(-1, 1);
      break;
    case 8:
      context.rotate(-Math.PI / 2);
      context.translate(-width, 0);
      break;
    default:
      break;
  }
}

function canvasToBlob(canvas, mimeType, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: mimeType, quality });
  }
  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(processorError('image_encode_failed'));
      }, mimeType, quality);
    });
  }
  throw processorError('image_encode_failed');
}

async function encodeBrowserImage(input) {
  const width = Math.max(1, Math.round(Number(input.width) || 0));
  const height = Math.max(1, Math.round(Number(input.height) || 0));
  const sourceWidth = Math.max(1, Number(input.sourceWidth) || width);
  const sourceHeight = Math.max(1, Number(input.sourceHeight) || height);
  const orientation = normalizeOrientation(input.orientation);
  const oriented = orientedDimensions(sourceWidth, sourceHeight, orientation);
  const canvas = canvasFor(width, height);
  const context = canvas.getContext('2d', { alpha: input.preserveTransparency !== false });
  if (!context) throw processorError('image_encode_failed');

  context.save();
  const scaleX = width / oriented.width;
  const scaleY = height / oriented.height;
  context.scale(scaleX, scaleY);
  applyOrientationTransform(context, sourceWidth, sourceHeight, orientation);
  context.drawImage(input.bitmap, 0, 0, sourceWidth, sourceHeight);
  context.restore();

  return canvasToBlob(canvas, input.mimeType, input.quality);
}

async function makeBrowserThumbnail(input) {
  const dimensions = fitDimensions(input.width, input.height, THUMBNAIL_DIMENSION);
  return encodeBrowserImage({
    ...input,
    width: dimensions.width,
    height: dimensions.height,
    quality: input.mimeType === 'image/png' ? undefined : 0.82
  });
}

async function decodeBrowserImage(file) {
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const bitmap = await globalThis.createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
        orientation: 1,
        hasTransparency: normalizeMimeType(file?.type) === 'image/png'
      };
    } catch (error) {
      try {
        const bitmap = await globalThis.createImageBitmap(file);
        return {
          bitmap,
          width: bitmap.width,
          height: bitmap.height,
          orientation: 1,
          hasTransparency: normalizeMimeType(file?.type) === 'image/png'
        };
      } catch {
        throw error;
      }
    }
  }

  if (typeof globalThis.Image !== 'function' || typeof globalThis.URL?.createObjectURL !== 'function') {
    throw processorError('image_decode_failed');
  }

  const url = globalThis.URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new globalThis.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(processorError('image_decode_failed'));
      element.src = url;
    });
    return {
      bitmap: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      orientation: 1,
      hasTransparency: normalizeMimeType(file?.type) === 'image/png'
    };
  } finally {
    globalThis.URL.revokeObjectURL?.(url);
  }
}

async function sha256Hex(blob) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw processorError('image_encode_failed');
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function encodeWithStableError(encode, input) {
  try {
    const blob = await encode(input);
    if (!isBlobLike(blob)) throw processorError('image_encode_failed');
    return blob;
  } catch (error) {
    if (error?.code === 'image_encode_failed') throw error;
    throw processorError('image_encode_failed');
  }
}

export function createChatImageProcessor({
  decode = decodeBrowserImage,
  encode = encodeBrowserImage,
  makeThumbnail = makeBrowserThumbnail,
  digestHex = sha256Hex
} = {}) {
  return {
    async process(file, options = {}) {
      const inputMimeType = normalizeMimeType(file?.type);
      if (!SUPPORTED_IMAGE_TYPES.has(inputMimeType)) {
        throw processorError('unsupported_image_type');
      }

      let decoded;
      try {
        decoded = await decode(file, options);
      } catch (error) {
        if (error?.code === 'image_decode_failed') throw error;
        throw processorError('image_decode_failed');
      }

      const bitmap = decoded?.bitmap;
      try {
        const sourceWidth = Number(decoded?.width || bitmap?.width);
        const sourceHeight = Number(decoded?.height || bitmap?.height);
        if (!validDimensions(sourceWidth, sourceHeight)) {
          throw processorError('image_decode_failed');
        }
        if (sourceWidth > MAX_DIMENSION || sourceHeight > MAX_DIMENSION) {
          throw processorError('image_dimension_exceeded');
        }

        const orientation = normalizeOrientation(decoded?.orientation);
        const oriented = orientedDimensions(sourceWidth, sourceHeight, orientation);
        const preserveTransparency = options.preserveTransparency
          ?? decoded?.hasTransparency
          ?? inputMimeType === 'image/png';
        const mimeType = preserveTransparency
          ? 'image/png'
          : inputMimeType === 'image/webp'
            ? 'image/webp'
            : 'image/jpeg';
        const readableFloor = Math.max(1, Number(options.readableFloor) || DEFAULT_READABLE_FLOOR);
        const targetBytes = Math.max(1, Number(options.targetBytes) || TARGET_BYTES);
        let dimensions = fitDimensions(oriented.width, oriented.height, MAX_DIMENSION);
        let blob = null;
        let quality = QUALITY_STEPS[QUALITY_STEPS.length - 1];

        while (!blob || blob.size > targetBytes) {
          blob = null;
          for (quality of QUALITY_STEPS) {
            blob = await encodeWithStableError(encode, {
              bitmap,
              width: dimensions.width,
              height: dimensions.height,
              sourceWidth,
              sourceHeight,
              orientation,
              mimeType,
              quality,
              stripMetadata: true,
              preserveTransparency,
              source: options.source || null
            });
            if (blob.size <= targetBytes) break;
          }
          if (blob.size <= targetBytes) break;
          const reduced = nextReducedDimensions(dimensions, targetBytes, blob.size, readableFloor);
          if (!reduced) throw processorError('processed_image_too_large');
          dimensions = reduced;
        }

        let thumbnailBlob;
        try {
          thumbnailBlob = await makeThumbnail({
            bitmap,
            width: dimensions.width,
            height: dimensions.height,
            sourceWidth,
            sourceHeight,
            orientation,
            mimeType,
            quality,
            maxDimension: THUMBNAIL_DIMENSION,
            stripMetadata: true,
            preserveTransparency
          });
        } catch {
          throw processorError('image_encode_failed');
        }
        if (!isBlobLike(thumbnailBlob)) throw processorError('image_encode_failed');

        let sha256;
        try {
          sha256 = await digestHex(blob);
        } catch {
          throw processorError('image_encode_failed');
        }

        const result = {
          blob,
          thumbnailBlob,
          mimeType,
          filename: safeOutputFilename(options.filename, mimeType),
          width: dimensions.width,
          height: dimensions.height,
          sizeBytes: blob.size,
          sha256: String(sha256 || ''),
          source: options.source || null
        };
        if (inputMimeType === 'image/gif') result.warning = 'animated_image_flattened';
        return result;
      } finally {
        bitmap?.close?.();
      }
    }
  };
}

export {
  decodeBrowserImage,
  encodeBrowserImage,
  makeBrowserThumbnail,
  sha256Hex,
  SUPPORTED_IMAGE_TYPES
};
