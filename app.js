(function () {
  "use strict";

  const STORAGE_KEY = "elezioni-monitoraggio-v1";
  const OFFICIAL_REFRESH_ENDPOINT = "/api/official-refresh";
  const TARGET_LIST = { number: 23, name: "FEDERICO PER MESSINA" };
  const TARGET_MAYOR = { number: 3, name: "BASILE FEDERICO", label: "Voti Sindaco Basile" };
  const DEFAULT_COUNCIL_SEATS = 32;
  const MAYOR_FALLBACKS = [
    { number: 1, name: "SCURRIA MARCELLO" },
    { number: 2, name: "RUSSO ANTONIA" },
    { number: 3, name: "BASILE FEDERICO" },
    { number: 4, name: "SCIACCA GAETANO" },
    { number: 5, name: "VALVIERI LETTERIO" },
  ];
  const DEFAULT_COALITIONS = {
    1: 2,
    2: 3,
    3: 3,
    4: 1,
    5: 1,
    6: 1,
    7: 3,
    8: 3,
    9: 3,
    10: 3,
    11: 3,
    12: 3,
    13: 3,
    14: 2,
    15: 2,
    16: 1,
    17: 3,
    18: 1,
    19: 4,
    20: 1,
    21: 3,
    22: 5,
    23: 3,
    24: 1,
    25: 1,
    26: 1,
  };
  const TARGET_CANDIDATES = [
    { key: "romano", number: 27, name: "Francesco Romano", official: "Romano Francesco", column: "Voti Francesco Romano" },
    { key: "guadagna", number: 15, name: "Francesca Guadagna", official: "Guadagna Francesca", column: "Voti Francesca Guadagna" },
    { key: "nicoletti", number: 21, name: "Marina Nicoletti", official: "Nicoletti Marina", column: "Voti Marina Nicoletti" },
    { key: "riso", number: 25, name: "Lucrezia Riso", official: "Riso Lucrezia", column: "Voti Lucrezia Riso" },
  ];

  const MONITOR_HEADERS = [
    "Istituto/Plesso",
    "Via e Numero Civico",
    "Circoscrizione",
    "Sezione",
    "Voti Francesco Romano",
    "Voti Francesca Guadagna",
    "Voti Marina Nicoletti",
    "Voti Lucrezia Riso",
    "Voti Lista Federico per Messina",
    "Voti Sindaco Basile",
    "Note",
  ];

  const state = loadState();
  let activeTab = "monitoraggio";
  let compareOnlyDiffs = false;
  let saveTimer = null;
  let toastTimer = null;

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    ensureSectionsFromOfficial();
    renderAll();
  }

  function cacheElements() {
    els.saveStatus = document.getElementById("saveStatus");
    els.toast = document.getElementById("toast");
    els.metricSections = document.getElementById("metricSections");
    els.metricSectionsMeta = document.getElementById("metricSectionsMeta");
    els.metricFilled = document.getElementById("metricFilled");
    els.metricFilledMeta = document.getElementById("metricFilledMeta");
    els.metricPrefs = document.getElementById("metricPrefs");
    els.metricListMayor = document.getElementById("metricListMayor");
    els.coveragePercent = document.getElementById("coveragePercent");
    els.coverageBar = document.getElementById("coverageBar");
    els.coverageMeta = document.getElementById("coverageMeta");
    els.candidateChart = document.getElementById("candidateChart");
    els.circChart = document.getElementById("circChart");
    els.listMayorChart = document.getElementById("listMayorChart");
    els.searchInput = document.getElementById("searchInput");
    els.circFilter = document.getElementById("circFilter");
    els.filledOnly = document.getElementById("filledOnly");
    els.monitorBody = document.querySelector("#monitorTable tbody");
    els.candidateCompareBody = document.querySelector("#candidateCompareTable tbody");
    els.sectionCompareBody = document.querySelector("#sectionCompareTable tbody");
    els.mayorOfficialBody = document.querySelector("#mayorOfficialTable tbody");
    els.listOfficialBody = document.querySelector("#listOfficialTable tbody");
    els.prefOfficialBody = document.querySelector("#prefOfficialTable tbody");
    els.totalsOfficialBody = document.querySelector("#totalsOfficialTable tbody");
    els.seatSummary = document.getElementById("seatSummary");
    els.federicoSeatHighlight = document.getElementById("federicoSeatHighlight");
    els.seatAllocationBody = document.querySelector("#seatAllocationTable tbody");
    els.coalitionMappingBody = document.querySelector("#coalitionMappingTable tbody");
    els.councilSeatsInput = document.getElementById("councilSeatsInput");
    els.refreshOfficialBtn = document.getElementById("refreshOfficialBtn");
    els.refreshOfficialStatus = document.getElementById("refreshOfficialStatus");
  }

  function bindEvents() {
    document.querySelectorAll(".tab").forEach((button) => {
      button.addEventListener("click", () => setActiveTab(button.dataset.tab));
    });

    document.querySelectorAll("[data-import]").forEach((input) => {
      input.addEventListener("change", handleImport);
    });

    els.searchInput.addEventListener("input", renderMonitorTable);
    els.circFilter.addEventListener("change", renderMonitorTable);
    els.filledOnly.addEventListener("change", renderMonitorTable);

    els.monitorBody.addEventListener("input", handleMonitorInput);
    document.getElementById("showOnlyDiffs").addEventListener("click", () => {
      compareOnlyDiffs = !compareOnlyDiffs;
      document.getElementById("showOnlyDiffs").textContent = compareOnlyDiffs ? "Mostra tutte" : "Mostra solo differenze";
      renderCompare();
    });

    document.getElementById("exportMonitorCsv").addEventListener("click", exportMonitorCsv);
    document.getElementById("exportLongCsv").addEventListener("click", exportLongCsv);
    document.getElementById("exportBackupJson").addEventListener("click", exportBackupJson);
    document.getElementById("backupInput").addEventListener("change", importBackupJson);
    document.getElementById("resetAllBtn").addEventListener("click", resetAll);
    els.refreshOfficialBtn.addEventListener("click", refreshOfficialData);
    els.councilSeatsInput.addEventListener("input", handleCouncilSeatsInput);
    els.coalitionMappingBody.addEventListener("change", handleCoalitionChange);
  }

  function createEmptyState() {
    return {
      version: 1,
      updatedAt: null,
      imports: {},
      official: {
        mayors: [],
        lists: [],
        totals: [],
        prefs: [],
      },
      personal: {
        sections: [],
        values: {},
      },
      settings: {
        councilSeats: DEFAULT_COUNCIL_SEATS,
        coalitions: { ...DEFAULT_COALITIONS },
      },
      remote: {
        lastRefreshAt: null,
        lastRefreshSummary: "",
      },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createEmptyState();
      const parsed = JSON.parse(raw);
      return mergeDefaults(parsed);
    } catch (error) {
      console.error(error);
      return createEmptyState();
    }
  }

  function mergeDefaults(parsed) {
    const base = createEmptyState();
    return {
      ...base,
      ...parsed,
      imports: { ...base.imports, ...(parsed.imports || {}) },
      official: { ...base.official, ...(parsed.official || {}) },
      personal: { ...base.personal, ...(parsed.personal || {}) },
      settings: {
        ...base.settings,
        ...(parsed.settings || {}),
        coalitions: {
          ...base.settings.coalitions,
          ...((parsed.settings && parsed.settings.coalitions) || {}),
        },
      },
      remote: { ...base.remote, ...(parsed.remote || {}) },
    };
  }

  function saveState(reason) {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    els.saveStatus.textContent = reason || "Salvato";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      els.saveStatus.textContent = "Salvato";
    }, 900);
  }

  function setActiveTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    document.getElementById(`tab-${tab}`).classList.add("active");
    if (tab === "confronto") renderCompare();
    if (tab === "ufficiali") renderOfficial();
  }

  async function handleImport(event) {
    const input = event.currentTarget;
    const kind = input.dataset.import;
    const file = input.files && input.files[0];
    if (!file) return;

    try {
      setBusyStatus(kind, "Import in corso...");
      if (kind === "monitor") {
        await importMonitorWorkbook(file);
      } else {
        const text = await readTextFile(file);
        importOfficialCsv(kind, file, text);
      }
      ensureSectionsFromOfficial();
      saveState("Salvato");
      renderAll();
      showToast(`Importato: ${file.name}`);
    } catch (error) {
      console.error(error);
      setBusyStatus(kind, "Errore import");
      showToast(`Errore import: ${error.message || error}`);
    } finally {
      input.value = "";
    }
  }

  function importOfficialCsv(kind, file, text) {
    const rows = parseDelimited(text, ";");
    if (!rows.length) throw new Error("CSV vuoto");
    const normalized = rows.map(normalizeObject);

    if (kind === "mayors") {
      state.official.mayors = normalized.map((row) => ({
        section: toNumber(row.sezione),
        mayorNumber: toNumber(row.numero_sind),
        mayorName: textValue(row.candidato_sindaco),
        votes: toNumber(row.voti_validi),
      })).filter((row) => row.section && row.mayorNumber);
    }

    if (kind === "lists") {
      state.official.lists = normalized.map((row) => ({
        section: toNumber(row.sezione),
        listNumber: toNumber(row.numero_liste),
        listName: textValue(row.nome_lista),
        votes: toNumber(row.voti_validi),
      })).filter((row) => row.section && row.listNumber);
    }

    if (kind === "totals") {
      state.official.totals = normalized.map((row) => ({
        section: toNumber(row.sezione),
        invalidVotes: toNumber(row.voti_nulli),
        invalidBallots: toNumber(row.schede_nulle),
        blankBallots: toNumber(row.schede_bianche),
        contested: toNumber(row.v_cont_noass),
      })).filter((row) => row.section);
    }

    if (kind === "prefs") {
      state.official.prefs = normalized.map((row) => ({
        section: toNumber(row.sezione),
        listNumber: toNumber(row.numero_liste),
        listName: textValue(row.nome_lista),
        candidateNumber: toNumber(row.numero_cons),
        candidateName: textValue(row.nome_cons),
        votes: toNumber(row.voti_validi),
      })).filter((row) => row.section && row.candidateNumber);
    }

    ensureCoalitionDefaults();
    state.imports[kind] = importMeta(file, getOfficialRows(kind).length);
  }

  async function importMonitorWorkbook(file) {
    if (!window.JSZip) throw new Error("JSZip non disponibile");
    const rows = await readFirstWorksheet(file);
    if (!rows.length) throw new Error("Workbook vuoto");

    const headers = rows[0].map((value) => textValue(value));
    const dataRows = rows.slice(1)
      .map((row) => objectFromHeaders(headers, row))
      .filter((row) => row["Sezione"] !== undefined && row["Sezione"] !== null && row["Sezione"] !== "");

    const sections = [];
    const values = { ...state.personal.values };

    dataRows.forEach((row) => {
      const section = toNumber(row["Sezione"]);
      if (!section) return;

      sections.push({
        section,
        school: textValue(row["Istituto/Plesso"]),
        address: textValue(row["Via e Numero Civico"]),
        circ: toNumber(row["Circoscrizione"]),
      });

      const existing = values[section] || {};
      values[section] = {
        ...emptySectionValues(),
        ...existing,
        romano: coalesceImported(row["Voti Francesco Romano"], existing.romano),
        guadagna: coalesceImported(row["Voti Francesca Guadagna"], existing.guadagna),
        nicoletti: coalesceImported(row["Voti Marina Nicoletti"], existing.nicoletti),
        riso: coalesceImported(row["Voti Lucrezia Riso"], existing.riso),
        list: coalesceImported(row["Voti Lista Federico per Messina"], existing.list),
        mayor: coalesceImported(row["Voti Sindaco Basile"], existing.mayor),
        note: coalesceImportedText(row["Note"], existing.note),
      };
    });

    state.personal.sections = sortSections(uniqueSections(sections));
    state.personal.values = values;
    state.imports.monitor = importMeta(file, sections.length);
  }

  function importMeta(file, rows) {
    return {
      fileName: file.name,
      rows,
      importedAt: new Date().toISOString(),
    };
  }

  function getOfficialRows(kind) {
    const map = {
      mayors: state.official.mayors,
      lists: state.official.lists,
      totals: state.official.totals,
      prefs: state.official.prefs,
    };
    return map[kind] || [];
  }

  function ensureSectionsFromOfficial() {
    if (state.personal.sections.length) return;
    const sectionSet = new Set();
    ["mayors", "lists", "totals", "prefs"].forEach((kind) => {
      getOfficialRows(kind).forEach((row) => sectionSet.add(row.section));
    });
    state.personal.sections = Array.from(sectionSet).sort((a, b) => a - b).map((section) => ({
      section,
      school: "",
      address: "",
      circ: null,
    }));
  }

  function renderAll() {
    renderImportStatus();
    renderRefreshStatus();
    renderCircFilter();
    renderSummary();
    renderCharts();
    renderMonitorTable();
    if (activeTab === "confronto") renderCompare();
    if (activeTab === "ufficiali") renderOfficial();
  }

  function renderImportStatus() {
    ["mayors", "lists", "totals", "prefs", "monitor"].forEach((kind) => {
      const el = document.getElementById(`status-${kind}`);
      const meta = state.imports[kind];
      if (!meta) {
        el.textContent = "Non importato";
        return;
      }
      el.textContent = `${meta.fileName} - ${formatNumber(meta.rows)} righe - ${formatDateTime(meta.importedAt)}`;
    });
  }

  function renderRefreshStatus(kind) {
    if (!els.refreshOfficialStatus) return;
    els.refreshOfficialStatus.classList.remove("ok", "error");
    if (kind) els.refreshOfficialStatus.classList.add(kind);

    if (state.remote.lastRefreshAt && !kind) {
      els.refreshOfficialStatus.classList.add("ok");
      els.refreshOfficialStatus.textContent = `${state.remote.lastRefreshSummary} Aggiornato: ${formatDateTime(state.remote.lastRefreshAt)}.`;
      return;
    }

    if (!kind) {
      els.refreshOfficialStatus.textContent = "Refresh automatico non ancora eseguito.";
    }
  }

  async function refreshOfficialData() {
    const previousText = els.refreshOfficialBtn.textContent;
    els.refreshOfficialBtn.disabled = true;
    els.refreshOfficialBtn.textContent = "Aggiorno...";
    els.refreshOfficialStatus.classList.remove("ok", "error");
    els.refreshOfficialStatus.textContent = "Scarico dati ufficiali...";

    try {
      const response = await fetch(`${OFFICIAL_REFRESH_ENDPOINT}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(data.detail || data.error);
      }

      state.official.mayors = data.mayors || [];
      state.official.lists = data.lists || [];
      state.official.totals = data.totals || [];
      state.official.prefs = data.prefs || [];
      state.imports.mayors = remoteImportMeta("SEZ_1_83048.xml", state.official.mayors.length);
      state.imports.lists = remoteImportMeta("SEZ_1_83048.xml", state.official.lists.length);
      state.imports.totals = remoteImportMeta("SEZ_1_83048.xml", state.official.totals.length);
      state.imports.prefs = remoteImportMeta("SEZ_3_83048_L23.xml", state.official.prefs.length);
      mergeOfficialSectionMetadata(data.sections || []);
      state.settings.coalitions = { ...state.settings.coalitions, ...(data.coalitions || {}) };
      state.remote.lastRefreshAt = new Date().toISOString();
      state.remote.lastRefreshSummary = `Refresh ufficiali: ${formatNumber(data.scrutinizedSections || 0)} sezioni scrutinate, ${formatNumber(state.official.mayors.length)} righe sindaco, ${formatNumber(state.official.lists.length)} righe liste, ${formatNumber(state.official.prefs.length)} righe preferenze.`;

      saveState("Salvato");
      renderAll();
      if (activeTab === "ufficiali") renderOfficial();
      renderRefreshStatus("ok");
      showToast("Dati ufficiali aggiornati");
    } catch (error) {
      console.error(error);
      els.refreshOfficialStatus.classList.add("error");
      els.refreshOfficialStatus.textContent = `Refresh non riuscito: ${error.message || error}`;
      showToast("Refresh ufficiali non riuscito");
    } finally {
      els.refreshOfficialBtn.disabled = false;
      els.refreshOfficialBtn.textContent = previousText;
    }
  }

  function remoteImportMeta(fileName, rows) {
    return {
      fileName: `auto: ${fileName}`,
      rows,
      importedAt: new Date().toISOString(),
    };
  }

  function mergeOfficialSectionMetadata(sections) {
    const existing = new Map(state.personal.sections.map((section) => [section.section, section]));
    sections.forEach((section) => {
      const current = existing.get(section.section);
      if (current) {
        existing.set(section.section, {
          ...section,
          ...current,
          school: current.school || section.school,
          address: current.address || section.address,
        });
      } else {
        existing.set(section.section, section);
      }
    });
    state.personal.sections = sortSections(Array.from(existing.values()));
  }

  function renderCircFilter() {
    const current = els.circFilter.value;
    const circs = Array.from(new Set(state.personal.sections.map((row) => row.circ).filter(Boolean))).sort((a, b) => a - b);
    els.circFilter.innerHTML = `<option value="">Tutte le circoscrizioni</option>${circs.map((circ) => `<option value="${escapeHtml(circ)}">${escapeHtml(circ)}</option>`).join("")}`;
    els.circFilter.value = current;
  }

  function renderSummary() {
    const sections = state.personal.sections;
    const filled = sections.filter((section) => hasPersonalData(section.section)).length;
    const totals = effectiveTargetTotals();
    const prefsTotal = TARGET_CANDIDATES.reduce((sum, candidate) => sum + totals[candidate.key], 0);

    els.metricSections.textContent = formatNumber(sections.length);
    els.metricSectionsMeta.textContent = sections.length ? `${firstSection()}-${lastSection()} sezioni` : "nessun dato";
    els.metricFilled.textContent = formatNumber(filled);
    els.metricFilledMeta.textContent = sections.length ? `${Math.round((filled / sections.length) * 100)}% compilate` : "0%";
    els.metricPrefs.textContent = formatNumber(prefsTotal);
    els.metricListMayor.textContent = `${formatNumber(totals.list)} / ${formatNumber(totals.mayor)}`;
  }

  function renderMonitorTable() {
    const query = normalizeSearch(els.searchInput.value);
    const circ = els.circFilter.value;
    const filledOnly = els.filledOnly.checked;
    const rows = state.personal.sections.filter((row) => {
      const matchesCirc = !circ || String(row.circ) === circ;
      const matchesFilled = !filledOnly || hasPersonalData(row.section);
      const haystack = normalizeSearch(`${row.section} ${row.circ || ""} ${row.school || ""} ${row.address || ""}`);
      return matchesCirc && matchesFilled && (!query || haystack.includes(query));
    });

    if (!rows.length) {
      els.monitorBody.innerHTML = `<tr><td colspan="11" class="muted">Nessuna sezione da mostrare.</td></tr>`;
      return;
    }

    els.monitorBody.innerHTML = rows.map((row) => {
      const value = getSectionValues(row.section);
      return `
        <tr data-section="${escapeHtml(row.section)}">
          <td class="num">${escapeHtml(row.section)}</td>
          <td class="num">${escapeHtml(row.circ || "")}</td>
          <td>${escapeHtml(row.school || "")}</td>
          <td>${escapeHtml(row.address || "")}</td>
          ${TARGET_CANDIDATES.map((candidate) => numberInput(candidate.key, value[candidate.key])).join("")}
          ${numberInput("list", value.list)}
          ${numberInput("mayor", value.mayor)}
          <td><textarea data-field="note">${escapeHtml(value.note || "")}</textarea></td>
        </tr>
      `;
    }).join("");
  }

  function numberInput(field, value) {
    const className = value !== null && value !== undefined && value !== "" ? "changed" : "";
    return `<td><input class="${className}" type="number" min="0" step="1" inputmode="numeric" data-field="${escapeHtml(field)}" value="${escapeHtml(value ?? "")}"></td>`;
  }

  function handleMonitorInput(event) {
    const input = event.target;
    const field = input.dataset.field;
    if (!field) return;

    const row = input.closest("tr");
    const section = row ? toNumber(row.dataset.section) : null;
    if (!section) return;

    const values = getSectionValues(section);
    values[field] = field === "note" ? input.value : parseInputNumber(input.value);
    state.personal.values[section] = values;
    input.classList.toggle("changed", input.value !== "");

    saveState("Salvo...");
    renderSummary();
    renderCharts();
    if (activeTab === "confronto") renderCompare();
  }

  function renderCharts() {
    renderCoverageChart();
    renderCandidateChart();
    renderCircChart();
    renderListMayorChart();
  }

  function renderCoverageChart() {
    const total = state.personal.sections.length;
    const filled = state.personal.sections.filter((section) => hasPersonalData(section.section)).length;
    const percent = total ? Math.round((filled / total) * 100) : 0;
    els.coveragePercent.textContent = `${percent}%`;
    els.coverageBar.style.width = `${percent}%`;
    els.coverageMeta.textContent = `${formatNumber(filled)} sezioni compilate su ${formatNumber(total)}`;
  }

  function renderCandidateChart() {
    const totals = effectiveTargetTotals();
    const rows = TARGET_CANDIDATES.map((candidate) => ({
      label: shortCandidateName(candidate.name),
      value: totals[candidate.key],
    }));
    els.candidateChart.innerHTML = renderBarRows(rows, {
      empty: "Nessuna preferenza consolidata disponibile.",
      fillClass: "bar-fill",
    });
  }

  function renderCircChart() {
    const grouped = new Map();
    state.personal.sections.forEach((row) => {
      const label = row.circ || "n.d.";
      if (!grouped.has(label)) grouped.set(label, { label: `Cir. ${label}`, value: 0, total: 0 });
      const item = grouped.get(label);
      item.total += 1;
      if (hasPersonalData(row.section)) item.value += 1;
    });

    const rows = Array.from(grouped.values())
      .sort((a, b) => String(a.label).localeCompare(String(b.label), "it", { numeric: true }))
      .map((row) => ({
        label: row.label,
        value: row.value,
        total: row.total,
        displayValue: `${formatNumber(row.value)}/${formatNumber(row.total)}`,
      }));

    els.circChart.innerHTML = renderBarRows(rows, {
      empty: "Importa il monitoraggio per vedere le circoscrizioni.",
      fillClass: "bar-fill alt",
      useTotal: true,
    });
  }

  function renderListMayorChart() {
    const consolidated = effectiveTargetTotals();
    const official = officialTargetTotals();
    const rows = [
      { label: "Lista Federico", consolidated: consolidated.list, official: official.list },
      { label: "Sindaco Basile", consolidated: consolidated.mayor, official: official.mayor },
    ];

    const max = Math.max(1, ...rows.flatMap((row) => [row.consolidated, row.official]));
    els.listMayorChart.innerHTML = rows.map((row) => {
      const consolidatedWidth = Math.round((row.consolidated / max) * 100);
      const officialWidth = Math.round((row.official / max) * 100);
      return `
        <div class="bar-row">
          <div class="bar-label">
            <span>${escapeHtml(row.label)}</span>
            <strong>${formatNumber(row.consolidated)} / ${formatNumber(row.official)}</strong>
          </div>
          <div class="paired-track" aria-label="${escapeHtml(row.label)}">
            <div class="bar-track" title="Consolidato"><span class="bar-fill" style="width: ${consolidatedWidth}%"></span></div>
            <div class="bar-track" title="Ufficiale"><span class="bar-fill warn" style="width: ${officialWidth}%"></span></div>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderBarRows(rows, options) {
    const max = Math.max(0, ...rows.map((row) => options.useTotal ? row.total : row.value));
    const hasValues = rows.some((row) => row.value > 0 || row.total > 0);
    if (!rows.length || !hasValues) {
      return `<div class="empty-chart">${escapeHtml(options.empty)}</div>`;
    }

    return rows.map((row) => {
      const denominator = options.useTotal ? row.total : max;
      const width = denominator ? Math.round((row.value / denominator) * 100) : 0;
      const value = row.displayValue || formatNumber(row.value);
      return `
        <div class="bar-row">
          <div class="bar-label">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </div>
          <div class="bar-track"><span class="${escapeHtml(options.fillClass)}" style="width: ${width}%"></span></div>
        </div>
      `;
    }).join("");
  }

  function renderCompare() {
    renderCandidateCompare();
    renderSectionCompare();
  }

  function renderCandidateCompare() {
    const personal = personalTotals();
    const official = officialTargetTotals();
    const effective = effectiveTargetTotals();
    const rows = [
      ...TARGET_CANDIDATES.map((candidate) => ({
        label: candidate.name,
        personal: personal[candidate.key],
        official: official[candidate.key],
        effective: effective[candidate.key],
      })),
      { label: "Lista Federico per Messina", personal: personal.list, official: official.list, effective: effective.list },
      { label: "Sindaco Basile", personal: personal.mayor, official: official.mayor, effective: effective.mayor },
    ];

    els.candidateCompareBody.innerHTML = rows.map((row) => {
      const delta = row.effective - row.official;
      return `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td class="num">${formatNumber(row.effective)}</td>
          <td class="num">${formatNumber(row.personal)}</td>
          <td class="num">${formatNumber(row.official)}</td>
          <td class="delta ${deltaClass(delta)}">${formatDelta(delta)}</td>
        </tr>
      `;
    }).join("");
  }

  function renderSectionCompare() {
    const rows = buildSectionComparisons();
    const visible = compareOnlyDiffs ? rows.filter((row) => row.delta !== 0) : rows;
    if (!visible.length) {
      els.sectionCompareBody.innerHTML = `<tr><td colspan="6" class="muted">Nessuna voce da confrontare.</td></tr>`;
      return;
    }

    els.sectionCompareBody.innerHTML = visible.map((row) => `
      <tr>
        <td class="num">${escapeHtml(row.section)}</td>
        <td>${escapeHtml(row.label)}</td>
        <td class="num">${formatNumber(row.effective)}</td>
        <td>${escapeHtml(row.source)}</td>
        <td class="num">${formatNumber(row.official)}</td>
        <td class="delta ${deltaClass(row.delta)}">${formatDelta(row.delta)}</td>
      </tr>
    `).join("");
  }

  function buildSectionComparisons() {
    const rows = [];
    Array.from(monitoredSectionSet()).sort((a, b) => a - b).forEach((section) => {
      TARGET_CANDIDATES.forEach((candidate) => {
        const official = officialPrefForSection(section, candidate.number);
        const effective = effectiveValueForSection(section, candidate.key, official);
        if (effective.value || official) {
          rows.push({
            section,
            label: candidate.name,
            effective: effective.value,
            source: effective.source,
            official,
            delta: effective.value - official,
          });
        }
      });

      const listOfficial = officialListForSection(section, TARGET_LIST.number);
      const effectiveList = effectiveValueForSection(section, "list", listOfficial);
      if (effectiveList.value || listOfficial) {
        rows.push({
          section,
          label: "Lista Federico",
          effective: effectiveList.value,
          source: effectiveList.source,
          official: listOfficial,
          delta: effectiveList.value - listOfficial,
        });
      }

      const mayorOfficial = officialMayorForSection(section, TARGET_MAYOR.number);
      const effectiveMayor = effectiveValueForSection(section, "mayor", mayorOfficial);
      if (effectiveMayor.value || mayorOfficial) {
        rows.push({
          section,
          label: "Sindaco Basile",
          effective: effectiveMayor.value,
          source: effectiveMayor.source,
          official: mayorOfficial,
          delta: effectiveMayor.value - mayorOfficial,
        });
      }
    });
    return rows;
  }

  function handleCouncilSeatsInput(event) {
    const value = Math.max(1, Math.min(80, toNumber(event.target.value) || DEFAULT_COUNCIL_SEATS));
    state.settings.councilSeats = value;
    saveState("Salvato");
    renderSeatAllocation();
  }

  function handleCoalitionChange(event) {
    const select = event.target;
    const listNumber = select.dataset.listNumber;
    if (!listNumber) return;
    state.settings.coalitions[listNumber] = toNumber(select.value) || null;
    saveState("Salvato");
    renderSeatAllocation();
    renderCoalitionMapping();
  }

  function renderOfficial() {
    ensureCoalitionDefaults();
    renderSeatAllocation();
    renderCoalitionMapping();
    renderMayorOfficial();
    renderListOfficial();
    renderPrefOfficial();
    renderTotalsOfficial();
  }

  function renderSeatAllocation() {
    els.councilSeatsInput.value = state.settings.councilSeats || DEFAULT_COUNCIL_SEATS;
    const result = calculateSeatAllocation();
    if (!result.rows.length) {
      els.seatSummary.textContent = "Importa i voti di lista e sindaco per calcolare i seggi.";
      els.federicoSeatHighlight.innerHTML = `<span>Federico per Messina</span><strong>0 seggi</strong>`;
      els.seatAllocationBody.innerHTML = `<tr><td colspan="6" class="muted">Nessun dato di lista importato.</td></tr>`;
      return;
    }

    els.seatSummary.textContent = result.summary;
    const federico = result.rows.find((row) => row.listNumber === TARGET_LIST.number);
    els.federicoSeatHighlight.innerHTML = `
      <span>Federico per Messina</span>
      <strong>${formatNumber(federico ? federico.seats : 0)} seggi</strong>
    `;

    els.seatAllocationBody.innerHTML = result.rows.map((row) => `
      <tr class="${row.listNumber === TARGET_LIST.number ? "target-row" : ""} ${row.eligible ? "" : "threshold-out"}">
        <td>${escapeHtml(row.listNumber)} - ${escapeHtml(row.listName)}</td>
        <td>${escapeHtml(row.mayorName || "Non collegata")}</td>
        <td class="num">${formatNumber(row.votes)}</td>
        <td class="num">${formatPercent(row.votePct)}</td>
        <td class="num">${formatNumber(row.seats)}</td>
        <td>${escapeHtml(row.note)}</td>
      </tr>
    `).join("");
  }

  function renderCoalitionMapping() {
    const lists = sumBy(state.official.lists, "listNumber", "listName");
    const mayors = availableMayors();
    if (!lists.length) {
      els.coalitionMappingBody.innerHTML = `<tr><td colspan="3" class="muted">Importa prima il CSV dei voti di lista.</td></tr>`;
      return;
    }

    els.coalitionMappingBody.innerHTML = lists.map((list) => {
      const current = String(state.settings.coalitions[list.number] || "");
      return `
        <tr class="${list.number === TARGET_LIST.number ? "target-row" : ""}">
          <td class="num">${escapeHtml(list.number)}</td>
          <td>${escapeHtml(list.name)}</td>
          <td>
            <select class="coalition-select" data-list-number="${escapeHtml(list.number)}">
              <option value="">Non collegata</option>
              ${mayors.map((mayor) => `
                <option value="${escapeHtml(mayor.number)}" ${String(mayor.number) === current ? "selected" : ""}>
                  ${escapeHtml(mayor.number)} - ${escapeHtml(mayor.name)}
                </option>
              `).join("")}
            </select>
          </td>
        </tr>
      `;
    }).join("");
  }

  function renderMayorOfficial() {
    const rows = sumBy(state.official.mayors, "mayorNumber", "mayorName");
    els.mayorOfficialBody.innerHTML = renderNumberNameRows(rows, "Nessun CSV sindaco importato.");
  }

  function renderListOfficial() {
    const rows = sumBy(state.official.lists, "listNumber", "listName");
    els.listOfficialBody.innerHTML = renderNumberNameRows(rows, "Nessun CSV liste importato.");
  }

  function renderPrefOfficial() {
    const rows = sumBy(state.official.prefs, "candidateNumber", "candidateName");
    els.prefOfficialBody.innerHTML = renderNumberNameRows(rows, "Nessun CSV preferenze importato.");
  }

  function renderTotalsOfficial() {
    const totals = state.official.totals.reduce((acc, row) => {
      acc.invalidVotes += toNumber(row.invalidVotes);
      acc.invalidBallots += toNumber(row.invalidBallots);
      acc.blankBallots += toNumber(row.blankBallots);
      acc.contested += toNumber(row.contested);
      return acc;
    }, { invalidVotes: 0, invalidBallots: 0, blankBallots: 0, contested: 0 });

    const rows = [
      ["Voti nulli", totals.invalidVotes],
      ["Schede nulle", totals.invalidBallots],
      ["Schede bianche", totals.blankBallots],
      ["Contestati non assegnati", totals.contested],
    ];

    els.totalsOfficialBody.innerHTML = rows.map(([label, value]) => `
      <tr><td>${escapeHtml(label)}</td><td class="num">${formatNumber(value)}</td></tr>
    `).join("");
  }

  function calculateSeatAllocation() {
    const totalSeats = Math.max(1, toNumber(state.settings.councilSeats) || DEFAULT_COUNCIL_SEATS);
    const lists = sumBy(state.official.lists, "listNumber", "listName");
    const totalListVotes = lists.reduce((sum, row) => sum + toNumber(row.votes), 0);
    if (!lists.length || !totalListVotes) {
      return { rows: [], summary: "Importa i voti di lista e sindaco per calcolare i seggi." };
    }

    const mayors = availableMayors();
    const mayorByNumber = new Map(mayors.map((mayor) => [mayor.number, mayor]));
    const mayorTotals = sumBy(state.official.mayors, "mayorNumber", "mayorName");
    const totalMayorVotes = mayorTotals.reduce((sum, row) => sum + toNumber(row.votes), 0);
    const winningMayor = mayorTotals.slice().sort((a, b) => b.votes - a.votes)[0] || null;
    const winningMayorPct = winningMayor && totalMayorVotes ? (winningMayor.votes / totalMayorVotes) * 100 : 0;
    const firstRoundElected = Boolean(winningMayor && winningMayorPct >= 40);
    const thresholdVotes = totalListVotes * 0.05;

    const enrichedLists = lists.map((list) => {
      const mayorNumber = toNumber(state.settings.coalitions[list.number]);
      return {
        ...list,
        listNumber: list.number,
        listName: list.name,
        mayorNumber,
        mayorName: mayorByNumber.get(mayorNumber)?.name || "",
        votePct: totalListVotes ? (list.votes / totalListVotes) * 100 : 0,
        eligible: list.votes >= thresholdVotes,
        seats: 0,
        note: list.votes >= thresholdVotes ? "" : "sotto 5%",
      };
    });

    const eligibleLists = enrichedLists.filter((list) => list.eligible);
    if (!eligibleLists.length) {
      return {
        rows: enrichedLists.sort(sortSeatsRows),
        summary: "Nessuna lista supera la soglia del 5% sui voti ufficiali importati.",
      };
    }

    const groups = buildGroups(eligibleLists);
    let groupSeats = allocateDhondt(groups, totalSeats);
    const eligibleTotalVotes = eligibleLists.reduce((sum, list) => sum + list.votes, 0);
    const majoritySeats = Math.ceil(totalSeats * 0.6);
    const winningGroup = winningMayor ? groups.find((group) => group.key === String(winningMayor.number)) : null;
    const otherGroupOverHalf = groups.some((group) => {
      return (!winningMayor || group.key !== String(winningMayor.number)) && group.votes > eligibleTotalVotes / 2;
    });
    const winningGroupVotes = winningGroup ? winningGroup.votes : 0;
    const winningGroupPct = eligibleTotalVotes ? (winningGroupVotes / eligibleTotalVotes) * 100 : 0;
    const baseWinnerSeats = winningGroup ? (groupSeats.get(winningGroup.key) || 0) : 0;
    const canApplyBonus = Boolean(
      winningGroup
      && firstRoundElected
      && winningGroupPct >= 40
      && baseWinnerSeats < majoritySeats
      && !otherGroupOverHalf
    );

    if (canApplyBonus) {
      const otherGroups = groups.filter((group) => group.key !== winningGroup.key);
      groupSeats = allocateDhondt(otherGroups, totalSeats - majoritySeats);
      groupSeats.set(winningGroup.key, majoritySeats);
    }

    groups.forEach((group) => {
      const seatsForGroup = groupSeats.get(group.key) || 0;
      const listSeats = allocateDhondt(group.lists, seatsForGroup);
      group.lists.forEach((list) => {
        list.seats = listSeats.get(String(list.listNumber)) || 0;
        if (canApplyBonus && group.key === String(winningMayor.number)) {
          list.note = list.note || "coalizione premio";
        }
      });
    });

    const rows = enrichedLists.sort(sortSeatsRows);
    const winnerText = winningMayor
      ? `${winningMayor.name} ${formatPercent(winningMayorPct)}`
      : "sindaco non disponibile";
    const bonusText = canApplyBonus
      ? `premio applicato: ${majoritySeats} seggi alla coalizione ${winningMayor.name}`
      : "premio non applicato con i dati importati";
    return {
      rows,
      summary: `${totalSeats} seggi, soglia 5%, sindaco leader: ${winnerText}; ${bonusText}.`,
    };
  }

  function buildGroups(lists) {
    const byMayor = new Map();
    lists.forEach((list) => {
      const key = list.mayorNumber ? String(list.mayorNumber) : `list-${list.listNumber}`;
      if (!byMayor.has(key)) {
        byMayor.set(key, { key, votes: 0, lists: [] });
      }
      const group = byMayor.get(key);
      group.votes += list.votes;
      group.lists.push(list);
    });
    return Array.from(byMayor.values());
  }

  function allocateDhondt(items, seats) {
    const allocation = new Map();
    items.forEach((item) => allocation.set(String(item.key || item.listNumber || item.number), 0));
    if (!items.length || seats <= 0) return allocation;

    const quotients = [];
    items.forEach((item) => {
      const key = String(item.key || item.listNumber || item.number);
      for (let divisor = 1; divisor <= seats; divisor += 1) {
        quotients.push({ key, quotient: item.votes / divisor, votes: item.votes });
      }
    });
    quotients.sort((a, b) => b.quotient - a.quotient || b.votes - a.votes || a.key.localeCompare(b.key, "it", { numeric: true }));
    quotients.slice(0, seats).forEach((item) => {
      allocation.set(item.key, (allocation.get(item.key) || 0) + 1);
    });
    return allocation;
  }

  function ensureCoalitionDefaults() {
    if (!state.settings) state.settings = { councilSeats: DEFAULT_COUNCIL_SEATS, coalitions: { ...DEFAULT_COALITIONS } };
    if (!state.settings.coalitions) state.settings.coalitions = { ...DEFAULT_COALITIONS };
    sumBy(state.official.lists, "listNumber", "listName").forEach((list) => {
      if (state.settings.coalitions[list.number] === undefined) {
        state.settings.coalitions[list.number] = DEFAULT_COALITIONS[list.number] || null;
      }
    });
  }

  function availableMayors() {
    const imported = sumBy(state.official.mayors, "mayorNumber", "mayorName");
    const byNumber = new Map(MAYOR_FALLBACKS.map((mayor) => [mayor.number, { ...mayor, votes: 0 }]));
    imported.forEach((mayor) => byNumber.set(mayor.number, mayor));
    return Array.from(byNumber.values()).sort((a, b) => a.number - b.number);
  }

  function sortSeatsRows(a, b) {
    if (a.listNumber === TARGET_LIST.number) return -1;
    if (b.listNumber === TARGET_LIST.number) return 1;
    return b.seats - a.seats || b.votes - a.votes || a.listNumber - b.listNumber;
  }

  function renderNumberNameRows(rows, emptyText) {
    if (!rows.length) return `<tr><td colspan="3" class="muted">${emptyText}</td></tr>`;
    return rows.map((row) => `
      <tr>
        <td class="num">${escapeHtml(row.number)}</td>
        <td>${escapeHtml(row.name)}</td>
        <td class="num">${formatNumber(row.votes)}</td>
      </tr>
    `).join("");
  }

  function personalTotals() {
    const totals = { list: 0, mayor: 0 };
    TARGET_CANDIDATES.forEach((candidate) => {
      totals[candidate.key] = 0;
    });
    Object.values(state.personal.values).forEach((values) => {
      TARGET_CANDIDATES.forEach((candidate) => {
        totals[candidate.key] += toNumber(values[candidate.key]);
      });
      totals.list += toNumber(values.list);
      totals.mayor += toNumber(values.mayor);
    });
    return totals;
  }

  function officialTargetTotals() {
    const totals = { list: 0, mayor: 0 };
    TARGET_CANDIDATES.forEach((candidate) => {
      totals[candidate.key] = state.official.prefs
        .filter((row) => row.candidateNumber === candidate.number)
        .reduce((sum, row) => sum + toNumber(row.votes), 0);
    });
    totals.list = state.official.lists
      .filter((row) => row.listNumber === TARGET_LIST.number)
      .reduce((sum, row) => sum + toNumber(row.votes), 0);
    totals.mayor = state.official.mayors
      .filter((row) => row.mayorNumber === TARGET_MAYOR.number)
      .reduce((sum, row) => sum + toNumber(row.votes), 0);
    return totals;
  }

  function effectiveTargetTotals() {
    const totals = { list: 0, mayor: 0 };
    TARGET_CANDIDATES.forEach((candidate) => {
      totals[candidate.key] = 0;
    });

    Array.from(monitoredSectionSet()).forEach((section) => {
      TARGET_CANDIDATES.forEach((candidate) => {
        const official = officialPrefForSection(section, candidate.number);
        totals[candidate.key] += effectiveValueForSection(section, candidate.key, official).value;
      });
      const listOfficial = officialListForSection(section, TARGET_LIST.number);
      totals.list += effectiveValueForSection(section, "list", listOfficial).value;
      const mayorOfficial = officialMayorForSection(section, TARGET_MAYOR.number);
      totals.mayor += effectiveValueForSection(section, "mayor", mayorOfficial).value;
    });

    return totals;
  }

  function monitoredSectionSet() {
    const sections = new Set(state.personal.sections.map((row) => row.section));
    Object.keys(state.personal.values).forEach((section) => sections.add(toNumber(section)));
    state.official.prefs
      .filter((row) => TARGET_CANDIDATES.some((candidate) => candidate.number === row.candidateNumber))
      .forEach((row) => sections.add(row.section));
    state.official.lists
      .filter((row) => row.listNumber === TARGET_LIST.number)
      .forEach((row) => sections.add(row.section));
    state.official.mayors
      .filter((row) => row.mayorNumber === TARGET_MAYOR.number)
      .forEach((row) => sections.add(row.section));
    sections.delete(0);
    return sections;
  }

  function effectiveValueForSection(section, field, officialValue) {
    const manual = manualValueForSection(section, field);
    if (manual !== null) {
      return { value: manual, source: "manuale" };
    }
    return { value: toNumber(officialValue), source: "ufficiale" };
  }

  function manualValueForSection(section, field) {
    const values = state.personal.values[section];
    if (!values) return null;
    const value = values[field];
    if (value === null || value === undefined || value === "") return null;
    return toNumber(value);
  }

  function sumBy(rows, numberKey, nameKey) {
    const byNumber = new Map();
    rows.forEach((row) => {
      const number = row[numberKey];
      if (!byNumber.has(number)) {
        byNumber.set(number, { number, name: row[nameKey], votes: 0 });
      }
      byNumber.get(number).votes += toNumber(row.votes);
    });
    return Array.from(byNumber.values()).sort((a, b) => a.number - b.number);
  }

  function officialPrefForSection(section, candidateNumber) {
    return state.official.prefs
      .filter((row) => row.section === section && row.candidateNumber === candidateNumber)
      .reduce((sum, row) => sum + toNumber(row.votes), 0);
  }

  function officialListForSection(section, listNumber) {
    return state.official.lists
      .filter((row) => row.section === section && row.listNumber === listNumber)
      .reduce((sum, row) => sum + toNumber(row.votes), 0);
  }

  function officialMayorForSection(section, mayorNumber) {
    return state.official.mayors
      .filter((row) => row.section === section && row.mayorNumber === mayorNumber)
      .reduce((sum, row) => sum + toNumber(row.votes), 0);
  }

  function exportMonitorCsv() {
    const rows = state.personal.sections.map((sectionRow) => {
      const values = getSectionValues(sectionRow.section);
      return {
        "Istituto/Plesso": sectionRow.school || "",
        "Via e Numero Civico": sectionRow.address || "",
        "Circoscrizione": sectionRow.circ || "",
        "Sezione": sectionRow.section,
        "Voti Francesco Romano": valueForExport(values.romano),
        "Voti Francesca Guadagna": valueForExport(values.guadagna),
        "Voti Marina Nicoletti": valueForExport(values.nicoletti),
        "Voti Lucrezia Riso": valueForExport(values.riso),
        "Voti Lista Federico per Messina": valueForExport(values.list),
        "Voti Sindaco Basile": valueForExport(values.mayor),
        "Note": values.note || "",
      };
    });
    downloadText("monitoraggio_personale.csv", toCsv(rows, MONITOR_HEADERS), "text/csv;charset=utf-8");
  }

  function exportLongCsv() {
    const rows = [];
    Array.from(monitoredSectionSet()).sort((a, b) => a - b).forEach((sectionNumber) => {
      const sectionRow = getSectionMeta(sectionNumber);
      const section = sectionRow.section;
      TARGET_CANDIDATES.forEach((candidate) => {
        const official = officialPrefForSection(section, candidate.number);
        const manual = manualValueForSection(section, candidate.key);
        const effective = effectiveValueForSection(section, candidate.key, official);
        rows.push({
          sezione: section,
          circoscrizione: sectionRow.circ || "",
          tipo: "preferenza",
          numero: candidate.number,
          nome: candidate.name,
          voti: effective.value,
          fonte_usata: effective.source,
          voti_manuali: valueForExport(manual),
          voti_ufficiali: official,
          note: getSectionValues(section).note || "",
        });
      });
      const listOfficial = officialListForSection(section, TARGET_LIST.number);
      const listManual = manualValueForSection(section, "list");
      const listEffective = effectiveValueForSection(section, "list", listOfficial);
      rows.push({
        sezione: section,
        circoscrizione: sectionRow.circ || "",
        tipo: "lista",
        numero: TARGET_LIST.number,
        nome: "Federico per Messina",
        voti: listEffective.value,
        fonte_usata: listEffective.source,
        voti_manuali: valueForExport(listManual),
        voti_ufficiali: listOfficial,
        note: getSectionValues(section).note || "",
      });
      const mayorOfficial = officialMayorForSection(section, TARGET_MAYOR.number);
      const mayorManual = manualValueForSection(section, "mayor");
      const mayorEffective = effectiveValueForSection(section, "mayor", mayorOfficial);
      rows.push({
        sezione: section,
        circoscrizione: sectionRow.circ || "",
        tipo: "sindaco",
        numero: TARGET_MAYOR.number,
        nome: "Basile Federico",
        voti: mayorEffective.value,
        fonte_usata: mayorEffective.source,
        voti_manuali: valueForExport(mayorManual),
        voti_ufficiali: mayorOfficial,
        note: getSectionValues(section).note || "",
      });
    });
    downloadText("monitoraggio_consolidato_formato_lungo.csv", toCsv(rows), "text/csv;charset=utf-8");
  }

  function exportBackupJson() {
    downloadText("backup_monitoraggio_elezioni.json", JSON.stringify(state, null, 2), "application/json;charset=utf-8");
  }

  async function importBackupJson(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const raw = await readTextFile(file);
      const next = mergeDefaults(JSON.parse(raw));
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, next);
      saveState("Salvato");
      renderAll();
      showToast("Backup importato");
    } catch (error) {
      console.error(error);
      showToast("Backup non valido");
    } finally {
      event.target.value = "";
    }
  }

  function resetAll() {
    const ok = window.confirm("Vuoi azzerare tutti i dati salvati in questo browser?");
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, createEmptyState());
    renderAll();
    showToast("Dati azzerati");
  }

  async function readTextFile(file) {
    return await file.text();
  }

  async function readFirstWorksheet(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const workbookXml = await readZipText(zip, "xl/workbook.xml");
    const relsXml = await readZipText(zip, "xl/_rels/workbook.xml.rels");
    const sharedStrings = await readSharedStrings(zip);
    const parser = new DOMParser();
    const workbook = parser.parseFromString(workbookXml, "application/xml");
    const rels = parser.parseFromString(relsXml, "application/xml");
    const relMap = new Map();

    Array.from(rels.querySelectorAll("Relationship")).forEach((rel) => {
      relMap.set(rel.getAttribute("Id"), rel.getAttribute("Target"));
    });

    const sheets = Array.from(workbook.querySelectorAll("sheet"));
    const targetSheet = sheets.find((sheet) => sheet.getAttribute("name") === "Dati Unificati") || sheets[0];
    if (!targetSheet) throw new Error("Nessun foglio trovato");

    const relId = targetSheet.getAttribute("r:id") || targetSheet.getAttribute("id");
    let target = relMap.get(relId);
    if (!target) throw new Error("Foglio non leggibile");
    if (!target.startsWith("xl/")) target = `xl/${target.replace(/^\/+/, "")}`;
    const sheetXml = await readZipText(zip, target);
    return parseWorksheetXml(sheetXml, sharedStrings);
  }

  async function readZipText(zip, path) {
    const file = zip.file(path);
    if (!file) throw new Error(`File mancante nel workbook: ${path}`);
    return await file.async("text");
  }

  async function readSharedStrings(zip) {
    const file = zip.file("xl/sharedStrings.xml");
    if (!file) return [];
    const xml = await file.async("text");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return Array.from(doc.querySelectorAll("si")).map((si) => {
      return Array.from(si.querySelectorAll("t")).map((t) => t.textContent || "").join("");
    });
  }

  function parseWorksheetXml(xml, sharedStrings) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const rows = [];
    Array.from(doc.querySelectorAll("sheetData row")).forEach((rowEl) => {
      const rowIndex = Number(rowEl.getAttribute("r")) || rows.length + 1;
      const row = [];
      Array.from(rowEl.querySelectorAll("c")).forEach((cell) => {
        const ref = cell.getAttribute("r") || "";
        const colIndex = columnIndex(ref.replace(/[0-9]/g, ""));
        row[colIndex] = cellValue(cell, sharedStrings);
      });
      rows[rowIndex - 1] = row;
    });
    return rows.filter(Boolean);
  }

  function cellValue(cell, sharedStrings) {
    const type = cell.getAttribute("t");
    if (type === "inlineStr") {
      return Array.from(cell.querySelectorAll("is t")).map((node) => node.textContent || "").join("");
    }
    const valueNode = cell.querySelector("v");
    const raw = valueNode ? valueNode.textContent : "";
    if (type === "s") return sharedStrings[Number(raw)] || "";
    if (type === "str") return raw;
    if (raw === "") return "";
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw;
  }

  function columnIndex(letters) {
    let index = 0;
    for (let i = 0; i < letters.length; i += 1) {
      index = index * 26 + letters.charCodeAt(i) - 64;
    }
    return Math.max(0, index - 1);
  }

  function parseDelimited(text, delimiter) {
    const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < clean.length; i += 1) {
      const char = clean[i];
      const next = clean[i + 1];
      if (char === '"') {
        if (inQuotes && next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        row.push(cell);
        cell = "";
      } else if (char === "\n" && !inQuotes) {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    if (cell !== "" || row.length) {
      row.push(cell);
      rows.push(row);
    }

    const headers = rows.shift();
    if (!headers) return [];
    return rows
      .filter((items) => items.some((item) => item !== ""))
      .map((items) => objectFromHeaders(headers, items));
  }

  function objectFromHeaders(headers, values) {
    const row = {};
    headers.forEach((header, index) => {
      row[textValue(header)] = values[index] ?? "";
    });
    return row;
  }

  function normalizeObject(row) {
    const normalized = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[normalizeKey(key)] = value;
    });
    return normalized;
  }

  function normalizeKey(key) {
    return textValue(key)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function uniqueSections(sections) {
    const bySection = new Map();
    sections.forEach((row) => {
      if (!bySection.has(row.section)) bySection.set(row.section, row);
    });
    return Array.from(bySection.values());
  }

  function sortSections(sections) {
    return sections.sort((a, b) => a.section - b.section);
  }

  function getSectionValues(section) {
    if (!state.personal.values[section]) {
      state.personal.values[section] = emptySectionValues();
    }
    return state.personal.values[section];
  }

  function emptySectionValues() {
    return {
      romano: null,
      guadagna: null,
      nicoletti: null,
      riso: null,
      list: null,
      mayor: null,
      note: "",
    };
  }

  function hasPersonalData(section) {
    const values = getSectionValues(section);
    return TARGET_CANDIDATES.some((candidate) => values[candidate.key] !== null && values[candidate.key] !== "")
      || values.list !== null && values.list !== ""
      || values.mayor !== null && values.mayor !== ""
      || Boolean(values.note);
  }

  function getSectionMeta(section) {
    return state.personal.sections.find((row) => row.section === section) || {
      section,
      school: "",
      address: "",
      circ: null,
    };
  }

  function firstSection() {
    if (!state.personal.sections.length) return "";
    return state.personal.sections[0].section;
  }

  function lastSection() {
    if (!state.personal.sections.length) return "";
    return state.personal.sections[state.personal.sections.length - 1].section;
  }

  function coalesceImported(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback ?? null;
    return toNumber(value);
  }

  function coalesceImportedText(value, fallback) {
    const text = textValue(value);
    return text ? text : fallback || "";
  }

  function parseInputNumber(value) {
    if (value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null;
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const normalized = String(value).trim().replace(",", ".");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  function textValue(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function valueForExport(value) {
    return value === null || value === undefined ? "" : value;
  }

  function normalizeSearch(value) {
    return textValue(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function shortCandidateName(name) {
    const parts = textValue(name).split(/\s+/);
    if (parts.length <= 1) return name;
    return parts[parts.length - 1];
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("it-IT").format(toNumber(value));
  }

  function formatDelta(value) {
    const number = toNumber(value);
    if (number === 0) return "0";
    return `${number > 0 ? "+" : ""}${formatNumber(number)}`;
  }

  function formatPercent(value) {
    return `${new Intl.NumberFormat("it-IT", {
      maximumFractionDigits: 1,
      minimumFractionDigits: value > 0 && value < 1 ? 1 : 0,
    }).format(toNumber(value))}%`;
  }

  function deltaClass(value) {
    const number = toNumber(value);
    if (number > 0) return "positive";
    if (number < 0) return "negative";
    return "";
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  }

  function setBusyStatus(kind, text) {
    const el = document.getElementById(`status-${kind}`);
    if (el) el.textContent = text;
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function escapeHtml(value) {
    return textValue(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function toCsv(rows, headers) {
    const cols = headers || Array.from(rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set()));
    const lines = [cols.join(";")];
    rows.forEach((row) => {
      lines.push(cols.map((col) => csvCell(row[col])).join(";"));
    });
    return `\uFEFF${lines.join("\r\n")}`;
  }

  function csvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);
    if (/[;"\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function downloadText(fileName, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`Esportato: ${fileName}`);
  }
})();
