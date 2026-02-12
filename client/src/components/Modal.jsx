// client/src/components/Modal.jsx
// ADDED: Simple reusable modal for Create/Edit (adviser: separate page or modal dialog)
export default function Modal({ open, title, children, onClose }) {
  if (!open) return null;

  return (
    <div
      // ADDED: click outside closes modal
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 999,
      }}
    >
      <div
        // ADDED: prevent closing when clicking inside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          background: "#1f1f1f",
          border: "1px solid #444",
          borderRadius: 12,
          padding: 16,
          color: "white",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}
