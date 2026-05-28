/**
 * The Wash icon. Source: 16×16 pixel art (Pixelorama), served from
 * `public/images/wash-icon-16.png`. Rendered with
 * `image-rendering: pixelated` so the upscale stays crisp at any size
 * instead of bilinear-blurring into mush.
 *
 * Use this everywhere the Wash feature is referenced in the UI —
 * landing card, chat-bar quick action, sidebar floating button.
 * Replaces the previous `Droplets` lucide-react icon.
 */
export interface WashIconProps {
  /** Tailwind sizing classes (e.g. `w-5 h-5`). Defaults to `w-5 h-5`. */
  className?: string;
}

export function WashIcon({ className = 'w-5 h-5' }: WashIconProps) {
  return (
    <img
      src="/images/wash-icon-16.png"
      alt=""
      aria-hidden="true"
      className={className}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

export default WashIcon;
