import React, { useState } from 'react';

export default function CreateRecipeModal({ open, initialName, onCancel, onCreate }) {
  const [name, setName] = useState(initialName || '');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  return (
    <div className="modalBackdrop">
      <div className="modalCard modalCard-md">
        <div className="modalHead">
          <h3 style={{ margin: 0 }}>Create Recipe for Menu Item</h3>
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Recipe name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Description (optional)</label>
          <textarea className="input" value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} />
        </div>

        <div className="modalActions">
          <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={async () => {
              setLoading(true);
              await onCreate({ recipe_name: name, recipe_description: desc });
              setLoading(false);
            }}
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
