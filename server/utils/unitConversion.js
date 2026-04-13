const MASS_FACTORS = {
  mg: 0.001,
  g: 1,
  kg: 1000,
};

const VOLUME_FACTORS = {
  teaspoon: 1,
  tablepoon: 3,
  tablespoon: 3,
  cup: 48,
  gallon: 768,
};

const COUNT_FACTORS = {
  pcs: 1,
};

function unitGroup(unit) {
  const normalized = String(unit || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MASS_FACTORS, normalized)) return "mass";
  if (Object.prototype.hasOwnProperty.call(VOLUME_FACTORS, normalized)) return "volume";
  if (Object.prototype.hasOwnProperty.call(COUNT_FACTORS, normalized)) return "count";
  return null;
}

function factorFor(unit) {
  const normalized = String(unit || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MASS_FACTORS, normalized)) return MASS_FACTORS[normalized];
  if (Object.prototype.hasOwnProperty.call(VOLUME_FACTORS, normalized)) return VOLUME_FACTORS[normalized];
  if (Object.prototype.hasOwnProperty.call(COUNT_FACTORS, normalized)) return COUNT_FACTORS[normalized];
  return null;
}

function convertQuantity(value, fromUnit, toUnit) {
  const amount = Number(value);
  const from = String(fromUnit || "").trim().toLowerCase();
  const to = String(toUnit || "").trim().toLowerCase();

  if (!Number.isFinite(amount)) return null;
  if (!from || !to) return null;
  if (from === to) return amount;

  const fromGroup = unitGroup(from);
  const toGroup = unitGroup(to);
  if (!fromGroup || !toGroup || fromGroup !== toGroup) return null;

  const fromFactor = factorFor(from);
  const toFactor = factorFor(to);
  if (!Number.isFinite(fromFactor) || !Number.isFinite(toFactor) || toFactor === 0) return null;

  return (amount * fromFactor) / toFactor;
}

module.exports = {
  convertQuantity,
  unitGroup,
};
