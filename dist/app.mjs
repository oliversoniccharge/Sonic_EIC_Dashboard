import { analyse, isoDate } from "./meter.mjs";
import { renderAccumulated, downloadPeriods } from "./accumulated.mjs";
const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 });
let catalog,
  site,
  current = "",
  requestId = 0;
const charts = {};
const dateText = (d) =>
  d
    ? new Date(d + "T00:00:00").toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "No readings";
function error(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
function number(value) {
  return value == null ? "—" : fmt.format(value);
}
async function json(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok)
    throw new Error(
      r.status === 404
        ? "No published meter dataset is available yet."
        : "Meter data could not be loaded. Please refresh.",
    );
  return r.json();
}
function renderSites() {
  const term = $("search").value.toLowerCase();
  $("siteList").replaceChildren();
  for (const s of catalog.sites.filter((s) =>
    `${s.name} ${s.nmi} ${s.address || ""}`.toLowerCase().includes(term),
  )) {
    const b = document.createElement("button");
    b.className = "site-button" + (s.nmi === current ? " active" : "");
    b.setAttribute("aria-pressed", String(s.nmi === current));
    const name = document.createElement("strong");
    name.textContent = s.name;
    const meta = document.createElement("small");
    meta.textContent = `${s.nmi} · ${s.latest ? dateText(isoDate(s.latest)) : "Awaiting readings"}`;
    b.append(name, meta);
    b.onclick = () => selectSite(s.nmi);
    $("siteList").append(b);
  }
}
async function selectSite(nmi) {
  if (!catalog.sites.some((s) => s.nmi === nmi))
    throw new Error("Unknown site");
  const ticket = ++requestId;
  error("");
  try {
    const data = await json(`data/sites/${encodeURIComponent(nmi)}.json`);
    if (ticket !== requestId) return;
    site = data;
    current = nmi;
    history.replaceState(null, "", `?site=${encodeURIComponent(nmi)}`);
    $("siteName").textContent = site.name;
    $("nmi").textContent = `NMI ${site.nmi}`;
    $("address").textContent =
      site.address || "Site name pending standing data";
    $("advanced").href = `analysis.html?site=${encodeURIComponent(nmi)}`;
    $("advanced").hidden = !site.channels.length;
    $("download").disabled = !site.channels.length && !site.accumulated?.length;
    document.querySelectorAll(".timeline, .chart-grid").forEach(el => el.hidden = !site.channels.length);
    $("registers").closest("article").hidden = !site.channels.length;
    $("from").value = site.first ? isoDate(site.first) : "";
    $("to").value = site.latest ? isoDate(site.latest) : "";
    renderSites();
    render();
    return { nmi: site.nmi, name: site.name };
  } catch (e) {
    error(e.message);
    throw e;
  }
}
function chart(id, type, labels, datasets) {
  charts[id]?.destroy();
  if (!window.Chart) {
    document
      .querySelectorAll(".chart-fallback")
      .forEach((el) => (el.hidden = false));
    return;
  }
  charts[id] = new Chart($(id), {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { color: "#a3b4c5", boxWidth: 12 },
        },
        tooltip: {
          callbacks: {
            label: (c) => `${c.dataset.label}: ${number(c.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#a3b4c5", maxTicksLimit: 8 },
        },
        y: {
          beginAtZero: true,
          grid: { color: "#263440" },
          ticks: { color: "#a3b4c5" },
        },
      },
    },
  });
}
function render() {
  if (!site) return;
  const from = $("from").value,
    to = $("to").value;
  if (from && to && from > to) {
    error("Choose a start date on or before the end date.");
    return;
  }
  error("");
  const a = analyse(site, from, to);
  $("import").textContent = number(a.imported);
  $("export").textContent = number(a.exported);
  $("peak").textContent = number(a.peak);
  $("latest").textContent = dateText(isoDate(site.latest));
  $("coverage").textContent =
    `${a.dates.length.toLocaleString()} days in selection`;
  $("dateRange").textContent = a.dates.length
    ? `${dateText(a.dates[0])} – ${dateText(a.dates.at(-1))}`
    : "No interval readings";
  $("dataNote").textContent = !site.channels.length
    ? "Standing data received. Interval readings have not arrived yet."
    : !a.dates.length
      ? "No readings in this date range."
      : `${a.missing.toLocaleString()} missing intervals · ${a.estimated.toLocaleString()} intervals flagged other than actual${a.exported === null ? " · Export register unavailable" : ""}. Missing values are not assumed to be zero. Partial register coverage can understate total site demand.`;
  chart("energyChart", "bar", a.dates, [
    {
      label: "Import (kWh)",
      data: a.dates.map((d) => a.days[d].import),
      backgroundColor: "#03c0c1",
      borderRadius: 2,
    },
    {
      label: "Export (kWh)",
      data: a.dates.map((d) => a.days[d].export),
      backgroundColor: "#ffbd6a",
      borderRadius: 2,
    },
  ]);
  chart(
    "profileChart",
    "line",
    a.profile.map(
      (_, i) =>
        `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
    ),
    [
      {
        label: "Demand (kW)",
        data: a.profile,
        borderColor: "#03c0c1",
        backgroundColor: "#03c0c118",
        fill: true,
        pointRadius: 0,
        tension: 0.15,
      },
    ],
  );
  const months = Object.keys(a.monthly).sort();
  chart("monthlyChart", "bar", months, [
    {
      label: "Import (kWh)",
      data: months.map((m) => a.monthly[m]),
      backgroundColor: "#03c0c1",
      borderRadius: 3,
    },
  ]);
  $("registers").replaceChildren();
  for (const ch of site.channels) {
    const tr = document.createElement("tr");
    const dates = Object.keys(ch.days).sort();
    const q = new Set(Object.values(ch.days).flatMap((r) => r.quality || []));
    for (const value of [
      ch.suffix,
      ch.meter || "—",
      ch.unit,
      `${ch.interval} min`,
      dates.length
        ? `${dateText(isoDate(dates[0]))} – ${dateText(isoDate(dates.at(-1)))}`
        : "—",
      [...q].sort().join(", ") || "Unknown",
    ]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    $("registers").append(tr);
  }
  $("sourceSummary").textContent =
    `${site.sources.length} received files · Revised readings are merged by meter, register, interval and source update time.`;
  $("sources").replaceChildren();
  for (const s of site.sources.slice().reverse()) {
    const li = document.createElement("li");
    li.textContent = `${s.filename} · received ${new Date(s.received).toLocaleDateString("en-AU")}`;
    $("sources").append(li);
  }
  renderAccumulated(site, from, to);
  if (!site.channels.length && site.accumulated?.length)
    $("dataNote").textContent =
      "Accumulated readings received. See the complete read periods below; interval energy and demand charts are unavailable.";
}
function csvCell(x) {
  let s = String(x ?? "");
  if (/^[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
function download() {
  if (!site) return;
  if (!site.channels.length)
    return downloadPeriods(site, $("from").value, $("to").value);
  const rows = [
    [
      "NMI",
      "Meter",
      "Register",
      "Unit",
      "Date",
      "Interval start",
      "Interval minutes",
      "Value",
      "Quality",
    ],
  ];
  for (const c of site.channels) {
    for (const [d, r] of Object.entries(c.days).sort()) {
      const date = isoDate(d);
      if (
        ($("from").value && date < $("from").value) ||
        ($("to").value && date > $("to").value)
      )
        continue;
      r.values.forEach((v, i) => {
        const m = i * c.interval;
        rows.push([
          site.nmi,
          c.meter,
          c.suffix,
          c.unit,
          date,
          `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
          c.interval,
          v,
          r.quality?.[i],
        ]);
      });
    }
  }
  const url = URL.createObjectURL(
    new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `meter-${site.nmi}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function init() {
  try {
    catalog = await json("data/catalog.json");
    $("siteCount").textContent = catalog.sites.length;
    $("syncStatus").textContent = catalog.sync.errors?.length
      ? "Collection needs attention"
      : catalog.sync.lastSuccess
        ? "Email collection checked"
        : "Initial collection in progress";
    $("lastSync").textContent = catalog.sync.lastSuccess
      ? new Date(catalog.sync.lastSuccess).toLocaleString("en-AU", {
          timeZone: "Australia/Perth",
          dateStyle: "medium",
          timeStyle: "short",
        }) + " AWST"
      : "Not completed yet";
    $("syncDetail").textContent =
      (catalog.sync.schedule || "Daily email collection · Australia/Perth") +
      (catalog.sync.backfillRemaining
        ? ` · ${catalog.sync.backfillRemaining} historical files queued`
        : "");
    if (catalog.sync.errors?.length)
      error(
        "Some files need attention. Previously collected readings are still available.",
      );
    renderSites();
    const requested = new URLSearchParams(location.search).get("site");
    if (catalog.sites.length)
      await selectSite(
        catalog.sites.some((s) => s.nmi === requested)
          ? requested
          : catalog.sites.find((s) => s.registers)?.nmi || catalog.sites[0].nmi,
      );
    else {
      $("siteName").textContent = "No meter files collected yet";
      $("dataNote").textContent =
        "The site register will appear after the first successful email collection.";
    }
  } catch (e) {
    error(e.message);
    $("siteName").textContent = "Meter data unavailable";
  }
}
$("search").oninput = renderSites;
$("from").onchange = render;
$("to").onchange = render;
$("reload").onclick = init;
$("download").onclick = download;
$("allDates").onclick = () => {
  if (site) {
    $("from").value = isoDate(site.first);
    $("to").value = isoDate(site.latest);
    render();
  }
};
$("lastMonth").onclick = () => {
  if (site?.latest) {
    const d = isoDate(site.latest);
    $("from").value = d.slice(0, 7) + "-01";
    $("to").value = d;
    render();
  }
};
await init();
if (document.modelContext?.registerTool) {
  try {
    document.modelContext.registerTool({
      name: "list_meter_sites",
      description:
        "List the meter sites currently available in this private dashboard.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => ({ sites: catalog?.sites || [] }),
    });
    document.modelContext.registerTool({
      name: "select_meter_site",
      description:
        "Select a site in the visible dashboard without changing stored readings.",
      inputSchema: {
        type: "object",
        properties: { nmi: { type: "string" } },
        required: ["nmi"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        if (!input || typeof input.nmi !== "string")
          throw new Error("NMI is required");
        return selectSite(input.nmi);
      },
    });
  } catch {
    /* Browsers without WebMCP retain all visible controls. */
  }
}
