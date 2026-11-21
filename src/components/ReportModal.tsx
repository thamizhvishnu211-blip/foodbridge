import { X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { api } from '../services/api';

interface ReportModalProps {
  target: { type: 'material' | 'food' | 'oil' | 'user'; id: string; title: string } | null;
  onClose: () => void;
  onSubmitted: () => void;
}

const REASONS = [
  'Misleading or inaccurate description',
  'Incorrect quantity or unit',
  'Duplicate listing',
  'Suspicious or unsafe content',
  'Other concern',
];

export function ReportModal({ target, onClose, onSubmitted }: ReportModalProps) {
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!target) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.submitReport({
        targetType: target.type,
        targetId: target.id,
        targetTitle: target.title,
        reason,
        details,
      });
      onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#040806]/80 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-[#A9B78D]/25 bg-[#111C17] p-6 text-[#F4F7F4] shadow-2xl">
        <button
          type="button"
          aria-label="Close report dialog"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-2 text-[#C8D6CD] hover:bg-[#172620] hover:text-[#F4F7F4] cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 id="report-modal-title" className="font-display text-xl font-semibold text-[#F4F7F4]">
          Report Listing
        </h3>
        <p className="mt-1 text-xs text-[#C8D6CD]">
          Flag "{target.title}" for platform moderation review.
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3 py-2 text-xs text-[#FFB3B8]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-[#D2DDD6]">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#D2DDD6]">Additional Context</label>
            <textarea
              rows={3}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Share concrete details to help moderators review..."
              className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-4 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#348F68] disabled:opacity-60 cursor-pointer"
            >
              {busy ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
