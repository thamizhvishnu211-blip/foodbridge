import { useEffect, useState } from 'react';
import { MEDIA_ASSETS } from '../data/media';

interface VideoBackgroundProps {
  videoSrc?: string;
  posterSrc?: string;
  alt: string;
}

export function VideoBackground({
  videoSrc,
  posterSrc = MEDIA_ASSETS.heroForest,
  alt,
}: VideoBackgroundProps) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  const showVideo = Boolean(videoSrc) && !videoFailed && !prefersReducedMotion;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-[#0A110E]"
    >
      <img
        src={posterSrc}
        alt={alt}
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover object-center scale-[1.02] transition-transform duration-1000"
      />
      {showVideo && (
        <video
          className="absolute inset-0 h-full w-full object-cover object-center"
          autoPlay
          muted
          loop
          playsInline
          poster={posterSrc}
          onError={() => setVideoFailed(true)}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
      )}
      {/* Measured readability scrims ensuring WCAG AA text contrast */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#070E0B]/82 via-[#0A1410]/62 to-[#0A110E]" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#070E0B]/78 via-transparent to-[#0A110E]/45" />
    </div>
  );
}
