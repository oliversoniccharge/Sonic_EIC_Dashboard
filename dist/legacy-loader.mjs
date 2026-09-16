// Existing analysis engine expects E1/B1/Q1/K1. Explicitly aggregate matching
// register families for hosted files; preserve original codes in the main view.
const nmi = new URLSearchParams(location.search).get("site");
if (nmi && /^[a-zA-Z0-9]{10}$/.test(nmi)) {
  const notice = document.getElementById("hostedAnalysisNotice");
  try {
    const response = await fetch(`data/sites/${nmi}.json`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Site data unavailable");
    const site = await response.json();
    const intervals = new Set(site.channels.map((c) => c.interval));
    if (intervals.size !== 1)
      throw new Error(
        "Use the site overview for mixed-interval data. The original analyser requires a single interval length.",
      );
    if (
      site.channels.some((c) =>
        Object.values(c.days).some((d) => d.values.some((v) => v === null)),
      )
    )
      throw new Error(
        "Use the site overview for incomplete readings. The original analyser assumes complete days.",
      );
    const channels = {};
    for (const ch of site.channels) {
      const family = ch.suffix[0];
      if (!["E", "B", "Q", "K", "T"].includes(family)) continue;
      const suffix = family + "1";
      const target = (channels[suffix] ??= {
        suffix,
        unit: ch.unit,
        intervalLen: ch.interval,
        data: {},
      });
      for (const [date, day] of Object.entries(ch.days)) {
        const out = (target.data[date] ??= {
          values: new Array(day.values.length).fill(0),
          qualityFlag: "A",
          updateDT: day.updated,
        });
        day.values.forEach((v, i) => (out.values[i] += v));
        if (day.quality.some((q) => q !== "A")) out.qualityFlag = "E";
      }
    }
    if (!channels.E1)
      throw new Error(
        "No import-energy register is available for detailed analysis.",
      );
    App.meterData = {
      format: "NEM12",
      nmi: site.nmi,
      meterSerial: [...new Set(site.channels.map((c) => c.meter))].join(", "),
      channels,
      dateRange: { start: site.first, end: site.latest },
    };
    App.renderDashboard();
    const siteInput = document.getElementById("ciSite");
    if (siteInput) {
      siteInput.value = site.name;
      App.updateClientSummary();
    }
    notice.textContent =
      "Register families aggregated for the original analysis tools. Original codes remain in the site overview.";
  } catch (e) {
    notice.textContent = e.message;
  }
}
