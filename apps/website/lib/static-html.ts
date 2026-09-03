import {readFile} from "node:fs/promises";
import path from "node:path";
import {websiteMetaTrackingEnabled} from "./meta-tracking";

const PUBLIC_ROOT = path.resolve(process.cwd(), "public");
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type StaticRuntimeConfig = {
  enabled: boolean;
  pixelId: string | null;
};

function staticRuntimeConfig(): StaticRuntimeConfig {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() ?? "";
  const enabled = websiteMetaTrackingEnabled(process.env)
    && /^\d{6,32}$/.test(pixelId);

  return {enabled, pixelId: enabled ? pixelId : null};
}

function inlineJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function injectPublicRuntime(html: string, config = staticRuntimeConfig()) {
  if (html.includes('data-all-season-privacy-runtime="script"')) return html;

  const runtime = [
    '<link rel="stylesheet" href="/privacy-runtime.css" data-all-season-privacy-runtime="styles">',
    `<script id="all-season-meta-config" type="application/json">${inlineJson(config)}</script>`,
    '<script defer src="/privacy-runtime.js" data-all-season-privacy-runtime="script"></script>',
  ].join("");

  if (!/<\/head>/i.test(html)) return html;
  return html.replace(/<\/head>/i, `${runtime}</head>`);
}

function safePublicPath(pathSegments: string[]) {
  if (
    pathSegments.length === 0
    || !pathSegments.every((segment) => SAFE_PATH_SEGMENT.test(segment))
  ) return null;

  const relativePath = path.join(...pathSegments);
  if (path.extname(relativePath) !== ".html") return null;

  const absolutePath = path.resolve(PUBLIC_ROOT, relativePath);
  const relativeToPublic = path.relative(PUBLIC_ROOT, absolutePath);
  if (!relativeToPublic || relativeToPublic.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToPublic)) {
    return null;
  }

  return absolutePath;
}

export async function renderPublicHtml(pathSegments: string[]) {
  const publicPath = safePublicPath(pathSegments);
  if (!publicPath) return null;

  try {
    const html = await readFile(publicPath, "utf8");
    return injectPublicRuntime(html);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
