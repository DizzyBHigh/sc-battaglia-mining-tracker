"use strict";

/**
 * Base RS (resource signature) values for 1 rock in a cluster.
 * Cluster ping value ≈ base × rock count.
 * Source: community SC 4.7+ mining signature tables / cstone / reddit breakdown.
 */
const RESOURCE_SIGNATURES = {
  Quantanium: 3170,
  Quantainium: 3170,
  Stileron: 3185,
  Savrilium: 3200,
  Ouratite: 3370,
  Riccite: 3385,
  Lindinium: 3400,
  Beryl: 3540,
  Taranite: 3555,
  Borase: 3570,
  Gold: 3585,
  Bexalite: 3600,
  Laranite: 3825,
  Aslarite: 3840,
  Titanium: 3855,
  Tungsten: 3870,
  Agricium: 3885,
  Torite: 3900,
  Hephaestanite: 4180,
  Tin: 4195,
  Quartz: 4210,
  Corundum: 4225,
  Copper: 4240,
  Silicon: 4255,
  Iron: 4270,
  Aluminium: 4285,
  Aluminum: 4285,
  Ice: 4300,
};

/** Inverse: RS code string → canonical resource name */
const RS_TO_RESOURCE = {};
for (const [name, sig] of Object.entries(RESOURCE_SIGNATURES)) {
  // Prefer British spelling where both exist
  const key = String(sig);
  if (!RS_TO_RESOURCE[key] || name === "Aluminium") {
    RS_TO_RESOURCE[key] = name === "Aluminum" ? "Aluminium" : name === "Quantainium" ? "Quantanium" : name;
  }
}

function signatureFor(resource) {
  if (!resource) return null;
  if (RESOURCE_SIGNATURES[resource] != null) return RESOURCE_SIGNATURES[resource];
  // case-insensitive
  const lower = String(resource).toLowerCase();
  for (const [k, v] of Object.entries(RESOURCE_SIGNATURES)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

function formatSignature(sig) {
  if (sig == null) return "";
  return String(sig);
}

module.exports = {
  RESOURCE_SIGNATURES,
  RS_TO_RESOURCE,
  signatureFor,
  formatSignature,
};
