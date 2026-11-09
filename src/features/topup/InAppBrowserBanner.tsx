import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { inAppBrowserName } from "../../lib/inAppBrowser";

/** Shown only inside app web views (LinkedIn, Facebook, …), where Google blocks Google Pay. */
export function InAppBrowserBanner() {
  const [app] = useState(() => (typeof navigator === "undefined" ? null : inAppBrowserName(navigator.userAgent)));
  const [copied, setCopied] = useState<boolean | null>(null);
  if (!app) return null;
  const link = `${window.location.origin}/`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
      <p className="flex items-center gap-2 text-sm font-bold text-ink">
        <ExternalLink className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />
        Open in Chrome or Safari for Google Pay
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Google Pay does not work inside {app === "this app" ? "this app's" : `the ${app} app's`} built-in browser. Tap ⋯ and
        choose “Open in browser”, or copy the link.
      </p>
      <button
        type="button"
        onClick={copy}
        className="mt-3 flex min-h-[40px] items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-white active:bg-ink-muted"
      >
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {copied ? "Link copied" : "Copy link"}
      </button>
      {copied === false && <p className="mt-2 select-all break-all text-xs font-semibold text-ink">{link}</p>}
    </div>
  );
}
