import { Upload, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { resolveImageSrc } from '../data/media';
import { auth } from '../firebase';
import { api } from '../services/api';
import { syncFoodDonationToFirestore } from '../services/firestoreSync';
import type { Category, FoodDonation, User } from '../types';
import { toLocalDateTimeInputValue } from '../utils/format';
import { compressImageDataUrlForFirestore } from '../utils/image';

export interface FoodDraftPrefill {
  title?: string;
  category?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  portions?: number;
  storageInfo?: string;
  packagingInfo?: string;
  allergens?: string;
  dietaryInfo?: string;
  imageUrl?: string;
}

interface FoodDonationFormModalProps {
  isOpen: boolean;
  user: User | null;
  categories: Category[];
  editingDonation: FoodDonation | null;
  draftPrefill?: FoodDraftPrefill | null;
  onClose: () => void;
  onSaved: (donation: FoodDonation, isEdit: boolean) => Promise<void> | void;
}

export function FoodDonationFormModal({
  isOpen,
  user,
  categories,
  editingDonation,
  draftPrefill,
  onClose,
  onSaved,
}: FoodDonationFormModalProps) {
  const foodCategories = useMemo(
    () => categories.filter((c) => c.type === 'food' && c.isActive),
    [categories]
  );

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Bakery items');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('12');
  const [unit, setUnit] = useState('kg');
  const [portions, setPortions] = useState('25');
  const [preparedAt, setPreparedAt] = useState('');
  const [pickupDeadline, setPickupDeadline] = useState('');
  const [storageInfo, setStorageInfo] = useState('');
  const [packagingInfo, setPackagingInfo] = useState('');
  const [allergens, setAllergens] = useState('');
  const [dietaryInfo, setDietaryInfo] = useState('Vegetarian');
  const [location, setLocation] = useState('');
  const [collectionInstructions, setCollectionInstructions] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [imageUrl, setImageUrl] = useState('none');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (editingDonation) {
      setTitle(editingDonation.title);
      setCategory(editingDonation.category);
      setDescription(editingDonation.description);
      setQuantity(String(editingDonation.quantity));
      setUnit(editingDonation.unit);
      setPortions(String(editingDonation.portions));
      setPreparedAt(
        editingDonation.preparedAt ? toLocalDateTimeInputValue(editingDonation.preparedAt) : ''
      );
      setPickupDeadline(toLocalDateTimeInputValue(editingDonation.pickupDeadline));
      setStorageInfo(editingDonation.storageInfo);
      setPackagingInfo(editingDonation.packagingInfo);
      setAllergens(editingDonation.allergens);
      setDietaryInfo(editingDonation.dietaryInfo);
      setLocation(editingDonation.location);
      setCollectionInstructions(editingDonation.collectionInstructions);
      setWhatsappNumber(editingDonation.whatsappNumber ?? '');
      setImageUrl(editingDonation.imageUrl);
    } else {
      setTitle(draftPrefill?.title ?? '');
      setCategory(draftPrefill?.category ?? (foodCategories[0]?.name || 'Bakery items'));
      setDescription(draftPrefill?.description ?? '');
      setQuantity(draftPrefill?.quantity !== undefined ? String(draftPrefill.quantity) : '12');
      setUnit(draftPrefill?.unit ?? 'kg');
      setPortions(draftPrefill?.portions !== undefined ? String(draftPrefill.portions) : '25');
      setPreparedAt(toLocalDateTimeInputValue(new Date()));
      setPickupDeadline(toLocalDateTimeInputValue(new Date(Date.now() + 5 * 3600_000)));
      setStorageInfo(draftPrefill?.storageInfo ?? '');
      setPackagingInfo(draftPrefill?.packagingInfo ?? '');
      setAllergens(draftPrefill?.allergens ?? '');
      setDietaryInfo(draftPrefill?.dietaryInfo ?? 'Vegetarian');
      setLocation(user?.location || '');
      setCollectionInstructions('');
      setWhatsappNumber(user?.whatsappNumber ?? '');
      setImageUrl(draftPrefill?.imageUrl ?? 'none');
    }
    setFormError(null);
    setSubmitting(false);
  }, [isOpen, editingDonation, draftPrefill, user?.id, foodCategories]);

  if (!isOpen || !editingDonation) return null;

  const hasCurrentCategory = foodCategories.some((c) => c.name === category);

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

    const parsedDeadline = pickupDeadline ? new Date(pickupDeadline) : null;
    if (!parsedDeadline || Number.isNaN(parsedDeadline.getTime())) {
      setFormError('Please enter a valid pickup deadline date and time.');
      return;
    }
    if (parsedDeadline.getTime() <= Date.now()) {
      setFormError('Pickup deadline must be in the future.');
      return;
    }

    const parsedPreparedAt = preparedAt.trim() ? new Date(preparedAt) : null;
    if (parsedPreparedAt && Number.isNaN(parsedPreparedAt.getTime())) {
      setFormError('Preparation date/time is invalid.');
      return;
    }

    setSubmitting(true);
    try {
      const optimizedImageUrl = await compressImageDataUrlForFirestore(imageUrl, 'none');
      const payload = {
        title: title.trim(),
        category,
        description: description.trim(),
        quantity: Number(quantity),
        unit: unit.trim(),
        portions: Number(portions),
        preparedAt: parsedPreparedAt ? parsedPreparedAt.toISOString() : null,
        pickupDeadline: parsedDeadline.toISOString(),
        availableUntil: parsedDeadline.toISOString(),
        storageInfo: storageInfo.trim(),
        packagingInfo: packagingInfo.trim(),
        allergens: allergens.trim(),
        dietaryInfo: dietaryInfo.trim(),
        location: location.trim(),
        collectionInstructions: collectionInstructions.trim(),
        whatsappNumber: whatsappNumber.trim() || null,
        imageUrl: optimizedImageUrl,
      };
      let savedDonation: FoodDonation;
      try {
        const res = await api.updateFoodDonation(editingDonation.id, payload);
        savedDonation = {
          ...res.donation,
          donorUid: res.donation.donorUid || auth.currentUser?.uid || user?.firebaseUid || undefined,
        };
      } catch (err) {
        if (
          editingDonation &&
          auth.currentUser &&
          err instanceof Error &&
          err.message.toLowerCase().includes('not found')
        ) {
          const claimed = Math.max(0, editingDonation.portions - editingDonation.remainingPortions);
          const nextPortions = Number(portions);
          savedDonation = {
            ...editingDonation,
            ...payload,
            portions: nextPortions,
            remainingPortions: Math.max(0, nextPortions - claimed),
            donorUid: editingDonation.donorUid || auth.currentUser.uid,
            updatedAt: new Date().toISOString(),
          };
        } else {
          throw err;
        }
      }
      await syncFoodDonationToFirestore(savedDonation);
      await onSaved(savedDonation, Boolean(editingDonation));
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save food donation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="donate-food-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#040806]/80 p-4 backdrop-blur-sm"
    >
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#A9B78D]/25 bg-[#111C17] p-6 text-[#F4F7F4] shadow-2xl sm:p-8">
        <button
          type="button"
          aria-label="Close food donation form"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-2 text-[#C8D6CD] hover:bg-[#172620] hover:text-[#F4F7F4] cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 id="donate-food-title" className="font-display text-2xl font-semibold text-[#F4F7F4]">
          Edit Surplus Food Donation
        </h2>
        <p className="mt-1 text-xs text-[#C8D6CD]">
          Only offer food handled safely. Disclose preparation time, storage, allergens, and pickup deadline.
        </p>

        {formError && (
          <div className="mt-4 rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3.5 py-2.5 text-xs font-medium text-[#FFB3B8]">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#D2DDD6]">Food Title</label>
            <input
              type="text"
              required
              minLength={3}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Fresh Sourdough Loaves & Seeded Rolls"
              className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3.5 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#D2DDD6]">Food Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
              >
                {!hasCurrentCategory && category && (
                  <option value={category}>{category}</option>
                )}
                {foodCategories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">Est. Quantity</label>
              <div className="mt-1 flex gap-1">
                <input
                  type="number"
                  required
                  min={0.1}
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-2.5 py-2 text-sm text-[#F4F7F4] tabular-nums focus-ring"
                />
                <input
                  type="text"
                  required
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-16 rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-2 py-2 text-sm text-[#F4F7F4] focus-ring"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">Portions</label>
              <input
                type="number"
                required
                min={1}
                step={1}
                value={portions}
                onChange={(e) => setPortions(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] tabular-nums focus-ring"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#D2DDD6]">Description</label>
            <textarea
              required
              minLength={10}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe items, freshness, and best distribution use..."
              className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3.5 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">
                Preparation Date / Time
              </label>
              <input
                type="datetime-local"
                value={preparedAt}
                onChange={(e) => setPreparedAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">
                Pickup Deadline *
              </label>
              <input
                type="datetime-local"
                required
                value={pickupDeadline}
                onChange={(e) => setPickupDeadline(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">
                Storage Conditions
              </label>
              <input
                type="text"
                required
                value={storageInfo}
                onChange={(e) => setStorageInfo(e.target.value)}
                placeholder="e.g., Refrigerated at 4°C or Ambient dry rack"
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">
                Packaging Information
              </label>
              <input
                type="text"
                required
                value={packagingInfo}
                onChange={(e) => setPackagingInfo(e.target.value)}
                placeholder="e.g., Sealed food-grade trays"
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">
                Known Allergens *
              </label>
              <input
                type="text"
                required
                value={allergens}
                onChange={(e) => setAllergens(e.target.value)}
                placeholder="e.g., Gluten, Dairy, Sesame (or None known)"
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">
                Dietary Information
              </label>
              <input
                type="text"
                value={dietaryInfo}
                onChange={(e) => setDietaryInfo(e.target.value)}
                placeholder="Vegetarian, Vegan, Gluten-Free"
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">
                Pickup Area / Neighborhood *
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Avoid exposing private home addresses"
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
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
              Collection Instructions
            </label>
            <input
              type="text"
              value={collectionInstructions}
              onChange={(e) => setCollectionInstructions(e.target.value)}
              placeholder="Service entrance details, container notes..."
              className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3.5 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
            />
          </div>

          <div className="rounded-xl border border-[#A9B78D]/20 bg-[#172620] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#D2DDD6]">Food Photo</span>
            </div>
            <div className="mt-3 flex items-center gap-4">
              {resolveImageSrc(imageUrl) ? (
                <img
                  src={resolveImageSrc(imageUrl)!}
                  alt="Food donation preview"
                  className="h-20 w-28 rounded-lg object-cover border border-[#A9B78D]/20"
                />
              ) : (
                <div className="flex h-20 w-28 items-center justify-center rounded-lg border border-dashed border-[#A9B78D]/25 bg-[#0D1612] text-[11px] text-[#9BB0A3]">
                  No photo
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label className="inline-flex items-center gap-2 rounded-lg border border-[#A9B78D]/30 bg-[#0D1612] px-3 py-1.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#111C17] cursor-pointer">
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
                {resolveImageSrc(imageUrl) && (
                  <button
                    type="button"
                    onClick={() => setImageUrl('none')}
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
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
