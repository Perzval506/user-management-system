import { useEffect, useState } from "react";
import api from "../services/api";

const DEFAULT_UNITS = [
  "kg",
  "g",
  "grams",
  "mg",
  "ml",
  "milliliter",
  "milliliters",
  "cup",
  "bottle",
  "teaspoon",
  "tablepoon",
  "tablespoon",
  "gallon",
  "pack",
  "pcs",
];

function normalizeUnits(units = []) {
  return Array.from(new Set([...DEFAULT_UNITS, ...units].map((unit) => String(unit || "").trim().toLowerCase()).filter(Boolean)));
}

let cache = normalizeUnits();

export default function useUnits() {
  const [units, setUnits] = useState(cache);

  useEffect(() => {
    let mounted = true;

    api
      .get("/meta/units")
      .then((response) => {
        if (!mounted) return;
        cache = normalizeUnits(response.data || []);
        setUnits(cache);
      })
      .catch(() => {
        if (!mounted) return;
        cache = normalizeUnits();
        setUnits(cache);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return units;
}
