import { useMemo, useRef, useState, useEffect } from "react";

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
  const [draftSelected, setDraftSelected] = useState([]);
  const wrapRef = useRef(null);

  // New UX: keep edits local while the popover is open so clicking outside does not desync the visible chips.
  const currentSelected = open ? draftSelected : selected;

  useEffect(() => {
    function handleClick(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target) && open) {
        setOpen(false);
        if (onDone) onDone(draftSelected);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [draftSelected, onDone, open]);

  const text = useMemo(() => {
    if (!currentSelected.length) return placeholder;
    const chosen = options
      .filter((option) => currentSelected.includes(option.value))
      .map((option) => option.label);
    return chosen.length ? chosen.join(", ") : placeholder;
  }, [currentSelected, options, placeholder]);

  const openDropdown = () => {
    setDraftSelected(selected || []);
    setOpen(true);
  };

  const toggle = (value) => {
    setDraftSelected((previous) =>
      previous.includes(value)
        ? previous.filter((item) => item !== value)
        : [...previous, value]
    );
  };

  const handleDone = () => {
    if (onChange) onChange(draftSelected);
    if (onDone) onDone(draftSelected);
    setOpen(false);
  };

  const clear = () => {
    setDraftSelected([]);
    if (!open && onChange) onChange([]);
  };

  return (
    <div className="multiSelect" ref={wrapRef}>
      {label && <div className="multiSelectLabel">{label}</div>}
      <button
        type="button"
        className={`multiSelectTrigger ${open ? "open" : ""}`}
        onClick={() => (open ? setOpen(false) : openDropdown())}
      >
        <span className="multiSelectValue">{text}</span>
        <span className="multiSelectCaret">v</span>
      </button>

      {open && (
        <div className="multiSelectPopover" style={{ maxHeight }}>
          <div className="multiSelectList" style={{ maxHeight }}>
            {options.map((option) => (
              <label key={option.value} className="multiSelectOption">
                <input
                  type="checkbox"
                  checked={draftSelected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                  onClick={(event) => event.stopPropagation()}
                />
                <span>{option.label}</span>
              </label>
            ))}
            {!options.length && <div className="multiSelectEmpty">No options</div>}
          </div>
          <div className="multiSelectFooter">
            <button type="button" className="btn btn-ghost" onClick={clear}>
              Clear
            </button>
            <div className="multiSelectSpacer" />
            <button type="button" className="btn btn-primary" onClick={handleDone}>
              {doneLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
