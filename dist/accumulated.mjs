import { isoDate } from "./meter.mjs";
export function renderAccumulated(site, from, to) {
  let box = document.getElementById("accumulatedPanel");
  if (!box) {
    box = document.createElement("article");
    box.id = "accumulatedPanel";
    box.className = "panel";
    document.querySelector(".kpis").after(box);
  }
  box.replaceChildren();
  box.hidden = !site.accumulated?.length;
  if (box.hidden) return;
  const title = document.createElement("h3");
  title.textContent = "Accumulated meter readings";
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent =
    "NEM13 records cover complete read periods. These are not interval readings, so daily demand is unavailable. Periods overlapping your selection are shown in full.";
  box.append(title, note);
  const download = document.createElement("button");
  download.textContent = "Download read periods";
  download.onclick = () => downloadPeriods(site, from, to);
  box.append(download);
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table"),
    head = document.createElement("thead"),
    hr = document.createElement("tr");
  for (const h of [
    "Meter / register",
    "From",
    "To",
    "Consumption",
    "Unit",
    "Quality",
  ]) {
    const th = document.createElement("th");
    th.textContent = h;
    hr.append(th);
  }
  head.append(hr);
  table.append(head);
  const body = document.createElement("tbody");
  for (const r of [...site.accumulated].sort((a, b) =>
    b.end.localeCompare(a.end),
  )) {
    if ((from && isoDate(r.end) < from) || (to && isoDate(r.start) > to))
      continue;
    const tr = document.createElement("tr");
    for (const value of [
      `${r.meter} / ${r.suffix}`,
      isoDate(r.start),
      isoDate(r.end),
      r.consumption.toLocaleString("en-AU"),
      r.unit,
      r.quality || "?",
    ]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  wrap.append(table);
  box.append(wrap);
}
export function downloadPeriods(site, from, to) {
  const rows = [
    [
      "NMI",
      "Meter",
      "Register",
      "From",
      "To",
      "Start read",
      "End read",
      "Consumption",
      "Unit",
      "Quality",
    ],
  ];
  for (const r of site.accumulated || []) {
    if ((from && isoDate(r.end) < from) || (to && isoDate(r.start) > to))
      continue;
    rows.push([
      site.nmi,
      r.meter,
      r.suffix,
      isoDate(r.start),
      isoDate(r.end),
      r.start_read,
      r.end_read,
      r.consumption,
      r.unit,
      r.quality,
    ]);
  }
  const cell = (value) => {
    const text = String(value ?? "");
    return (
      '"' + (/^[=+@]/.test(text) ? "'" : "") + text.replaceAll('"', '""') + '"'
    );
  };
  const url = URL.createObjectURL(
    new Blob([rows.map((r) => r.map(cell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `meter-periods-${site.nmi}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
