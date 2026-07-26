"use strict";

/**
 * Base RS (resource signature) for 1 rock in a cluster.
 * Cluster ping ≈ base × rock count (*1, *2, *3, …).
 */
const RESOURCE_SIGNATURES = {
  Quantanium: 3170,
  Quantainium: 3170,
  Stileron: 3185,
  Savrilium: 3200,
  Savrillium: 3200,
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

const DEFAULT_CLUSTER_MAX = 5;

const RS_TO_RESOURCE = {};
for (const [name, sig] of Object.entries(RESOURCE_SIGNATURES)) {
  const key = String(sig);
  if (!RS_TO_RESOURCE[key] || name === "Aluminium") {
    RS_TO_RESOURCE[key] =
      name === "Aluminum"
        ? "Aluminium"
        : name === "Quantainium"
          ? "Quantanium"
          : name === "Savrillium"
            ? "Savrilium"
            : name;
  }
}

function signatureFor(resource) {
  if (!resource) return null;
  if (RESOURCE_SIGNATURES[resource] != null) return RESOURCE_SIGNATURES[resource];
  const lower = String(resource).toLowerCase();
  for (const [k, v] of Object.entries(RESOURCE_SIGNATURES)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

function signaturesForClusters(resource, maxRocks = DEFAULT_CLUSTER_MAX) {
  const base = signatureFor(resource);
  if (base == null) return [];
  const n = Math.max(1, Math.min(12, parseInt(maxRocks, 10) || DEFAULT_CLUSTER_MAX));
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({ rocks: i, signature: base * i });
  }
  return out;
}

function formatSignature(sig) {
  if (sig == null) return "";
  return String(sig);
}

function formatClusterSignatures(resource, maxRocks = DEFAULT_CLUSTER_MAX) {
  const list = signaturesForClusters(resource, maxRocks);
  if (!list.length) return "";
  return list.map((x) => x.signature).join(" · ");
}

module.exports = {
  RESOURCE_SIGNATURES,
  RS_TO_RESOURCE,
  DEFAULT_CLUSTER_MAX,
  signatureFor,
  signaturesForClusters,
  formatSignature,
  formatClusterSignatures,
};
