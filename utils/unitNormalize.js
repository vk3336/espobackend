// Maps CMS unit strings (uM field) to Google's strict unit codes.
// Returns null for unknown units so the caller can omit unit pricing entirely
// rather than emit an invalid value that would cause feed rejection.

const UNIT_MAP = {
  // Length
  m: "m", meter: "m", metre: "m", mtr: "m", meters: "m", metres: "m",
  cm: "cm", centimeter: "cm", centimetre: "cm",
  yd: "yd", yard: "yd", yards: "yd",
  ft: "ft", foot: "ft", feet: "ft",
  in: "in", inch: "in", inches: "in",
  // Weight
  kg: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gram: "g", grams: "g",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  oz: "oz", ounce: "oz", ounces: "oz",
  // Count
  ct: "ct", pcs: "ct", piece: "ct", pieces: "ct", count: "ct",
};

function normalizeUnit(rawUnit) {
  if (!rawUnit) return null;
  const key = String(rawUnit).trim().toLowerCase();
  return UNIT_MAP[key] || null;
}

module.exports = { normalizeUnit };