import type { ImgHTMLAttributes } from "react";
import { isAllowedImageUrl } from "@/lib/safe-urls";

/**
 * The picture renderer for markdown written by a model or a tool. A picture from a host we do not serve pictures from is not loaded (it
 * would be fetched the moment the text appears, carrying whatever the address contains); its description is shown instead.
 */
export default function SafeMarkdownImage({ src, alt }: ImgHTMLAttributes<HTMLImageElement>) {
  if (!isAllowedImageUrl(src)) {
    return <span className="opacity-70 italic">{alt ? `[image: ${alt}]` : "[image not shown]"}</span>;
  }
  return <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" className="max-w-full rounded-md" />;
}
