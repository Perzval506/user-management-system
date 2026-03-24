import { useEffect, useMemo, useRef, useState } from "react";

export default function MultiSelectDropdown({
  options = [],
  selected = [],
  onChange,
  onDone,
  label,
  placeholder = "Select items",
  doneLabel = "Done",
  maxHeight = 260,
}) {
  const [open, setOpen] = useState(false);
  const [localSelected, setLocalSelected] = useState(selected || []);
  const wrapRef = useRef(null);

  useEffect(() => {
    setLocalSelected(selected || []);
  }, [selected]);

  // Close only when clicking outside the component
  useEffect(() => {
    function handleClick(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
        if (onDone) onDone(localSelected);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [localSelected, onDone]);

  const text = useMemo(() => {
    if (!localSelected.length) return placeholder;
    const chosen = options.filter((o) => localSelected.includes(o.value)).map((o) => o.label);
    return chosen.length ? chosen.join(", ") : placeholder;
  }, [localSelected, options, placeholder]);

  const toggle = (value) => {
    setLocalSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const handleDone = () => {
    if (onChange) onChange(localSelected);
    if (onDone) onDone(localSelected);
    setOpen(false);
  };

  const clear = () => {
    setLocalSelected([]);
    if (onChange) onChange([]);
  };

  return (
    <div className="multiSelect" ref={wrapRef}>
      {label && <div className="multiSelectLabel">{label}</div>}
      <button type="button" className={`multiSelectTrigger ${open ? "open" : ""}`} onClick={() => setOpen((v) => !v)}>
        <span className="multiSelectValue">{text}</span>
        <span className="multiSelectCaret">▾</span>
      </button>

      {open && (
        <div className="multiSelectPopover" style={{ maxHeight }}>
          <div className="multiSelectList" style={{ maxHeight }}>
            {options.map((opt) => (
              <label key={opt.value} className="multiSelectOption">
                <input
                  type="checkbox"
                  checked={localSelected.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span>{opt.label}</span>
              </label>
            ))}
            {!options.length && <div className="multiSelectEmpty">No options</div>}
          </div>
          <div className="multiSelectFooter">
            <button type="button" className="btn btn-ghost" onClick={clear}>Clear</button>
            <div className="multiSelectSpacer" />
            <button type="button" className="btn btn-primary" onClick={handleDone}>{doneLabel}</button>
          </div>
        </div>
      )}
    </div>
  );
}
