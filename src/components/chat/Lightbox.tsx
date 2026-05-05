"use client";

/**
 * Lightbox — fullscreen image viewer triggered by a global custom event.
 *
 * Mounted once at AppShell level. Any image attachment can dispatch
 * `window.dispatchEvent(new CustomEvent("zl:lightbox", {detail:{url,filename}}))`
 * to open the modal. Esc, click-outside, and the close button dismiss it.
 */
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface ImageDetail {
  url: string;
  filename: string;
}

export function Lightbox() {
  const [image, setImage] = useState<ImageDetail | null>(null);

  useEffect(() => {
    const open = (e: Event) => {
      const detail = (e as CustomEvent<ImageDetail>).detail;
      if (detail?.url) setImage(detail);
    };
    window.addEventListener("zl:lightbox", open);
    return () => window.removeEventListener("zl:lightbox", open);
  }, []);

  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImage(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [image]);

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/85 p-6"
      onClick={() => setImage(null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={image.filename}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] max-w-[95vw] rounded-md object-contain shadow-2xl"
      />
      <div
        className="mt-3 flex items-center gap-3 text-sm text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate opacity-80">{image.filename}</span>
        <a
          href={image.url}
          download={image.filename}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-md bg-surface-100/80 px-2 py-1 text-xs hover:bg-surface-100"
        >
          <Download className="h-3 w-3" />
          Open original
        </a>
        <button
          onClick={() => setImage(null)}
          className="flex items-center gap-1 rounded-md bg-surface-100/80 px-2 py-1 text-xs hover:bg-surface-100"
        >
          <X className="h-3 w-3" />
          Close
        </button>
      </div>
    </div>
  );
}
