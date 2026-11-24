import heroVerdoraForest from '../assets/images/hero_verdora_forest_1794546468887.jpg';
import marketAluminiumSheets from '../assets/images/market_aluminium_sheets_1794546469126.jpg';
import marketWoodenPallets from '../assets/images/market_wooden_pallets_1794546469826.jpg';
import marketTextileRolls from '../assets/images/market_textile_rolls_1794546470417.jpg';
import foodRescueBakery from '../assets/images/food_rescue_bakery_1794546471213.jpg';
import foodRescueProduce from '../assets/images/food_rescue_produce_1794546471515.jpg';

export const MEDIA_ASSETS = {
  heroForest: heroVerdoraForest,
  aluminium: marketAluminiumSheets,
  wood: marketWoodenPallets,
  textile: marketTextileRolls,
  bakery: foodRescueBakery,
  produce: foodRescueProduce,
} as const;

const MEDIA_KEY_MAP: Record<string, string> = {
  'media:heroForest': heroVerdoraForest,
  'media:aluminium': marketAluminiumSheets,
  'media:wood': marketWoodenPallets,
  'media:textile': marketTextileRolls,
  'media:bakery': foodRescueBakery,
  'media:produce': foodRescueProduce,
};

export function resolveImageSrc(rawUrl?: string | null, fallbackKey: keyof typeof MEDIA_ASSETS = 'aluminium'): string {
  if (!rawUrl) return MEDIA_ASSETS[fallbackKey];
  if (MEDIA_KEY_MAP[rawUrl]) return MEDIA_KEY_MAP[rawUrl];
  if (rawUrl.startsWith('data:image/') || rawUrl.startsWith('/') || rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    return rawUrl;
  }
  return MEDIA_ASSETS[fallbackKey];
}
