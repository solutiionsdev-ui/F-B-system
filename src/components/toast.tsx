"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";

type ToastInput = { title: string; description?: string; tone?: "success" | "info" };
type Toast = ToastInput & { id: number };

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

/** Returns a function that shows a toast, or null outside the app shell. */
export function useToast() {
  return useContext(ToastContext);
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useCallback(() => {
    timer.current = setTimeout(onClose, 4500);
  }, [onClose]);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  useEffect(() => {
    start();
    return stop;
  }, [start]);

  return (
    <div
      className="toast-in pointer-events-auto flex w-full items-start gap-3 rounded-2xl bg-ink p-4 text-white shadow-[0_12px_32px_-8px_rgba(0,0,0,0.35)]"
      onMouseEnter={stop}
      onMouseLeave={start}
    >
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          toast.tone === "info" ? "bg-sky-500" : "bg-emerald-500"
        }`}
      >
        <Icon name={toast.tone === "info" ? "info" : "check"} size={16} className="text-white" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-[13px] leading-5 text-stone-300">{toast.description}</p>}
      </div>
      <button type="button" onClick={onClose} className="-m-1 rounded-md p-1 text-stone-400 hover:text-white" aria-label="Dismiss">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((t: ToastInput) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { ...t, id }]);
  }, []);
  const remove = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  return (
    <ToastContext value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[360px]"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext>
  );
}
