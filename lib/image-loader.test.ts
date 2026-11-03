import { describe, expect, it } from "vitest";
import imageLoader from "./image-loader";
import { applicationPhotoUrl, photoUrl } from "./photos";

const id = "upl_3f1c2b9a-1d2e-4f50-8a6b-0c9d8e7f6a5b";

describe("image loader", () => {
  it("SEC-07 B09 serves uploaded photos at the smallest made width that covers the slot", () => {
    const src = photoUrl(id);
    expect(src).toBe(`/dev-uploads/i/${id}/1600.webp`);
    expect(imageLoader({ src, width: 64 })).toBe(`/dev-uploads/i/${id}/400.webp`);
    expect(imageLoader({ src, width: 640 })).toBe(`/dev-uploads/i/${id}/800.webp`);
    expect(imageLoader({ src, width: 1200 })).toBe(`/dev-uploads/i/${id}/1600.webp`);
    expect(imageLoader({ src, width: 3840 })).toBe(`/dev-uploads/i/${id}/1600.webp`);
    expect(imageLoader({ src: applicationPhotoUrl(id), width: 200 })).toBe(`/uploads/private/${id}/400.webp`);
  });

  it("keeps resizing seed photos through the Unsplash CDN", () => {
    expect(imageLoader({ src: photoUrl("1786468539104-e03f3ae580ea"), width: 400 })).toBe(
      "https://images.unsplash.com/photo-1786468539104-e03f3ae580ea?auto=format&fit=max&w=400&q=72",
    );
    expect(applicationPhotoUrl("1786468539104-e03f3ae580ea")).toBe(
      "https://images.unsplash.com/photo-1786468539104-e03f3ae580ea",
    );
  });
});
