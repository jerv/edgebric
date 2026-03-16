import { useEffect, useRef, useCallback } from "react";

export function LoginPage() {
  return (
    <div className="h-screen w-screen relative overflow-hidden bg-white">
      <DotGrid />
      <div className="relative z-10 h-full flex items-center justify-center">
        <div className="bg-white/80 backdrop-blur-sm border border-slate-200 rounded-2xl shadow-lg px-10 py-12 text-center space-y-8">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Edgebric</h1>
            <p className="text-sm text-slate-400 mt-2">Private knowledge. Quick access.</p>
          </div>
          <a
            href="/api/auth/login"
            className="inline-flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
          >
            <GoogleIcon />
            Sign in with Google
          </a>
          <div className="flex items-center justify-center gap-3 text-xs text-slate-400">
            <a href="/privacy" className="hover:text-slate-600 transition-colors">Privacy Policy</a>
            <span>·</span>
            <a href="/terms" className="hover:text-slate-600 transition-colors">Terms of Service</a>
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

// ─── Animated Dot Grid ──────────────────────────────────────────────────────

interface Dot {
  x: number;
  y: number;
  originX: number;
  originY: number;
  vx: number;
  vy: number;
  baseRadius: number;
  radius: number;
  pulsePhase: number;
  pulseSpeed: number;
  isPulsing: boolean;
  pulseTimer: number;
}

function DotGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const dotsRef = useRef<Dot[]>([]);
  const animRef = useRef<number>(0);

  const SPACING = 32;
  const DOT_RADIUS = 1.4;
  const REPEL_RADIUS = 100;
  const REPEL_FORCE = 6;
  const SPRING = 0.08;
  const DAMPING = 0.75;

  const initDots = useCallback((width: number, height: number) => {
    const dots: Dot[] = [];
    const cols = Math.ceil(width / SPACING) + 1;
    const rows = Math.ceil(height / SPACING) + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * SPACING;
        const y = r * SPACING;
        dots.push({
          x,
          y,
          originX: x,
          originY: y,
          vx: 0,
          vy: 0,
          baseRadius: DOT_RADIUS,
          radius: DOT_RADIUS,
          pulsePhase: Math.random() * Math.PI * 2,
          pulseSpeed: 0.01 + Math.random() * 0.015,
          isPulsing: Math.random() < 0.08,
          pulseTimer: Math.random() * 600,
        });
      }
    }
    dotsRef.current = dots;
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

    function onMouseMove(e: MouseEvent) {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    }
    function onMouseLeave() {
      mouseRef.current = { x: -1000, y: -1000 };
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);

    function draw() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx!.clearRect(0, 0, w, h);
      const { x: mx, y: my } = mouseRef.current;
      const dots = dotsRef.current;

      for (const dot of dots) {
        // Mouse repulsion — push dots away from cursor
        const dx = dot.x - mx;
        const dy = dot.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < REPEL_RADIUS && dist > 0) {
          const force = (1 - dist / REPEL_RADIUS) * REPEL_FORCE;
          dot.vx += (dx / dist) * force;
          dot.vy += (dy / dist) * force;
        }

        // Spring back to origin
        dot.vx += (dot.originX - dot.x) * SPRING;
        dot.vy += (dot.originY - dot.y) * SPRING;

        // Damping
        dot.vx *= DAMPING;
        dot.vy *= DAMPING;

        // Apply velocity
        dot.x += dot.vx;
        dot.y += dot.vy;

        // Pulsing nodes
        dot.pulseTimer += 1;
        if (dot.pulseTimer > 600 + Math.random() * 400) {
          dot.isPulsing = Math.random() < 0.08;
          dot.pulseTimer = 0;
        }

        let pulseScale = 1;
        if (dot.isPulsing) {
          dot.pulsePhase += dot.pulseSpeed;
          pulseScale = 1 + Math.sin(dot.pulsePhase) * 0.6;
        }

        dot.radius = dot.baseRadius * pulseScale;

        // Dot opacity
        const baseAlpha = 0.17;
        const pulseAlpha = dot.isPulsing ? Math.sin(dot.pulsePhase) * 0.15 : 0;
        const alpha = Math.min(1, baseAlpha + pulseAlpha);

        ctx!.beginPath();
        ctx!.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(15, 23, 42, ${alpha})`;
        ctx!.fill();
      }

      // Draw subtle connections between pulsing nodes
      const pulsingDots = dots.filter((d) => d.isPulsing);
      for (let i = 0; i < pulsingDots.length; i++) {
        for (let j = i + 1; j < pulsingDots.length; j++) {
          const a = pulsingDots[i]!;
          const b = pulsingDots[j]!;
          const ddx = a.x - b.x;
          const ddy = a.y - b.y;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < SPACING * 3) {
            const lineAlpha = 0.05 * (1 - d / (SPACING * 3));
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.strokeStyle = `rgba(15, 23, 42, ${lineAlpha})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [initDots]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
    />
  );
}
