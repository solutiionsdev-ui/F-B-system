"use client";

// Step 1's upload: drop the Omega export on the box or pick it. Uploading only
// reads the file into a preview; nothing is posted until it's confirmed.
import { useRef, useState } from "react";
import { uploadForCloseAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Icon } from "@/components/icons";

const ACCEPT = ".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function Dropzone({ locationId, date }: { locationId: string; date: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  return (
    <ActionForm action={uploadForCloseAction} submitLabel="Upload and preview" pendingLabel="Reading the file…" className="space-y-3">
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="date" value={date} />
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const files = e.dataTransfer.files;
          if (!files.length || !input.current) return;
          input.current.files = files;
          setName(files[0].name);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
          over ? "border-brand-600 bg-brand-50" : name ? "border-stone-300 bg-stone-50" : "border-stone-200 bg-stone-50/60 hover:border-stone-300"
        } has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-500/15`}
      >
        <Icon name="import" size={22} className="text-stone-400" />
        {name ? (
          <span className="text-sm font-medium text-stone-900">{name}</span>
        ) : (
          <span className="text-sm text-stone-700">
            <span className="font-medium text-stone-900">Drop the Omega export here</span> or click to choose it
          </span>
        )}
        <span className="text-xs text-stone-500">CSV or Excel (.xlsx), up to 5 MB</span>
        <input
          ref={input}
          type="file"
          name="file"
          accept={ACCEPT}
          required
          className="sr-only"
          onChange={(e) => setName(e.currentTarget.files?.[0]?.name ?? null)}
        />
      </label>
    </ActionForm>
  );
}
