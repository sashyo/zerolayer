"use client";

interface TypingIndicatorProps {
  usernames: string[];
}

export function TypingIndicator({ usernames }: TypingIndicatorProps) {
  if (usernames.length === 0) return <div className="h-5" />;

  let label = "";
  if (usernames.length === 1) label = `${usernames[0]} is typing…`;
  else if (usernames.length === 2) label = `${usernames[0]} and ${usernames[1]} are typing…`;
  else label = `${usernames.slice(0, -1).join(", ")} and ${usernames[usernames.length - 1]} are typing…`;

  return (
    <div className="flex h-5 items-center gap-1 px-4 text-xs text-muted">
      {/* Animated dots */}
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      <span className="font-medium">{label}</span>
    </div>
  );
}
