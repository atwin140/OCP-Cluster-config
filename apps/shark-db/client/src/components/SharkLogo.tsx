/**
 * SharkLogo — custom inline SVG logo mark for Shark Database.
 * Geometric shark fin silhouette with dot-grid ocean texture.
 * Works at any size; uses currentColor for dark/light adaptability.
 */

interface SharkLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
}

export function SharkLogo({ size = 32, className = "", showText = true }: SharkLogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {/* Fin mark */}
      <svg
        aria-label="Shark Database logo"
        viewBox="0 0 40 40"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Ocean base */}
        <rect width="40" height="40" rx="8" fill="hsl(188 90% 48% / 0.12)" />
        {/* Shark fin silhouette */}
        <path
          d="M8 30 C10 22, 14 16, 20 10 C22 8, 24 9, 24 12 L24 22 C28 20, 34 22, 36 26 C36 28, 34 30, 32 30 Z"
          fill="hsl(188 90% 48%)"
          opacity="0.9"
        />
        {/* Water line */}
        <path
          d="M6 30 Q13 27 20 30 Q27 33 34 30"
          stroke="hsl(188 90% 48% / 0.5)"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
        {/* Bubbles */}
        <circle cx="28" cy="16" r="1.2" fill="hsl(188 90% 75% / 0.6)" />
        <circle cx="31" cy="20" r="0.8" fill="hsl(188 90% 75% / 0.4)" />
        <circle cx="26" cy="19" r="0.6" fill="hsl(188 90% 75% / 0.5)" />
      </svg>

      {showText && (
        <div className="flex flex-col leading-none">
          <span className="text-sm font-bold text-primary tracking-wide">SHARK</span>
          <span className="text-xs font-medium text-muted-foreground tracking-widest uppercase">
            Database
          </span>
        </div>
      )}
    </div>
  );
}
