"use strict";

const RESOURCE_ALIASES = {
  aluminium: "Aluminium",
  aluminum: "Aluminium",
  aluminlum: "Aluminium",
  aluminjum: "Aluminium",
  iron: "Iron",
  fron: "Iron",
  ice: "Ice",
  torite: "Torite",
  savrillium: "Savrilium",
  savrilium: "Savrilium",
  bexalite: "Bexalite",
  quantanium: "Quantanium",
  hadanite: "Hadanite",
  agricium: "Agricium",
  hephaestanite: "Hephaestanite",
  taranite: "Taranite",
  lycanite: "Laranite",
  laranite: "Laranite",
  titanium: "Titanium",
  copper: "Copper",
  gold: "Gold",

  // Lindinium — OCR often swaps i ↔ l (and similar)
  lindinium: "Lindinium",
  llndinium: "Lindinium", // L→l, first i→l lookalike start
  indinium: "Lindinium", // leading L read as I / dropped
  lndinium: "Lindinium", // first i dropped or read as non-letter
  lindlnium: "Lindinium", // i→l mid
  lindiniurn: "Lindinium", // m→rn
  lindinum: "Lindinium", // missing i
  llndlnium: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  lindlnlum: "Lindinium",
  llndlnlum: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  lindiinium: "Lindinium", // extra i
  linclinium: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  // systematic i/l swaps on "lindinium"
  llndinium: "Lindinium",
  lilndinium: "Lindinium",
  lindillium: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
  // cleaner unique set
  lindiniurn: "Lindinium",
  lindiniurn: "Lindinium",
};

const RS_TO_RESOURCE = {
  "3170": "Quantanium",
  "3185": "Stileron",
  "3200": "Savrilium",
  "3370": "Ouratite",
  "3385": "Riccite",
  "3400": "Lindinium",
  "3540": "Beryl",
  "3555": "Taranite",
  "3570": "Borase",
  "3585": "Gold",
  "3600": "Bexalite",
  "3825": "Laranite",
  "3840": "Aslarite",
  "3855": "Titanium",
  "3870": "Tungsten",
  "3885": "Agricium",
  "3900": "Torite",
  "4180": "Hephaestanite",
  "4195": "Tin",
  "4210": "Quartz",
  "4225": "Corundum",
  "4240": "Copper",
  "4255": "Silicon",
  "4270": "Iron",
  "4285": "Aluminium",
  "4300": "Ice",
};

function normalizeResource(name) {
  const key = String(name || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return RESOURCE_ALIASES[key] || null;
}

/**
 * Parse OCR text into requirements and optional progress counters.
 * @returns {{ requirements: Object<string,number>, progress: Object<string,number> }}
 */
function parseRequirements(text) {
  text = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[‘’]/g, "'")
    .replace(/–/g, "-");
  const flat = text.replace(/\s+/g, " ");

  const found = {};
  const progress = {};

  function setReq(res, count) {
    if (!res || count < 1 || count > 30) return;
    if (found[res] == null || count > found[res]) found[res] = count;
  }

  function setProg(res, current, total) {
    if (!res) return;
    if (total >= 1 && total <= 30) setReq(res, total);
    if (current >= 0 && current <= 30) {
      progress[res] = current;
    }
  }

  let m;

  // "N of Resource (RS xxxx)"
  const reA =
    /(\d+)\s+of\s+(?:[^\w]{0,20})?([A-Za-z]{3,20})\s*\(RS\s*(\d+)\)/gi;
  while ((m = reA.exec(flat))) {
    setReq(normalizeResource(m[2]) || RS_TO_RESOURCE[m[3]], parseInt(m[1], 10));
  }

  // "N of Resource"
  const reB = /(\d+)\s+of\s+([A-Za-z]{3,20})\b/gi;
  while ((m = reB.exec(flat))) {
    setReq(normalizeResource(m[2]), parseInt(m[1], 10));
  }

  // "Resource (RS xxxx) Asteroids: 1/2"  → progress + required
  const reC =
    /([A-Za-z]{3,20})\s*\(RS\s*(\d+)\)\s*Asteroids?\s*[:.]?\s*(\d+)\s*\/\s*(\d+)/gi;
  while ((m = reC.exec(flat))) {
    const res = normalizeResource(m[1]) || RS_TO_RESOURCE[m[2]];
    setProg(res, parseInt(m[3], 10), parseInt(m[4], 10));
  }

  // "Resource (RS xxxx) Asteroids: 2" (total only)
  const reC2 =
    /([A-Za-z]{3,20})\s*\(RS\s*(\d+)\)\s*Asteroids?\s*[:.]?\s*(\d+)\b(?!\s*\/)/gi;
  while ((m = reC2.exec(flat))) {
    setReq(
      normalizeResource(m[1]) || RS_TO_RESOURCE[m[2]],
      parseInt(m[3], 10)
    );
  }

  // RS + fraction
  const reD = /RS\s*(\d{4}).{0,50}?(\d+)\s*\/\s*(\d+)/gi;
  while ((m = reD.exec(flat))) {
    const res = RS_TO_RESOURCE[m[1]];
    setProg(res, parseInt(m[2], 10), parseInt(m[3], 10));
  }

  // deposit fallback
  const depositIdx = flat.toLowerCase().indexOf("deposit");
  if (depositIdx >= 0) {
    const region = flat.slice(depositIdx, depositIdx + 250);
    const numbers = [...region.matchAll(/\b(\d+)\b/g)]
      .map((x) => parseInt(x[1], 10))
      .filter((n) => n >= 1 && n <= 20);
    const resources = [];
    const reR = /([A-Za-z]{3,20})\s*\(RS\s*(\d+)\)/gi;
    while ((m = reR.exec(region))) {
      const res = normalizeResource(m[1]) || RS_TO_RESOURCE[m[2]];
      if (res) resources.push(res);
    }
    if (numbers.length && resources.length && numbers.length >= resources.length) {
      resources.forEach((res, i) => {
        if (found[res] == null) setReq(res, numbers[i]);
      });
    }
  }

  return { requirements: found, progress };
}

/** Back-compat: requirements only */
function parseRequirementsLegacy(text) {
  return parseRequirements(text).requirements;
}

module.exports = {
  parseRequirements: parseRequirementsLegacy,
  parseOcrResult: parseRequirements,
};
