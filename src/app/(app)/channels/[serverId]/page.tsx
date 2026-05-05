"use client";

import { Hash } from "lucide-react";

export default function ServerHomePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-400">
        <Hash className="h-10 w-10 text-muted" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-white">Welcome to the server!</h2>
        <p className="mt-1 text-muted">Select a channel from the sidebar to start chatting.</p>
      </div>
    </div>
  );
}
