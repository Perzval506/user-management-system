import { useState, useEffect } from 'react';
import api from '../services/api';

let cache = null;

export default function useUnits() {
  const [units, setUnits] = useState(cache || []);

  useEffect(() => {
    let mounted = true;
    if (cache) {
      setUnits(cache);
      return () => { mounted = false };
    }
    api.get('/meta/units')
      .then(r => {
        if (!mounted) return;
        cache = r.data || [];
        setUnits(cache);
      })
      .catch(() => {
        /* ignore */
      });

    return () => { mounted = false };
  }, []);

  return units;
}
