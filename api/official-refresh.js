const SECTIONS_URL = "https://elezioni.comune.messina.it/amministrative2026/comunali/SEZ_1_83048.xml";
const PREFS_URL = "https://elezioni.comune.messina.it/amministrative2026/comunali/SEZ_3_83048_L23.xml";
const TARGET_LIST_NUMBER = 23;
const TARGET_LIST_NAME = "FEDERICO PER MESSINA";
const https = require("node:https");

module.exports = async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const [sectionsXml, prefsXml] = await Promise.all([
      fetchText(SECTIONS_URL),
      fetchText(PREFS_URL),
    ]);

    const sectionsData = parseSectionsXml(sectionsXml);
    const prefsData = parsePrefsXml(prefsXml);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      updatedAt: sectionsData.updatedAt || prefsData.updatedAt || null,
      scrutinizedSections: sectionsData.scrutinizedSections,
      sources: {
        sections: SECTIONS_URL,
        prefs: PREFS_URL,
      },
      mayors: sectionsData.mayors,
      lists: sectionsData.lists,
      totals: sectionsData.totals,
      prefs: prefsData.prefs,
      sections: sectionsData.sections,
      coalitions: sectionsData.coalitions,
    });
  } catch (error) {
    res.status(502).json({
      error: "Official refresh failed",
      detail: error && error.message ? error.message : String(error),
    });
  }
};

async function fetchText(url) {
  const target = withCacheBuster(url);
  if (typeof fetch === "function") {
    const response = await fetch(target, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
    return await response.text();
  }
  return await fetchTextWithHttps(target);
}

function fetchTextWithHttps(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`${url} returned HTTP ${response.statusCode}`));
        return;
      }
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

function withCacheBuster(url) {
  return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

function parseSectionsXml(xml) {
  const rootAttrs = attrsFromOpenTag(xml.match(/<CONS\b[^>]*>/)?.[0] || "");
  const metadataXml = xml.slice(0, xml.indexOf("<SV ") > -1 ? xml.indexOf("<SV ") : xml.length);
  const mayorNames = new Map();
  const listNames = new Map();
  const coalitions = {};

  for (const block of metadataXml.matchAll(/<C1\b([^>]*)>([\s\S]*?)<\/C1>/g)) {
    const mayorAttrs = attrsFromOpenTag(`<C1 ${block[1]}>`);
    const mayorNumber = toNumber(mayorAttrs.NUMERO);
    if (!mayorNumber) continue;
    mayorNames.set(mayorNumber, clean(mayorAttrs.NOME));

    for (const listMatch of block[2].matchAll(/<C2\b([^>]*)\/>/g)) {
      const listAttrs = attrsFromOpenTag(`<C2 ${listMatch[1]}>`);
      const listNumber = toNumber(listAttrs.NUMERO);
      if (!listNumber) continue;
      listNames.set(listNumber, clean(listAttrs.NOME));
      coalitions[listNumber] = mayorNumber;
    }
  }

  const mayors = [];
  const lists = [];
  const totals = [];
  const sections = [];

  for (const sectionMatch of xml.matchAll(/<SV\b([^>]*)>([\s\S]*?)<\/SV>/g)) {
    const sectionAttrs = attrsFromOpenTag(`<SV ${sectionMatch[1]}>`);
    const section = toNumber(sectionAttrs.NUMERO);
    if (!section) continue;

    sections.push({
      section,
      school: clean(sectionAttrs.NOME),
      address: clean(sectionAttrs.UBICAZIONE),
      circ: null,
    });

    totals.push({
      section,
      invalidVotes: toNumber(sectionAttrs.VOTI_NULLI),
      invalidBallots: toNumber(sectionAttrs.NULLE),
      blankBallots: toNumber(sectionAttrs.BIANCHE),
      contested: toNumber(sectionAttrs.VCNAS_TOT),
    });

    for (const mayorMatch of sectionMatch[2].matchAll(/<V1\b([^>]*)>([\s\S]*?)<\/V1>/g)) {
      const mayorAttrs = attrsFromOpenTag(`<V1 ${mayorMatch[1]}>`);
      const mayorNumber = toNumber(mayorAttrs.NUMERO);
      if (!mayorNumber) continue;

      mayors.push({
        section,
        mayorNumber,
        mayorName: mayorNames.get(mayorNumber) || "",
        votes: toNumber(mayorAttrs.VOTIVALIDI_C1),
      });

      for (const listMatch of mayorMatch[2].matchAll(/<V2\b([^>]*)\/>/g)) {
        const listAttrs = attrsFromOpenTag(`<V2 ${listMatch[1]}>`);
        const listNumber = toNumber(listAttrs.NUMERO);
        if (!listNumber) continue;

        lists.push({
          section,
          listNumber,
          listName: listNames.get(listNumber) || "",
          votes: toNumber(listAttrs.VOTIVALIDI_C2),
        });
      }
    }
  }

  return {
    updatedAt: clean(rootAttrs.ORAAGGIORNAMENTO),
    scrutinizedSections: toNumber(rootAttrs.SEZSCR),
    mayors,
    lists,
    totals,
    sections,
    coalitions,
  };
}

function parsePrefsXml(xml) {
  const rootAttrs = attrsFromOpenTag(xml.match(/<CONS\b[^>]*>/)?.[0] || "");
  const listAttrs = attrsFromOpenTag(xml.match(/<C0\b[^>]*LIVELLO="3"[^>]*>/)?.[0] || "");
  const listNumber = toNumber(listAttrs.NUMERO) || TARGET_LIST_NUMBER;
  const listName = clean(listAttrs.NOME) || TARGET_LIST_NAME;
  const metadataXml = xml.slice(0, xml.indexOf("<SV ") > -1 ? xml.indexOf("<SV ") : xml.length);
  const candidateNames = new Map();

  for (const candidateMatch of metadataXml.matchAll(/<C1\b([^>]*)\/>/g)) {
    const candidateAttrs = attrsFromOpenTag(`<C1 ${candidateMatch[1]}>`);
    const candidateNumber = toNumber(candidateAttrs.NUMERO);
    if (candidateNumber) {
      candidateNames.set(candidateNumber, clean(candidateAttrs.NOME));
    }
  }

  const prefs = [];
  for (const sectionMatch of xml.matchAll(/<SV\b([^>]*)>([\s\S]*?)<\/SV>/g)) {
    const sectionAttrs = attrsFromOpenTag(`<SV ${sectionMatch[1]}>`);
    const section = toNumber(sectionAttrs.NUMERO);
    if (!section) continue;

    for (const prefMatch of sectionMatch[2].matchAll(/<V1\b([^>]*)\/>/g)) {
      const prefAttrs = attrsFromOpenTag(`<V1 ${prefMatch[1]}>`);
      const candidateNumber = toNumber(prefAttrs.NUMERO);
      if (!candidateNumber) continue;

      prefs.push({
        section,
        listNumber,
        listName,
        candidateNumber,
        candidateName: candidateNames.get(candidateNumber) || "",
        votes: toNumber(prefAttrs.VOTIVALIDI_C1),
      });
    }
  }

  return {
    updatedAt: clean(rootAttrs.ORAAGGIORNAMENTO),
    prefs,
  };
}

function attrsFromOpenTag(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([A-Za-z0-9_:-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function clean(value) {
  return String(value || "").trim();
}

function toNumber(value) {
  const number = Number(String(value || "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}
