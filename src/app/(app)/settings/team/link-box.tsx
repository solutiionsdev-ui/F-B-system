"use client";

import { useState, useSyncExternalStore } from "react";
import { buttonClass } from "@/components/ui";

const noop = () => () => {};

/** Shows a just-created invite link once, with copy and WhatsApp buttons. */
export function LinkBox({ path, email, orgName }: { path: string; email: string; orgName: string }) {
  const origin = useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => "",
  );
  const [copied, setCopied] = useState(false);
  const url = `${origin}${path}`;
  const message = `You're invited to join ${orgName} on FINCTRL. Open this link to set up your account: ${url}`;

  return (
    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <p className="text-emerald-900">
        Send this link to <span className="font-medium">{email}</span>. It works once and expires in 7 days.
      </p>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-md border border-emerald-200 bg-white px-2.5 py-1.5 font-mono text-xs text-stone-800"
        aria-label="Invitation link"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass("secondary")}
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? "Copied ✓" : "Copy link"}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass("secondary")}
        >
          Send on WhatsApp
        </a>
      </div>
    </div>
  );
}
