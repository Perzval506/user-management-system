import React from 'react';

export default function ConfirmModal({ open, title, message, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', zIndex: 99999 }}>
      <div style={{ width: 'min(520px, 100%)', background: 'white', borderRadius: 10, padding: 18, boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{title || 'Confirm'}</h3>
        </div>
        <div style={{ marginTop: 12 }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onCancel} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ccc', background: 'white' }}>Cancel</button>
          <button onClick={onConfirm} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: '#b44', color: 'white' }}>Discard</button>
        </div>
      </div>
    </div>
  );
}
