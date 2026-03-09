import { createContext, useCallback, useContext, useMemo, useState } from "react";

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((t) => {
    const id = crypto?.randomUUID?.() || String(Date.now() + Math.random());
    const toast = { id, type: t.type || "info", title: t.title || "", message: t.message || "", ms: t.ms ?? 3500 };
    setToasts((p) => [toast, ...p]);

    window.setTimeout(() => {
      setToasts((p) => p.filter((x) => x.id !== id));
    }, toast.ms);

    return id;
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toastViewport">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.title ? <div className="toastTitle">{t.title}</div> : null}
            <div className="toastMsg">{t.message}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function ToastViewport() {
  return null; // host is rendered inside provider
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}