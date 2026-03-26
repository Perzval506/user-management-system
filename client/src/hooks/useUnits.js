import { useEffect, useState } from "react";
import api from "../services/api";

let cache = null;

export default function useUnits() {
  const [units, setUnits] = useState(cache || []);

  useEffect(() => {
    let mounted = true;

    if (!cache) {
      api
        .get("/meta/units")
        .then((response) => {
          if (!mounted) return;
          cache = response.data || [];
          setUnits(cache);
        })
        .catch(() => {
          /* ignore */
        });
    }

    return () => {
      mounted = false;
    };
  }, []);

  return units;
}
