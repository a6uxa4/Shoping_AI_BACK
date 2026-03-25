const sharp = require("sharp");

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const DEFAULT_FETCH_TIMEOUT_MS = 7000;

function stripDataUrlPrefix(s) {
  return String(s || "").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

function bufferFromBase64Image(base64OrDataUrl) {
  const cleaned = stripDataUrlPrefix(base64OrDataUrl).trim();
  if (!cleaned) return null;
  return Buffer.from(cleaned, "base64");
}

async function bufferFromImageInput(imageInput, opts = {}) {
  const input = String(imageInput || "").trim();
  if (!input) return null;

  if (input.startsWith("data:image/")) {
    return bufferFromBase64Image(input);
  }

  // If it's very long and looks like base64, accept it as raw base64.
  if (/^[A-Za-z0-9+/=\s]+$/.test(input) && input.length > 200) {
    return bufferFromBase64Image(input);
  }

  // Otherwise treat as URL.
  if (/^https?:\/\//i.test(input)) {
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(input, { signal: controller.signal });
      if (!res.ok) return null;

      const contentLength = res.headers.get("content-length");
      if (contentLength && Number(contentLength) > maxBytes) return null;

      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > maxBytes) return null;
      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  return null;
}

/**
 * Computes 64-bit dHash (9x8 grayscale adjacent comparisons) and returns hex (16 chars).
 */
async function computeDHashHex(imageBuffer) {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) return null;

  const { data } = await sharp(imageBuffer)
    .rotate() // respect EXIF orientation when present
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!data || data.length !== 9 * 8) return null;

  let bits = 0n;
  let bitPos = 0n;

  for (let y = 0; y < 8; y += 1) {
    const rowOffset = y * 9;
    for (let x = 0; x < 8; x += 1) {
      const left = data[rowOffset + x];
      const right = data[rowOffset + x + 1];
      if (left > right) {
        bits |= 1n << bitPos;
      }
      bitPos += 1n;
    }
  }

  // 64 bits => 16 hex chars
  return bits.toString(16).padStart(16, "0");
}

/**
 * Computes 64-bit pHash (DCT on 32x32 grayscale) and returns hex (16 chars).
 * More robust than dHash for many real-world photos.
 */
async function computePHashHex(imageBuffer) {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) return null;

  const { data } = await sharp(imageBuffer)
    .rotate()
    .resize(32, 32, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!data || data.length !== 32 * 32) return null;

  // Build 32x32 matrix
  const N = 32;
  const M = 8; // take top-left 8x8 DCT (excluding DC for median)
  const pix = new Array(N);
  for (let y = 0; y < N; y += 1) {
    const row = new Array(N);
    const offset = y * N;
    for (let x = 0; x < N; x += 1) row[x] = data[offset + x];
    pix[y] = row;
  }

  // Naive DCT (small sizes; acceptable at low volume)
  const dct = Array.from({ length: M }, () => Array.from({ length: M }, () => 0));
  for (let u = 0; u < M; u += 1) {
    for (let v = 0; v < M; v += 1) {
      let sum = 0;
      for (let y = 0; y < N; y += 1) {
        for (let x = 0; x < N; x += 1) {
          sum +=
            pix[y][x] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * N));
        }
      }
      const au = u === 0 ? 1 / Math.sqrt(2) : 1;
      const av = v === 0 ? 1 / Math.sqrt(2) : 1;
      dct[v][u] = (2 / N) * au * av * sum;
    }
  }

  // Median of coefficients excluding DC term (0,0)
  const coeffs = [];
  for (let v = 0; v < M; v += 1) {
    for (let u = 0; u < M; u += 1) {
      if (u === 0 && v === 0) continue;
      coeffs.push(dct[v][u]);
    }
  }
  coeffs.sort((a, b) => a - b);
  const median = coeffs[Math.floor(coeffs.length / 2)] ?? 0;

  let bits = 0n;
  let bitPos = 0n;
  for (let v = 0; v < M; v += 1) {
    for (let u = 0; u < M; u += 1) {
      const val = dct[v][u];
      if (val > median) bits |= 1n << bitPos;
      bitPos += 1n;
    }
  }

  return bits.toString(16).padStart(16, "0");
}

function hammingDistanceHex64(aHex, bHex) {
  if (!aHex || !bHex) return Number.POSITIVE_INFINITY;
  if (aHex.length !== 16 || bHex.length !== 16) return Number.POSITIVE_INFINITY;
  const a = BigInt("0x" + aHex);
  const b = BigInt("0x" + bHex);
  let x = a ^ b;
  let c = 0;
  while (x) {
    x &= x - 1n;
    c += 1;
  }
  return c;
}

function normalizeTypedHash(h) {
  const s = String(h || "").trim();
  if (!s) return null;
  if (/^(d|p):[0-9a-fA-F]{16}$/.test(s)) return s.toLowerCase();
  if (/^[0-9a-fA-F]{16}$/.test(s)) return "d:" + s.toLowerCase(); // legacy: treat as dHash
  return null;
}

function typedHammingDistance64(aTyped, bTyped) {
  const a = normalizeTypedHash(aTyped);
  const b = normalizeTypedHash(bTyped);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  if (a.slice(0, 2) !== b.slice(0, 2)) return Number.POSITIVE_INFINITY;
  return hammingDistanceHex64(a.slice(2), b.slice(2));
}

async function computeHashesForImages(images, opts = {}) {
  const arr = Array.isArray(images) ? images : [];
  const maxImages = Math.max(1, Math.min(10, Number(opts.maxImages ?? 3)));

  const hashes = [];
  for (const img of arr.slice(0, maxImages)) {
    try {
      const buf = await bufferFromImageInput(img, opts);
      if (!buf) continue;
      const dh = await computeDHashHex(buf);
      const ph = await computePHashHex(buf);
      if (dh) hashes.push("d:" + dh);
      if (ph) hashes.push("p:" + ph);
    } catch {
      // ignore per-image failures
    }
  }
  return hashes;
}

module.exports = {
  bufferFromImageInput,
  computeDHashHex,
  computePHashHex,
  computeHashesForImages,
  hammingDistanceHex64,
  typedHammingDistance64,
};

