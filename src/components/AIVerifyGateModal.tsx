import { ArrowRight, CheckCircle2, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { ListingKind } from '../types';

interface AIVerifyGateModalProps {
  isOpen: boolean;
  listingType: ListingKind;
  onClose: () => void;
  onGoToAssistant: (listingType: ListingKind) => void;
}

const TYPE_LABELS: Record<ListingKind, string> = {
  material: 'Material Marketplace listing',
  food: 'Food Rescue donation',
  oil: 'Used Cooking Oil recovery lot',
};

export function AIVerifyGateModal({
  isOpen,
  listingType,
  onClose,
  onGoToAssistant,
}: AIVerifyGateModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-verify-gate-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#040806]/85 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-[#93C9A3]/30 bg-[#111C17] p-6 text-[#F4F7F4] shadow-2xl sm:p-8">
        <button
          type="button"
          aria-label="Close verification notice"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-2 text-[#C8D6CD] hover:bg-[#172620] hover:text-white cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[#93C9A3]/30 bg-[#172620] text-[#93C9A3]">
          <Sparkles className="h-6 w-6" />
        </div>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
          Verdora AI Listing Verification
        </p>

        <h2
          id="ai-verify-gate-title"
          className="mt-1.5 font-display text-2xl font-semibold text-[#F4F7F4] sm:text-3xl"
        >
          Let's verify your listing with Verdora AI!
        </h2>

        <p className="mt-3 text-sm leading-relaxed text-[#D2DDD6]">
          To keep Verdora safe, genuine, and free from duplicate or misleading posts, every new{' '}
          <span className="font-semibold text-[#F4F7F4]">{TYPE_LABELS[listingType]}</span> is
          guided and reviewed by Verdora AI before it goes live.
        </p>

        <ul className="mt-5 space-y-2.5 rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-4 text-xs text-[#D2DDD6]">
          <li className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#93C9A3]" />
            <span>Submit your item details, photos, pricing (₹ INR), and optional supporting evidence.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#93C9A3]" />
            <span>
              Verdora AI checks for duplicates, consistency, realistic pricing, and clear disclosures.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#93C9A3]" />
            <span>
              Publish immediately once verified, or submit additional evidence for human review.
            </span>
          </li>
        </ul>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-4 py-2.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onGoToAssistant(listingType);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2B7A58] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#348F68] cursor-pointer focus-ring"
          >
            <span>Go to AI Assistant</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
