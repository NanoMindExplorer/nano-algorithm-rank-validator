const PARAM_FIELDS = [
  { key: "authorDiversityDecay", label: "Author diversity decay", step: 0.05 },
  { key: "authorDiversityFloor", label: "Author diversity floor", step: 0.05 },
  { key: "oonWeightFactor", label: "OON weight factor", step: 0.05 },
  { key: "topicOonWeightFactor", label: "Topic OON factor", step: 0.05 },
  { key: "minVideoDurationMs", label: "Min video duration (ms)", step: 100 },
  { key: "maxPostAgeHours", label: "Max post age (hours)", step: 1 },
  { key: "negativeScoresOffset", label: "Negative scores offset", step: 0.001 },
  { key: "premiumInNetworkMultiplier", label: "Premium in-network ×", step: 0.1 },
  { key: "premiumOonMultiplier", label: "Premium OON ×", step: 0.1 },
  { key: "proxyTemperature", label: "Proxy temperature", step: 0.05 },
  { key: "proxyBaseEngagement", label: "Proxy base engagement", step: 0.01 },
];

function fieldHtml(key, label, value, step, code) {
  return `
    <label class="field" data-key="${key}">
      <span>${label}${code ? ` <code>${code}</code>` : ""}</span>
      <input type="number" data-key="${key}" value="${value}" step="${step}" />
    </label>`;
}

function render() {
  const defaults = NARVWeights.cloneDefaults();
  chrome.storage.sync.get(
    {
      weights: defaults.weights,
      params: defaults.params,
      inNetworkDefault: true,
      historyAffinity: 0.55,
      mutedKeywords: "",
    },
    (stored) => {
      const weights = { ...defaults.weights, ...(stored.weights || {}) };
      const params = { ...defaults.params, ...(stored.params || {}) };

      document.getElementById("inNetworkDefault").checked =
        stored.inNetworkDefault !== false;
      document.getElementById("historyAffinity").value =
        stored.historyAffinity != null ? stored.historyAffinity : 0.55;
      document.getElementById("mutedKeywords").value = stored.mutedKeywords || "";

      document.getElementById("params-grid").innerHTML = PARAM_FIELDS.map((f) =>
        fieldHtml(f.key, f.label, params[f.key] ?? defaults.params[f.key], f.step)
      ).join("");

      const pos = [];
      const neg = [];
      for (const key of NARVWeights.ACTION_KEYS) {
        const meta = NARVWeights.WEIGHT_META[key] || {
          label: key,
          group: "positive",
          code: key,
        };
        const html = fieldHtml(
          key,
          meta.label,
          weights[key] ?? 0,
          0.1,
          meta.code
        );
        if (meta.group === "negative") neg.push(html);
        else pos.push(html);
      }
      document.getElementById("pos-weights").innerHTML = pos.join("");
      document.getElementById("neg-weights").innerHTML = neg.join("");
    }
  );
}

function collect() {
  const defaults = NARVWeights.cloneDefaults();
  const weights = { ...defaults.weights };
  const params = { ...defaults.params };

  document.querySelectorAll("#pos-weights input, #neg-weights input").forEach((input) => {
    const k = input.dataset.key;
    weights[k] = Number(input.value);
  });
  document.querySelectorAll("#params-grid input").forEach((input) => {
    const k = input.dataset.key;
    params[k] = Number(input.value);
  });

  return {
    weights,
    params,
    inNetworkDefault: document.getElementById("inNetworkDefault").checked,
    historyAffinity: Number(document.getElementById("historyAffinity").value),
    mutedKeywords: document.getElementById("mutedKeywords").value,
  };
}

document.getElementById("save").addEventListener("click", () => {
  const data = collect();
  chrome.storage.sync.set(data, () => {
    const msg = document.getElementById("msg");
    msg.textContent = "Saved ✓";
    setTimeout(() => (msg.textContent = ""), 2000);
  });
});

document.getElementById("reset").addEventListener("click", () => {
  const defaults = NARVWeights.cloneDefaults();
  chrome.storage.sync.set(
    {
      ...defaults,
      inNetworkDefault: true,
      historyAffinity: 0.55,
      mutedKeywords: "",
    },
    () => {
      render();
      document.getElementById("msg").textContent = "Reset to defaults";
    }
  );
});

render();
