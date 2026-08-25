const PINK = [254, 44, 85] as const;
const PURPLE = [168, 85, 247] as const;
const CYAN = [37, 244, 238] as const;
const WHITE = [255, 255, 255] as const;
const INK = [20, 24, 36] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function inRoundedRect(x: number, y: number, left: number, top: number, right: number, bottom: number, radius: number): boolean {
  const nearestX = clamp(x, left + radius, right - radius);
  const nearestY = clamp(y, top + radius, bottom - radius);
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function inCircle(x: number, y: number, centerX: number, centerY: number, radius: number): boolean {
  const dx = x - centerX;
  const dy = y - centerY;
  return dx * dx + dy * dy <= radius * radius;
}

function lerp(a: number, b: number, amount: number): number {
  return Math.round(a + (b - a) * amount);
}

function gradientColor(amount: number): readonly [number, number, number] {
  if (amount < 0.5) {
    const t = amount * 2;
    return [lerp(PINK[0], PURPLE[0], t), lerp(PINK[1], PURPLE[1], t), lerp(PINK[2], PURPLE[2], t)];
  }

  const t = (amount - 0.5) * 2;
  return [lerp(PURPLE[0], CYAN[0], t), lerp(PURPLE[1], CYAN[1], t), lerp(PURPLE[2], CYAN[2], t)];
}

function putPixel(rgba: Buffer, offset: number, color: readonly [number, number, number], alpha = 255): void {
  rgba[offset] = color[0];
  rgba[offset + 1] = color[1];
  rgba[offset + 2] = color[2];
  rgba[offset + 3] = alpha;
}

/**
 * The TikTools "pulse bubble" mark.
 *
 * It is intentionally rendered in code so the tray does not depend on a
 * platform-specific image decoder. The same shape is defined as SVG in the
 * WebView favicon.
 */
export function createAppIconRgba(size = 32): Buffer {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = size / 64;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x / scale;
      const py = y / scale;
      const offset = (y * size + x) * 4;

      if (!inRoundedRect(px, py, 3, 3, 61, 61, 17)) {
        putPixel(rgba, offset, [0, 0, 0], 0);
        continue;
      }

      const color = gradientColor((px + py) / 128);
      let pixelColor: readonly [number, number, number] = color;

      const bubble = inRoundedRect(px, py, 18, 18, 48, 45, 8);
      const tail = py >= 39 && py <= 52 && px >= 20 && px <= 30 && py >= 52 - (px - 20) * 0.9;
      if (bubble || tail) pixelColor = WHITE;

      if (inCircle(px, py, 42, 25, 3.2)) pixelColor = PINK;
      if (inRoundedRect(px, py, 25, 29, 40, 32, 1.5) || inRoundedRect(px, py, 25, 36, 36, 39, 1.5)) {
        pixelColor = INK;
      }

      putPixel(rgba, offset, pixelColor);
    }
  }

  return rgba;
}

/** Encode the shared mark as a multi-size Windows ICO for the compiled EXE. */
export function createAppIconIco(): Buffer {
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => createIcoImage(size));
  const directorySize = 6 + sizes.length * 16;
  const output = Buffer.alloc(directorySize + images.reduce((total, image) => total + image.length, 0));
  output.writeUInt16LE(0, 0);
  output.writeUInt16LE(1, 2);
  output.writeUInt16LE(sizes.length, 4);

  let imageOffset = directorySize;
  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index]!;
    const image = images[index]!;
    const entryOffset = 6 + index * 16;
    output[entryOffset] = size === 256 ? 0 : size;
    output[entryOffset + 1] = size === 256 ? 0 : size;
    output[entryOffset + 2] = 0;
    output[entryOffset + 3] = 0;
    output.writeUInt16LE(1, entryOffset + 4);
    output.writeUInt16LE(32, entryOffset + 6);
    output.writeUInt32LE(image.length, entryOffset + 8);
    output.writeUInt32LE(imageOffset, entryOffset + 12);
    image.copy(output, imageOffset);
    imageOffset += image.length;
  }

  return output;
}

function createIcoImage(size: number): Buffer {
  const rgba = createAppIconRgba(size);
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const pixelBytes = size * size * 4;
  const image = Buffer.alloc(40 + pixelBytes + maskRowBytes * size);
  image.writeUInt32LE(40, 0);
  image.writeInt32LE(size, 4);
  image.writeInt32LE(size * 2, 8);
  image.writeUInt16LE(1, 12);
  image.writeUInt16LE(32, 14);
  image.writeUInt32LE(0, 16);
  image.writeUInt32LE(pixelBytes, 20);
  image.writeInt32LE(0, 24);
  image.writeInt32LE(0, 28);
  image.writeUInt32LE(0, 32);
  image.writeUInt32LE(0, 36);

  for (let y = 0; y < size; y += 1) {
    const destinationRow = size - 1 - y;
    for (let x = 0; x < size; x += 1) {
      const sourceOffset = (y * size + x) * 4;
      const destinationOffset = 40 + (destinationRow * size + x) * 4;
      image[destinationOffset] = rgba[sourceOffset + 2]!;
      image[destinationOffset + 1] = rgba[sourceOffset + 1]!;
      image[destinationOffset + 2] = rgba[sourceOffset]!;
      image[destinationOffset + 3] = rgba[sourceOffset + 3]!;
      if (rgba[sourceOffset + 3] === 0) {
        const maskOffset = 40 + pixelBytes + destinationRow * maskRowBytes + Math.floor(x / 8);
        image[maskOffset] = image[maskOffset]! | (0x80 >> (x % 8));
      }
    }
  }

  return image;
}
