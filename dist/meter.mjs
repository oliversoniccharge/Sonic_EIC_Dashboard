export const isoDate = (d) =>
  d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "";
export const round = (n) => Math.round(n * 1000) / 1000;
export function analyse(site, from = "", to = "") {
  const days = {},
    monthly = {},
    profile = Array.from({ length: 48 }, () => ({ sum: 0, count: 0 }));
  let missing = 0,
    estimated = 0;
  // First aggregate all same-time registers, then compute coincident site demand.
  const points = {};
  let importSamples = 0,
    exportSamples = 0;
  for (const ch of site.channels || []) {
    if (!["KWH", "KVARH", "KVAH"].includes(ch.unit)) continue;
    const type =
      ch.unit === "KWH" && /^E/.test(ch.suffix)
        ? "import"
        : ch.unit === "KWH" && /^B/.test(ch.suffix)
          ? "export"
          : null;
    if (!type) continue;
    for (const [day, record] of Object.entries(ch.days)) {
      const d = isoDate(day);
      if ((from && d < from) || (to && d > to)) continue;
      if (!days[d])
        days[d] = {
          import: 0,
          export: 0,
          peak: 0,
          missing: 0,
          importSamples: 0,
          exportSamples: 0,
        };
      record.values.forEach((value, i) => {
        if (value === null) {
          missing++;
          days[d].missing++;
          return;
        }
        if (record.quality?.[i] && record.quality[i] !== "A") estimated++;
        days[d][type] += value;
        days[d][type + "Samples"]++;
        if (type === "import") importSamples++;
        else exportSamples++;
        // Expand interval-average kW to minute cells, supporting mixed 5/15/30/60-minute files.
        for (
          let minute = i * ch.interval;
          minute < (i + 1) * ch.interval;
          minute++
        ) {
          if (type === "import") {
            const p = (points[d] ??= {
              power: new Float64Array(1440),
              known: new Uint8Array(1440),
            });
            p.power[minute] += (value * 60) / ch.interval;
            p.known[minute] = 1;
          }
        }
      });
    }
  }
  let peak = null;
  for (const [day, p] of Object.entries(points))
    for (let minute = 0; minute < 1440; minute++) {
      if (!p.known[minute]) continue;
      peak = Math.max(peak ?? 0, p.power[minute]);
      days[day].peak = Math.max(days[day].peak, p.power[minute]);
      const bin = Math.floor(minute / 30);
      profile[bin].sum += p.power[minute];
      profile[bin].count++;
    }
  const dates = Object.keys(days).sort();
  let imported = 0,
    exported = 0;
  for (const d of dates) {
    imported += days[d].import;
    exported += days[d].export;
    if (days[d].importSamples)
      monthly[d.slice(0, 7)] = (monthly[d.slice(0, 7)] || 0) + days[d].import;
    else days[d].import = null;
    if (!days[d].exportSamples) days[d].export = null;
  }
  const hasImport = (site.channels || []).some(
    (c) => c.unit === "KWH" && /^E/.test(c.suffix),
  );
  const hasExport = (site.channels || []).some(
    (c) => c.unit === "KWH" && /^B/.test(c.suffix),
  );
  return {
    days,
    dates,
    monthly,
    profile: profile.map((p) => (p.count ? round(p.sum / p.count) : null)),
    imported: hasImport && importSamples ? round(imported) : null,
    exported: hasExport && exportSamples ? round(exported) : null,
    peak: hasImport ? peak : null,
    missing,
    estimated,
  };
}
