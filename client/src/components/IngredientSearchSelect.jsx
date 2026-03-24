import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";

/**
 * Searchable ingredient selector with async search and stable option list.
 */
export default function IngredientSearchSelect({ value, onSelect, placeholder = "Search ingredient..." }) {
  const [term, setTerm] = useState("");
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (!open) return;
      setLoading(true);
      api
        .get("/ingredients", { params: { q: term } })
        .then((res) => {
          setOptions(Array.isArray(res.data) ? res.data : []);
        })
        .catch(() => {
          setOptions([]);
        })
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(handler);
  }, [term, open]);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const displayLabel = useMemo(() => {
    if (value?.ingredient_name) return value.ingredient_name;
    if (typeof value === "string") return value;
    return term;
  }, [value, term]);

  const handleSelect = (opt) => {
    onSelect?.(opt);
    setOpen(false);
    setTerm(opt.ingredient_name || "");
  };

  return (
    <div className="multiSelect" ref={wrapRef} style={{ width: "100%" }}>
      <input
        className="input"
        value={displayLabel}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => setTerm(e.target.value)}
        style={{ width: "100%" }}
      />
      {open && (
        <div className="multiSelectPopover" style={{ maxHeight: 260, marginTop: 6 }}>
          <div className="multiSelectList" style={{ maxHeight: 220 }}>
            {loading && <div className="multiSelectEmpty">Searching...</div>}
            {!loading && options.length === 0 && <div className="multiSelectEmpty">No matches</div>}
            {options.map((opt) => (
              <div key={opt.id} className="multiSelectOption" onClick={() => handleSelect(opt)}>
                <div style={{ fontWeight: 700 }}>{opt.ingredient_name}</div>
                <div style={{ fontSize: 12, color: "#6B7280" }}>{opt.base_unit || opt.base_unit_qty || ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
