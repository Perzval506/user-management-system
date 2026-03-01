import React, { useState } from 'react';

export default function CreateRecipeModal({ open, initialName, onCancel, onCreate }) {
  const [name, setName] = useState(initialName || '');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', zIndex: 99999 }}>
      <div style={{ width: 'min(620px, 100%)', background: 'white', borderRadius: 10, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Create Recipe for Menu Item</h3>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', marginBottom: 6 }}>Recipe name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ccc' }} />
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', marginBottom: 6 }}>Description (optional)</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ccc' }} rows={4} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onCancel} style={{ padding: '8px 12px', borderRadius: 6 }}>Cancel</button>
          <button onClick={async () => { setLoading(true); await onCreate({ recipe_name: name, recipe_description: desc }); setLoading(false); }} style={{ padding: '8px 12px', borderRadius: 6, background: 'black', color: 'white' }}>{loading ? 'Creating...' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}
