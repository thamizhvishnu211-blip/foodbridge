/**
 * Resolves a listing's image URL to a displayable source ONLY when it is a
 * real user-uploaded image (data URI or hosted HTTP/HTTPS image).
 * Legacy stock/AI preset tokens (e.g. "media:*") and "none" return null so no
 * AI-generated stock photos are displayed.
 */
export function resolveImageSrc(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === 'none' || trimmed.startsWith('media:')) {
    return null;
  }
  if (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/uploads/')
  ) {
    return trimmed;
  }
  return null;
}
