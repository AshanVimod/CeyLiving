import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// SEC-06: security headers. Nonce-based CSP is incompatible with Partial Prerendering (see the Next.js CSP guide),
// so scripts allow 'unsafe-inline' for Next's inline bootstrap; everything else is locked to this site and the image CDN.
// B05b (AU-06): Cloudflare Turnstile loads its script and its check (an iframe) from challenges.cloudflare.com.
const turnstile = "https://challenges.cloudflare.com";
// B08: the pay page posts a form to PayHere's checkout (sandbox or live, read at build time like the rest of this).
const payhere = process.env.PAYHERE_MODE === "live" ? "https://www.payhere.lk" : "https://sandbox.payhere.lk";
// B09 (SEC-07): uploaded photos are shown from the image domain, and the browser sends uploads straight to R2's
// upload endpoint. Both are read at build time; lib/env.ts checks them when the server starts. In development the
// local driver serves both from this site ('self'). Unsplash stays for seed photos.
const imageOrigin = /^https?:\/\//.test(process.env.NEXT_PUBLIC_IMAGE_BASE_URL ?? "")
  ? ` ${new URL(process.env.NEXT_PUBLIC_IMAGE_BASE_URL!).origin}`
  : "";
const uploadOrigin =
  process.env.STORAGE_DRIVER === "r2" && process.env.R2_ACCOUNT_ID
    ? ` https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : "";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${turnstile}${isDev ? " 'unsafe-eval'" : ""}`,
  `frame-src ${turnstile}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://images.unsplash.com${imageOrigin}`,
  "font-src 'self'",
  `connect-src 'self'${uploadOrigin}${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self' ${payhere}`,
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  images: {
    // Uploaded photos come in fixed sizes from our image domain (B09); seed photos from a CDN that resizes on
    // request. The loader picks the right one, so Next's own image optimiser isn't used.
    loader: "custom",
    loaderFile: "./lib/image-loader.ts",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
