const MASS_FACTORS = {
  mg: 0.001,
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
};

const VOLUME_FACTORS = {
  ml: 1 / 4.92892,
  milliliter: 1 / 4.92892,
  milliliters: 1 / 4.92892,
  teaspoon: 1,
  teaspoons: 1,
  tablepoon: 3,
  tablespoon: 3,
  tablespoons: 3,
  cup: 48,
  cups: 48,
  gallon: 768,
  gallons: 768,
};

const COUNT_FACTORS = {
  pcs: 1,
  pc: 1,
  piece: 1,
  pieces: 1,
  pack: 1,
  packs: 1,
  bottle: 1,
  bottles: 1,
};

function factorFor(unit) {
  const normalized = String(unit || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MASS_FACTORS, normalized)) return MASS_FACTORS[normalized];
  if (Object.prototype.hasOwnProperty.call(VOLUME_FACTORS, normalized)) return VOLUME_FACTORS[normalized];
  if (Object.prototype.hasOwnProperty.call(COUNT_FACTORS, normalized)) return COUNT_FACTORS[normalized];
  return null;
}

function unitGroup(unit) {
  const normalized = String(unit || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MASS_FACTORS, normalized)) return "mass";
  if (Object.prototype.hasOwnProperty.call(VOLUME_FACTORS, normalized)) return "volume";
  if (Object.prototype.hasOwnProperty.call(COUNT_FACTORS, normalized)) return "count";
  return null;
}

export function convertQuantity(value, fromUnit, toUnit) {
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
