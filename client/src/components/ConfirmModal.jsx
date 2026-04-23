import React from 'react';

export default function ConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  confirmVariant = "primary",
}) {
  if (!open) return null;
  return (
    <div className="modalBackdrop">
      <div className="modalCard modalCard-sm">
        <div className="modalHead">
          <h3 className="modalTitle">{title || 'Confirm'}</h3>
        </div>
        <div className="modalMessage">{message}</div>
        <div className="modalActions">
          <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
          <button
            className={`btn ${confirmVariant === "danger" ? "btn-danger" : "btn-primary"}`}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
