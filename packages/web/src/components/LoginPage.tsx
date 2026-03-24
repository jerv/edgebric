import { useEffect, useRef, useCallback } from "react";
import { getLoginUrl } from "@/lib/api";
import logoSrc from "../assets/logo.png";

interface Ripple {
  originX: number;
  originY: number;
  startTime: number;
  speed: number; // px per frame
  amplitude: number;
  wavelength: number;
  decay: number; // amplitude decay per px of radius
  maxRadius: number;
}

export function LoginPage() {
  return (
    <div className="h-screen w-screen relative overflow-hidden bg-white dark:bg-gray-950">
      <DotGrid />
      <div className="relative z-10 h-full flex items-center justify-center">
        <div className="bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm border border-slate-200 dark:border-gray-800 rounded-2xl shadow-lg px-10 py-12 text-center space-y-8">
          <div className="flex flex-col items-center gap-3">
            <img src={logoSrc} alt="Edgebric" className="w-16 h-16 rounded-2xl" />
            <div>
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-gray-100 tracking-tight">Edgebric</h1>
              <p className="text-sm text-slate-400 dark:text-gray-500 mt-2">Private knowledge. Quick access.</p>
            </div>
          </div>
          <a
            href={getLoginUrl()}
            className="inline-flex items-center gap-3 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl px-5 py-3 text-sm font-medium text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-900 hover:border-slate-300 dark:hover:border-gray-600 transition-all shadow-sm"
          >
            <GoogleIcon />
            Sign in with Google
          </a>
          <div className="flex items-center justify-center gap-3 text-xs text-slate-400 dark:text-gray-500">
            <a href="/privacy" className="hover:text-slate-600 dark:hover:text-gray-400 transition-colors">Privacy Policy</a>
            <span>·</span>
            <a href="/terms" className="hover:text-slate-600 dark:hover:text-gray-400 transition-colors">Terms of Service</a>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
    </svg>
  );
}

// ─── Animated Dot Grid with Ripple Physics ──────────────────────────────────

interface Dot {
  originX: number;
  originY: number;
  baseRadius: number;
}

function DotGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<Dot[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const animRef = useRef<number>(0);
  const frameRef = useRef<number>(0);
  const rippleTimerRef = useRef<number>(0);

  const SPACING = 32;
  const DOT_RADIUS = 1.4;
  const RIPPLE_INTERVAL_MIN = 90; // frames (~1.5s at 60fps)
  const RIPPLE_INTERVAL_MAX = 180; // frames (~3s)
  const MAX_RIPPLES = 8;

  const initDots = useCallback((width: number, height: number) => {
    const dots: Dot[] = [];
    const cols = Math.ceil(width / SPACING) + 1;
    const rows = Math.ceil(height / SPACING) + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        dots.push({
          originX: c * SPACING,
          originY: r * SPACING,
          baseRadius: DOT_RADIUS,
        });
      }
    }
    dotsRef.current = dots;
  }, []);

  const spawnRipple = useCallback(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ripple: Ripple = {
      originX: Math.random() * w,
      originY: Math.random() * h,
      startTime: frameRef.current,
      speed: 2.5 + Math.random() * 1.5, // px per frame
      amplitude: 4 + Math.random() * 3,
      wavelength: 60 + Math.random() * 40,
      decay: 0.003 + Math.random() * 0.001,
      maxRadius: Math.max(w, h) * 1.2,
    };
    ripplesRef.current.push(ripple);
    if (ripplesRef.current.length > MAX_RIPPLES) {
      ripplesRef.current.shift();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = window.innerWidth * dpr;
      canvas!.height = window.innerHeight * dpr;
      canvas!.style.width = window.innerWidth + "px";
      canvas!.style.height = window.innerHeight + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      initDots(window.innerWidth, window.innerHeight);
    }
    resize();
    window.addEventListener("resize", resize);

    // Schedule first ripple quickly
    rippleTimerRef.current = 30;

    function draw() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const frame = frameRef.current;
      ctx!.clearRect(0, 0, w, h);

      // Spawn ripples on timer
      rippleTimerRef.current--;
      if (rippleTimerRef.current <= 0) {
        spawnRipple();
        rippleTimerRef.current =
          RIPPLE_INTERVAL_MIN +
          Math.random() * (RIPPLE_INTERVAL_MAX - RIPPLE_INTERVAL_MIN);
      }

      // Prune dead ripples (wavefront past maxRadius and fully decayed)
      ripplesRef.current = ripplesRef.current.filter((r) => {
        const age = frame - r.startTime;
        const wavefrontRadius = age * r.speed;
        return wavefrontRadius < r.maxRadius + r.wavelength * 2;
      });

      const dots = dotsRef.current;
      const ripples = ripplesRef.current;
      const isDark = document.documentElement.classList.contains("dark");
      const dotColor = isDark ? "200, 200, 210" : "15, 23, 42";

      for (const dot of dots) {
        // Superposition: sum displacement from all active ripples
        let totalDisplacementX = 0;
        let totalDisplacementY = 0;
        let totalBrightness = 0;

        for (const ripple of ripples) {
          const dx = dot.originX - ripple.originX;
          const dy = dot.originY - ripple.originY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.01) continue; // skip origin dot

          const age = frame - ripple.startTime;
          const wavefrontRadius = age * ripple.speed;

          // Only affect dots near the wavefront (within ~1 wavelength behind it)
          const distFromFront = wavefrontRadius - dist;
          if (distFromFront < -ripple.wavelength * 0.5 || distFromFront > ripple.wavelength * 2) continue;

          // Wave equation: sinusoidal displacement
          const phase = ((dist - wavefrontRadius) / ripple.wavelength) * Math.PI * 2;
          const wave = Math.sin(phase);

          // Envelope: amplitude decays with distance from origin and fades in at wavefront
          const distDecay = Math.exp(-dist * ripple.decay);
          // Smooth fade-in as wavefront arrives
          const frontFade = distFromFront > 0
            ? Math.min(1, distFromFront / (ripple.wavelength * 0.5))
            : Math.max(0, 1 + distFromFront / (ripple.wavelength * 0.5));

          const envelope = ripple.amplitude * distDecay * frontFade;
          const displacement = wave * envelope;

          // Radial displacement: push dots outward from ripple origin
          const nx = dx / dist;
          const ny = dy / dist;
          totalDisplacementX += nx * displacement;
          totalDisplacementY += ny * displacement;
          totalBrightness += Math.abs(displacement) * 0.03;
        }

        const drawX = dot.originX + totalDisplacementX;
        const drawY = dot.originY + totalDisplacementY;

        // Scale radius based on displacement magnitude
        const dispMag = Math.sqrt(
          totalDisplacementX * totalDisplacementX +
          totalDisplacementY * totalDisplacementY
        );
        const radiusScale = 1 + Math.min(dispMag * 0.08, 0.8);
        const radius = dot.baseRadius * radiusScale;

        const baseAlpha = 0.17;
        const alpha = Math.min(0.6, baseAlpha + totalBrightness);

        ctx!.beginPath();
        ctx!.arc(drawX, drawY, radius, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${dotColor}, ${alpha})`;
        ctx!.fill();
      }

      frameRef.current++;
      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [initDots, spawnRipple]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
    />
  );
}
