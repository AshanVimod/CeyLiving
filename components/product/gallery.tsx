"use client";

import Image from "next/image";
import { useState, ViewTransition } from "react";
import { photoUrl } from "@/lib/format";
import type { Photo } from "@/lib/types";
import { ZoomIcon } from "../ui/icons";

export function Gallery({ images, slug }: { images: Photo[]; slug: string }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const current = images[index] ?? images[0];
  if (!current) return null;

  function onMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!zoom || e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    setZoom({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 });
  }

  function toggleZoom(e: React.MouseEvent<HTMLButtonElement>) {
    if (zoom) return setZoom(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX ? ((e.clientX - rect.left) / rect.width) * 100 : 50;
    const y = e.clientY ? ((e.clientY - rect.top) / rect.height) * 100 : 50;
    setZoom({ x, y });
  }

  const mainImage = (
    <div className="relative aspect-[4/5] overflow-hidden rounded-[3px] bg-sage">
      <button
        type="button"
        onClick={toggleZoom}
        onPointerMove={onMove}
        onPointerLeave={() => setZoom(null)}
        aria-label={zoom ? "Zoom out" : "Zoom in on photo"}
        className={`absolute inset-0 block size-full ${zoom ? "cursor-zoom-out" : "cursor-zoom-in"}`}
      >
        <Image
          key={current.id}
          src={photoUrl(current.id)}
          alt={current.alt}
          fill
          priority={index === 0}
          sizes="(min-width: 1024px) 620px, 100vw"
          quality={75}
          className="object-cover transition-transform duration-300 ease-out animate-[scrim-in_300ms_ease-out]"
          style={zoom ? { transform: "scale(2)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
        />
      </button>
      <span
        className="pointer-events-none absolute right-3 bottom-3 grid size-10 place-items-center rounded-full bg-paper-raised/90 text-ink"
        aria-hidden="true"
      >
        <ZoomIcon size={18} />
      </span>
    </div>
  );

  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row">
      {images.length > 1 ? (
        <ul className="flex gap-2 sm:flex-col" aria-label="Product photos">
          {images.map((img, i) => (
            <li key={img.id}>
              <button
                type="button"
                onClick={() => {
                  setIndex(i);
                  setZoom(null);
                }}
                aria-label={`Show photo ${i + 1} of ${images.length}`}
                aria-current={i === index}
                className={`relative block h-20 w-16 overflow-hidden rounded-[3px] bg-sage ring-offset-2 ring-offset-paper transition-shadow ${
                  i === index ? "ring-2 ring-forest" : "opacity-75 hover:opacity-100"
                }`}
              >
                <Image src={photoUrl(img.id)} alt="" fill sizes="64px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex-1">
        {index === 0 ? <ViewTransition name={`product-${slug}`}>{mainImage}</ViewTransition> : mainImage}
      </div>
    </div>
  );
}
