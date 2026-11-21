import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Keep Listing',
  tone = 'danger',
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setBusy(false);
      setError(null);
    }
  }, [isOpen, title, description]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#040806]/80 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-[#A9B78D]/25 bg-[#111C17] p-6 text-[#F4F7F4] shadow-2xl">
        <button
          type="button"
          aria-label="Close confirmation dialog"
          disabled={busy}
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-[#C8D6CD] hover:bg-[#172620] hover:text-white disabled:opacity-50 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 id="confirm-dialog-title" className="font-display text-xl font-semibold text-[#F4F7F4]">
          {title}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-[#C8D6CD]">{description}</p>

        {error && (
          <div className="mt-4 rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3.5 py-2.5 text-xs font-medium text-[#FFB3B8]">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-4 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] disabled:opacity-50 cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConfirm()}
            className={`rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-60 cursor-pointer ${
              tone === 'danger'
                ? 'border border-[#E06C75]/35 bg-[#361619] text-[#FFB3B8] hover:bg-[#4A1D21]'
                : 'bg-[#2B7A58] text-white hover:bg-[#348F68]'
            }`}
          >
            {busy ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
