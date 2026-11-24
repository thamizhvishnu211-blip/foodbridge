import { Upload, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { resolveImageSrc } from '../data/media';
import { auth } from '../firebase';
import { api } from '../services/api';
import { syncMaterialToFirestore } from '../services/firestoreSync';
import type { Category, MaterialListing, User } from '../types';
import { toLocalDateInputValue } from '../utils/format';
import { compressImageDataUrlForFirestore } from '../utils/image';

export interface MaterialDraftPrefill {
  title?: string;
  category?: string;
  description?: string;
  condition?: string;
  quantity?: number;
  unit?: string;
  indicativePrice?: number | null;
  reuseApplications?: string[];
  imageUrl?: string;
}

interface MaterialFormModalProps {
  isOpen: boolean;
  user: User | null;
  categories: Category[];
  editingListing: MaterialListing | null;
  draftPrefill?: MaterialDraftPrefill | null;
  onClose: () => void;
  onSaved: (listing: MaterialListing, isEdit: boolean) => Promise<void> | void;
}

const CONDITIONS = ['Unused Surplus', 'Like New', 'Good', 'Fair / Needs Cleaning'];
const IMAGE_PRESETS = [
  { label: 'Aluminium / Metal', value: 'media:aluminium' },
  { label: 'Timber / Pallets', value: 'media:wood' },
  { label: 'Textiles / Linen', value: 'media:textile' },
];

export function MaterialFormModal({
  isOpen,
  user,
  categories,
  editingListing,
  draftPrefill,
  onClose,
  onSaved,
}: MaterialFormModalProps) {
  const materialCategories = useMemo(
    () => categories.filter((c) => c.type === 'material' && c.isActive),
    [categories]
  );

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Aluminium');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('50');
  const [unit, setUnit] = useState('kg');
  const [condition, setCondition] = useState('Good');
  const [location, setLocation] = useState('');
  const [indicativePrice, setIndicativePrice] = useState('');
  const [availableUntil, setAvailableUntil] = useState('');
  const [pickupPreferences, setPickupPreferences] = useState('Weekday daytime loading bay pickup');
  const [reuseText, setReuseText] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [imageUrl, setImageUrl] = useState('media:aluminium');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (editingListing) {
      setTitle(editingListing.title);
      setCategory(editingListing.category);
      setDescription(editingListing.description);
      setQuantity(String(editingListing.quantity));
      setUnit(editingListing.unit);
      setCondition(editingListing.condition);
      setLocation(editingListing.location);
      setIndicativePrice(
        editingListing.indicativePrice !== null ? String(editingListing.indicativePrice) : ''
      );
      setAvailableUntil(toLocalDateInputValue(editingListing.availableUntil));
      setPickupPreferences(editingListing.pickupPreferences);
      setReuseText(editingListing.reuseApplications.join(', '));
      setWhatsappNumber(editingListing.whatsappNumber ?? '');
      setImageUrl(editingListing.imageUrl);
    } else {
      setTitle(draftPrefill?.title ?? '');
      setCategory(draftPrefill?.category ?? (materialCategories[0]?.name || 'Aluminium'));
      setDescription(draftPrefill?.description ?? '');
      setQuantity(draftPrefill?.quantity !== undefined ? String(draftPrefill.quantity) : '50');
      setUnit(draftPrefill?.unit ?? 'kg');
      setCondition(draftPrefill?.condition ?? 'Good');
      setLocation(user?.location || '');
      setIndicativePrice(
        draftPrefill?.indicativePrice !== undefined && draftPrefill?.indicativePrice !== null
          ? String(draftPrefill.indicativePrice)
          : ''
      );
      setAvailableUntil(toLocalDateInputValue(new Date(Date.now() + 21 * 86400_000)));
      setPickupPreferences('Weekday pickup preferred');
      setReuseText(draftPrefill?.reuseApplications?.join(', ') ?? '');
      setWhatsappNumber(user?.whatsappNumber ?? '');
      setImageUrl(draftPrefill?.imageUrl ?? 'media:aluminium');
    }
    setFormError(null);
    setSubmitting(false);
  }, [isOpen, editingListing, draftPrefill, user?.id, materialCategories]);

  if (!isOpen) return null;

  const hasCurrentCategory = materialCategories.some((c) => c.name === category);
  const hasCurrentCondition = CONDITIONS.includes(condition);

  const handleImageUpload = (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFormError('Please select a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setFormError('Image must be smaller than 4 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageUrl(reader.result);
        setFormError(null);
      }
    };
    reader.onerror = () => {
      setFormError('Could not read the selected image file.');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    const parsedDate = availableUntil ? new Date(`${availableUntil}T23:59:59`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
      setFormError('Please choose a valid Available Until date.');
      return;
    }

    setSubmitting(true);
    try {
      const optimizedImageUrl = await compressImageDataUrlForFirestore(imageUrl, 'media:aluminium');
      const payload = {
        title: title.trim(),
        category,
        description: description.trim(),
        quantity: Number(quantity),
        unit: unit.trim(),
        condition,
        location: location.trim(),
        indicativePrice: indicativePrice.trim() ? Number(indicativePrice) : null,
        availableUntil: parsedDate.toISOString(),
        pickupPreferences: pickupPreferences.trim(),
        reuseApplications: reuseText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        whatsappNumber: whatsappNumber.trim() || null,
        imageUrl: optimizedImageUrl,
      };
      let savedListing: MaterialListing;
      try {
        const res = editingListing
          ? await api.updateMaterial(editingListing.id, payload)
          : await api.createMaterial(payload);
        savedListing = {
          ...res.listing,
          sellerUid: res.listing.sellerUid || auth.currentUser?.uid || user?.firebaseUid || undefined,
        };
      } catch (err) {
        if (
          editingListing &&
          auth.currentUser &&
          err instanceof Error &&
          err.message.toLowerCase().includes('not found')
        ) {
          savedListing = {
            ...editingListing,
            ...payload,
            sellerUid: editingListing.sellerUid || auth.currentUser.uid,
            updatedAt: new Date().toISOString(),
          };
        } else {
          throw err;
        }
      }
      await syncMaterialToFirestore(savedListing);
      await onSaved(savedListing, Boolean(editingListing));
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save listing.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-material-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#040806]/80 p-4 backdrop-blur-sm"
    >
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#A9B78D]/25 bg-[#111C17] p-6 text-[#F4F7F4] shadow-2xl sm:p-8">
        <button
          type="button"
          aria-label="Close listing form"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-2 text-[#C8D6CD] hover:bg-[#172620] hover:text-white cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 id="create-material-title" className="font-display text-2xl font-semibold text-[#F4F7F4]">
          {editingListing ? 'Edit Material Listing' : 'Publish Reusable Material'}
        </h2>
        <p className="mt-1 text-xs text-[#C8D6CD]">
          Provide accurate quantities, condition, and pickup preferences. No payment gateway is used.
        </p>

        {formError && (
          <div className="mt-4 rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3.5 py-2.5 text-xs font-medium text-[#FFB3B8]">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#D2DDD6]">Material Title</label>
            <input
              type="text"
              required
              minLength={3}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Clean 6061 Aluminium Sheet Offcuts"
              className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3.5 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
              >
                {!hasCurrentCategory && category && (
                  <option value={category}>{category}</option>
                )}
                {materialCategories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">Quantity</label>
              <input
                type="number"
                required
                min={0.1}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] tabular-nums focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">Unit</label>
              <input
                type="text"
                required
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="kg, pallets, sheets, rolls"
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">Condition</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
              >
                {!hasCurrentCondition && condition && (
                  <option value={condition}>{condition}</option>
                )}
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">Location</label>
              <input
                type="text"
                required
                minLength={2}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, Neighborhood"
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">
                Indicative Price (Optional ₹ INR)
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={indicativePrice}
                onChange={(e) => setIndicativePrice(e.target.value)}
                placeholder="0 for free pickup"
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] tabular-nums focus-ring"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#D2DDD6]">Description</label>
            <textarea
              required
              minLength={10}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe dimensions, cleanliness, coatings, or storage..."
              className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3.5 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">Available Until</label>
              <input
                type="date"
                required
                value={availableUntil}
                onChange={(e) => setAvailableUntil(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">
                WhatsApp Number (Optional)
              </label>
              <input
                type="tel"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="+919876543210"
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#D2DDD6]">
              Reuse Applications (Comma-separated)
            </label>
            <input
              type="text"
              value={reuseText}
              onChange={(e) => setReuseText(e.target.value)}
              placeholder="Brackets, furniture frames, signage"
              className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3.5 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#D2DDD6]">
              Pickup Preferences
            </label>
            <input
              type="text"
              value={pickupPreferences}
              onChange={(e) => setPickupPreferences(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3.5 py-2 text-sm text-[#F4F7F4] focus-ring"
            />
          </div>

          {/* Image Upload & Preview */}
          <div className="rounded-xl border border-[#A9B78D]/20 bg-[#172620] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#F4F7F4]">Listing Image</span>
              <div className="flex flex-wrap gap-2">
                {IMAGE_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setImageUrl(p.value)}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer ${
                      imageUrl === p.value
                        ? 'bg-[#2B7A58] text-white'
                        : 'bg-[#0D1612] text-[#C8D6CD] hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-4">
              <img
                src={resolveImageSrc(imageUrl, 'aluminium')}
                alt="Listing preview"
                className="h-20 w-28 rounded-lg object-cover border border-[#A9B78D]/20"
              />
              <div className="flex flex-col gap-2">
                <label className="inline-flex items-center gap-2 rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-1.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer">
                  <Upload className="h-3.5 w-3.5 text-[#93C9A3]" />
                  <span>Upload Photo</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.currentTarget.value = '';
                      handleImageUpload(file);
                    }}
                  />
                </label>
                {imageUrl.startsWith('data:image/') && (
                  <button
                    type="button"
                    onClick={() => setImageUrl('media:aluminium')}
                    className="text-left text-xs text-[#FCA5A5] hover:underline cursor-pointer"
                  >
                    Remove uploaded photo
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-4 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#2B7A58] px-5 py-2 text-xs font-semibold text-white hover:bg-[#348F68] disabled:opacity-60 cursor-pointer"
            >
              {submitting
                ? 'Saving...'
                : editingListing
                  ? 'Save Changes'
                  : 'Publish Listing'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
