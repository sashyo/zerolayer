"use client";

/**
 * Avatar — renders a user's photo when one's available, otherwise a colored
 * circle with initials. The bg color uses the user's `accentColor` (if set)
 * so a user's profile theme follows them everywhere their avatar appears.
 */
import { cn } from "@/lib/utils";

interface AvatarProps {
  user: {
    id?: string;
    username?: string;
    displayName?: string;
    avatarUrl?: string | null;
    accentColor?: string | null;
  };
  size?: number; // pixel size of square; default 32
  className?: string;
  title?: string;
  fallbackBg?: string; // tailwind class fallback when no accent
}

export function Avatar({
  user,
  size = 32,
  className,
  title,
  fallbackBg = "bg-brand",
}: AvatarProps) {
  const display = user.displayName || user.username || "?";
  const initials = display.slice(0, 2).toUpperCase();
  const fontSize = size <= 24 ? 10 : size <= 32 ? 12 : size <= 40 ? 13 : 18;
  const inlineStyle = user.accentColor
    ? { background: user.accentColor, width: size, height: size, fontSize }
    : { width: size, height: size, fontSize };

  if (user.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt={display}
        title={title ?? display}
        style={{ width: size, height: size }}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }
  return (
    <div
      title={title ?? display}
      style={inlineStyle}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold text-white",
        !user.accentColor && fallbackBg,
        className,
      )}
    >
      {initials}
    </div>
  );
}
