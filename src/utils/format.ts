import type { AccountType } from '../types';

export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (!/^\+?[1-9]\d{7,14}$/.test(cleaned)) return null;
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

export function buildWhatsAppUrl(
  phone: string | null | undefined,
  context: 'material' | 'food' | 'oil',
  itemTitle?: string
): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const digits = normalized.replace(/^\+/, '');
  const baseMessage =
    context === 'material'
      ? `Hi, I found your material listing${itemTitle ? ` "${itemTitle}"` : ''} on VERDORA. I am interested and would like to know more about the material, quantity, condition and pickup arrangements.`
      : context === 'oil'
        ? `Hi, I found your used cooking oil recovery lot${itemTitle ? ` "${itemTitle}"` : ''} on VERDORA. I would like to coordinate filtration verification, container exchange, and pickup.`
        : `Hi, I found your food donation${itemTitle ? ` "${itemTitle}"` : ''} on VERDORA. I would like to coordinate collection. Could you confirm availability, portions and collection timing?`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(baseMessage)}`;
}

export function formatINR(amount: number): string {
  const formatted = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
  }).format(amount);
  return `₹${formatted}`;
}

export function formatShortDate(iso?: string | null): string {
  if (!iso) return 'Not specified';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return 'Not specified';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function isExpiredDate(iso?: string | null): boolean {
  if (!iso) return false;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() < Date.now();
}

export function toLocalDateTimeInputValue(value?: Date | string | null): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toLocalDateInputValue(value?: Date | string | null): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatAccountType(type?: AccountType | string | null): string {
  switch (type) {
    case 'buyer':
      return 'Regular Customer / Buyer';
    case 'material_buyer':
      return 'Material Buyer';
    case 'material_supplier':
      return 'Material Supplier';
    case 'restaurant_donor':
      return 'Restaurant / Food Donor';
    case 'food_recipient':
      return 'Food Recipient / Organization';
    case 'industrial_buyer':
      return 'Industrial Material Buyer';
    case 'oil_collection_partner':
      return 'Oil Collection Partner';
    case 'recycling_processor':
      return 'Processing Industry';
    case 'general_user':
      return 'General User';
    case 'admin':
      return 'Platform Administrator';
    default:
      return 'Registered Member';
  }
}
