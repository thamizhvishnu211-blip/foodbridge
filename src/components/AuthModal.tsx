import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  mapFirebaseAuthError,
  signInWithGoogleDirect,
  signOutFirebase,
  syncFirestoreUserProfile,
} from '../firebase';
import { api } from '../services/api';
import type { User } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User, options?: { isNewUser?: boolean }) => void;
  subtitleOverride?: string;
}

function GoogleLogoSvg() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

function VerdoraMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" className="h-9 w-9 text-[#93C9A3]">
      <circle cx="20" cy="20" r="18.5" fill="#172620" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M27.5 12.5C20.5 12.5 14.5 17 14 25.5c5.5.2 11.5-2.8 13.5-13Z"
        fill="#2B7A58"
        fillOpacity="0.45"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M13 27.5c2.5-4.5 6.5-8 11.5-10.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AuthModal({ isOpen, onClose, onSuccess, subtitleOverride }: AuthModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setGoogleBusy(false);
      setError(null);
      setLegalDoc(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleBusy(true);
    try {
      const fbUser = await signInWithGoogleDirect();
      const idToken = await fbUser.getIdToken();
      const res = await api.loginWithFirebase(idToken);
      void syncFirestoreUserProfile(fbUser, res.user).catch(() => {
        // Non-blocking profile mirror
      });
      setGoogleBusy(false);
      onSuccess(res.user, { isNewUser: res.isNewUser });
      onClose();
    } catch (err) {
      // If backend blocked a suspended/deactivated account, also sign out local Firebase state
      await signOutFirebase();
      setGoogleBusy(false);
      setError(mapFirebaseAuthError(err));
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-screen-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-[#070D0B]"
    >
      {/* Subtle circular emerald radial glow + botanical geometric linework */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[#2B7A58]/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-[#93C9A3]/12 blur-3xl" />
        <svg
          viewBox="0 0 800 800"
          className="absolute right-0 top-0 h-full w-auto opacity-[0.06] text-[#93C9A3]"
          fill="none"
        >
          <circle cx="620" cy="180" r="240" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="620" cy="180" r="170" stroke="currentColor" strokeWidth="1" strokeDasharray="6 6" />
          <path
            d="M500 520c90-90 210-120 300-80-20 110-120 200-250 200-35 0-50-70-50-120Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </div>

      <div className="relative flex min-h-full flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-[440px] rounded-3xl border border-[#A9B78D]/25 bg-[#111C17] p-7 text-[#F4F7F4] shadow-2xl transition-all duration-300 sm:p-9">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <VerdoraMark />
              <span className="font-display text-lg font-semibold tracking-tight text-[#F4F7F4]">
                VERDORA
              </span>
            </div>
            <button
              type="button"
              aria-label="Close sign in screen"
              onClick={onClose}
              className="rounded-lg p-2 text-[#C8D6CD] transition-colors hover:bg-[#172620] hover:text-[#F4F7F4] cursor-pointer focus-ring"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-6">
            <h1
              id="auth-screen-title"
              className="font-display text-3xl font-semibold tracking-tight text-[#F4F7F4]"
            >
              Welcome to Verdora
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[#C8D6CD]">
              {subtitleOverride || 'One account. A smarter, more sustainable future.'}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-[#E06C75]/35 bg-[#361619] px-4 py-3 text-xs font-medium leading-relaxed text-[#FFB3B8]"
            >
              {error}
            </div>
          )}

          {legalDoc ? (
            <div className="mt-6 space-y-4">
              <button
                type="button"
                onClick={() => setLegalDoc(null)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#93C9A3] hover:underline cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to Sign In</span>
              </button>
              <div className="max-h-72 overflow-y-auto rounded-2xl border border-[#A9B78D]/20 bg-[#172620] p-4 text-xs leading-relaxed text-[#D2DDD6] space-y-2.5">
                <h2 className="font-display text-base font-semibold text-[#F4F7F4]">
                  {legalDoc === 'privacy' ? 'VERDORA Privacy Policy' : 'VERDORA Terms & Conditions'}
                </h2>
                {legalDoc === 'privacy' ? (
                  <>
                    <p>
                      VERDORA signs you in directly using your verified Google account and stores only
                      your name, verified email address, and profile image.
                    </p>
                    <p>
                      We never ask for separate passwords, never sell customer profiles, and protect
                      every session using verified Google tokens and HttpOnly server sessions.
                    </p>
                    <p>
                      You can manage your organization profile, circular economy category, and contact
                      preferences anytime inside your VERDORA Workspace.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      By signing into VERDORA with Google, you agree to list genuine circular
                      materials, surplus food donations, or used cooking oil quantities accurately and
                      in compliance with local food safety and environmental handling guidelines.
                    </p>
                    <p>
                      Administrative permissions and business verification badges are granted
                      exclusively by authorized platform administrators following review.
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-7 space-y-5">
              {/* Official Google Sign-In Button — Direct Entry */}
              <button
                type="button"
                onClick={() => void handleGoogleSignIn()}
                disabled={googleBusy}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/25 bg-white px-4 py-3.5 text-sm font-semibold text-[#1F1F1F] shadow-sm transition-all hover:bg-[#EBF2ED] disabled:opacity-65 cursor-pointer focus-ring"
              >
                {googleBusy ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin text-[#173D32]" />
                    <span>Signing in with Google...</span>
                  </>
                ) : (
                  <>
                    <GoogleLogoSvg />
                    <span>Continue with Google</span>
                  </>
                )}
              </button>

              <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#172620] p-4 space-y-2.5 text-xs text-[#D2DDD6]">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#93C9A3]" />
                  <span>
                    Instant entry with your Google account — no separate passwords or registration
                    forms required.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#93C9A3]" />
                  <span>
                    Returning users are recognized automatically with all listings, donations, and
                    business details preserved.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Legal footer */}
          <div className="mt-7 border-t border-[#A9B78D]/18 pt-4 text-center text-[11px] text-[#9BB0A3]">
            By continuing, you agree to VERDORA&apos;s{' '}
            <button
              type="button"
              onClick={() => setLegalDoc('terms')}
              className="font-semibold text-[#93C9A3] hover:underline cursor-pointer"
            >
              Terms and Conditions
            </button>{' '}
            and{' '}
            <button
              type="button"
              onClick={() => setLegalDoc('privacy')}
              className="font-semibold text-[#93C9A3] hover:underline cursor-pointer"
            >
              Privacy Policy
            </button>
            .
          </div>
        </div>
      </div>
    </div>
  );
}
