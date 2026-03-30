/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState } from "react";

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [history, setHistory] = useState([]);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((t) => {
    const id = crypto?.randomUUID?.() || String(Date.now() + Math.random());
    const type = t.type || "info";
    const isUrgent = type === "urgent";
    const toast = {
      id,
      type,
      title: t.title || "",
      message: t.message || "",
      ms: t.ms ?? (isUrgent ? 5500 : type === "error" ? 4200 : 3500),
      placement: t.placement || (isUrgent ? "center" : "banner"),
      createdAt: Date.now(),
      read: false,
    };
    setToasts((p) => [toast, ...p]);
    setHistory((prev) => [toast, ...prev].slice(0, 40));

    window.setTimeout(() => {
      remove(id);
    }, toast.ms);

    return id;
  }, [remove]);

  const markAllRead = useCallback(() => {
    setHistory((prev) => prev.map((x) => ({ ...x, read: true })));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const unreadCount = history.reduce((sum, item) => sum + (item.read ? 0 : 1), 0);

  const api = useMemo(
    () => ({
      push,
      dismiss: remove,
      history,
      unreadCount,
      markAllRead,
      clearHistory,
    }),
    [push, remove, history, unreadCount, markAllRead, clearHistory]
  );
  const bannerToasts = toasts.filter((t) => t.placement !== "center");
  const criticalToasts = toasts.filter((t) => t.placement === "center");
  const activeCritical = criticalToasts[0] || null;

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toastViewport" aria-live="polite">
        {bannerToasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <div className="toastBody">
              {t.title ? <div className="toastTitle">{t.title}</div> : null}
              <div className="toastMsg">{t.message}</div>
            </div>
            <button className="toastCloseBtn" onClick={() => remove(t.id)} aria-label="Dismiss notification">
              ✕
            </button>
          </div>
        ))}
      </div>

      {activeCritical && (
        <div
          className="criticalToastBackdrop"
          role="alertdialog"
          aria-live="assertive"
          aria-modal="true"
          onClick={() => remove(activeCritical.id)}
        >
          <div className={`criticalToast criticalToast-${activeCritical.type}`} onClick={(e) => e.stopPropagation()}>
            <div className="criticalToastTitle">{activeCritical.title || "Notice"}</div>
            <div className="criticalToastMsg">{activeCritical.message}</div>
            {criticalToasts.length > 1 && (
              <div className="criticalToastQueue">
                {criticalToasts.length - 1} more alert{criticalToasts.length - 1 > 1 ? "s" : ""} pending
              </div>
            )}
            <div className="criticalToastActions">
              <button className="btn btn-primary" onClick={() => remove(activeCritical.id)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
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
