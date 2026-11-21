const MAX_FIRESTORE_DATA_URL_CHARS = 520_000;

export async function compressImageDataUrlForFirestore(
  dataUrl: string,
  fallbackPreset = 'none'
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return dataUrl && !dataUrl.startsWith('media:') ? dataUrl : fallbackPreset;
  }
  if (dataUrl.length <= MAX_FIRESTORE_DATA_URL_CHARS) {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxDimension = 1024;
        let width = img.naturalWidth || 800;
        let height = img.naturalHeight || 600;
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(fallbackPreset);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        for (const quality of [0.82, 0.68, 0.52]) {
          const webp = canvas.toDataURL('image/webp', quality);
          if (webp.length <= MAX_FIRESTORE_DATA_URL_CHARS) {
            resolve(webp);
            return;
          }
          const jpeg = canvas.toDataURL('image/jpeg', quality);
          if (jpeg.length <= MAX_FIRESTORE_DATA_URL_CHARS) {
            resolve(jpeg);
            return;
          }
        }
        resolve(fallbackPreset);
      } catch {
        resolve(fallbackPreset);
      }
    };
    img.onerror = () => resolve(fallbackPreset);
    img.src = dataUrl;
  });
}
