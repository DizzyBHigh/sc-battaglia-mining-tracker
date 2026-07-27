"use strict";

/**
 * Base RS (resource signature) for 1 rock in a cluster.
 * Cluster ping ≈ base × rock count (*1, *2, … up to max for that resource).
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

/**
 * Max cluster size (*N) that appears in-game for each resource.
 * Do not display more multipliers than listed here.
 */
const CLUSTER_MAX_BY_RESOURCE = {
  Quantanium: 2,
  Quantainium: 2,
  Stileron: 2,
  Savrilium: 2,
  Savrillium: 2,
  Ouratite: 3,
  Riccite: 3,
  Lindinium: 3,
  Beryl: 4,
  Taranite: 4,
  Borase: 4,
  Gold: 4,
  Bexalite: 4,
  Laranite: 5,
  Aslarite: 5,
  Titanium: 5,
  Tungsten: 5,
  Agricium: 5,
  Torite: 5,
  Hephaestanite: 6,
  Tin: 6,
  Quartz: 6,
  Corundum: 6,
  Copper: 6,
  Silicon: 6,
  Iron: 6,
  Aluminium: 6,
  Aluminum: 6,
  Ice: 6,
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

function clusterMaxFor(resource) {
  if (!resource) return DEFAULT_CLUSTER_MAX;
  if (CLUSTER_MAX_BY_RESOURCE[resource] != null) return CLUSTER_MAX_BY_RESOURCE[resource];
  const lower = String(resource).toLowerCase();
  for (const [k, v] of Object.entries(CLUSTER_MAX_BY_RESOURCE)) {
    if (k.toLowerCase() === lower) return v;
  }
  return DEFAULT_CLUSTER_MAX;
}

function signaturesForClusters(resource, maxRocks) {
  const base = signatureFor(resource);
  if (base == null) return [];
  const limit =
    maxRocks != null && maxRocks !== ""
      ? parseInt(maxRocks, 10)
      : clusterMaxFor(resource);
  const n = Math.max(1, Math.min(12, limit || clusterMaxFor(resource)));
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

function formatClusterSignatures(resource, maxRocks) {
  const list = signaturesForClusters(resource, maxRocks);
  if (!list.length) return "";
  return list.map((x) => x.signature).join(" · ");
}

module.exports = {
  RESOURCE_SIGNATURES,
  CLUSTER_MAX_BY_RESOURCE,
  RS_TO_RESOURCE,
  DEFAULT_CLUSTER_MAX,
  signatureFor,
  clusterMaxFor,
  signaturesForClusters,
  formatSignature,
  formatClusterSignatures,
};
