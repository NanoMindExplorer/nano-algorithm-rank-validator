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

let selectedProfileId = "balanced";
let lastCalibration = null;

function fieldHtml(key, label, value, step, code) {
  return `
    <label class="field" data-key="${key}">
      <span>${label}${code ? ` <code>${code}</code>` : ""}</span>
      <input type="number" data-key="${key}" value="${value}" step="${step}" />
    </label>`;
}

function renderProfiles() {
  const grid = document.getElementById("profile-grid");
  const profiles = NARVProfiles.listProfiles();
  grid.innerHTML = profiles
    .map((p) => {
      const active = p.id === selectedProfileId;
      return `
      <button type="button" class="profile-card ${active ? "active" : ""}" data-profile="${p.id}">
        <strong>${p.name}</strong>
        <span>${p.description}</span>
      </button>`;
    })
    .join("");
  grid.querySelectorAll("[data-profile]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedProfileId = btn.getAttribute("data-profile");
      applyProfileToForm(selectedProfileId);
      renderProfiles();
      document.getElementById("profile-hint").textContent =
        `Selected: ${NARVProfiles.getProfile(selectedProfileId).name}`;
    });
  });
  document.getElementById("profile-hint").textContent =
    `Selected: ${NARVProfiles.getProfile(selectedProfileId).name}`;
}

function applyProfileToForm(profileId) {
  const resolved = NARVProfiles.resolve(profileId);
  fillWeightInputs(resolved.weights);
  // merge profile params into param inputs
  document.querySelectorAll("#params-grid input").forEach((input) => {
    const k = input.dataset.key;
    if (resolved.params[k] != null) input.value = resolved.params[k];
  });
}

function fillWeightInputs(weights) {
  document.querySelectorAll("#pos-weights input, #neg-weights input").forEach((input) => {
    const k = input.dataset.key;
    if (weights[k] != null) input.value = weights[k];
  });
}

function renderWeightGrids(weights) {
  const pos = [];
  const neg = [];
  for (const key of NARVWeights.ACTION_KEYS) {
    const meta = NARVWeights.WEIGHT_META[key] || {
      label: key,
      group: "positive",
      code: key,
    };
    const html = fieldHtml(key, meta.label, weights[key] ?? 0, 0.1, meta.code);
    if (meta.group === "negative") neg.push(html);
    else pos.push(html);
  }
  document.getElementById("pos-weights").innerHTML = pos.join("");
  document.getElementById("neg-weights").innerHTML = neg.join("");
}

function render() {
  const defaults = NARVWeights.cloneDefaults();
  chrome.storage.sync.get(
    {
      weights: defaults.weights,
      params: defaults.params,
      profileId: "balanced",
      inNetworkDefault: true,
      historyAffinity: 0.55,
      mutedKeywords: "",
      useSidecar: false,
      sidecarUrl: "http://127.0.0.1:8787",
      affinityCalibration: null,
    },
    (stored) => {
      selectedProfileId = stored.profileId || "balanced";
      const resolved = NARVProfiles.resolve(selectedProfileId, {
        weights: stored.weights,
        params: stored.params,
      });
      const weights = { ...resolved.weights, ...(stored.weights || {}) };
      const params = { ...resolved.params, ...(stored.params || {}) };

      document.getElementById("inNetworkDefault").checked =
        stored.inNetworkDefault !== false;
      const cal = stored.affinityCalibration;
      lastCalibration = cal;
      document.getElementById("historyAffinity").value =
        cal?.historyAffinity != null
          ? cal.historyAffinity
          : stored.historyAffinity != null
            ? stored.historyAffinity
            : 0.55;
      document.getElementById("mutedKeywords").value = stored.mutedKeywords || "";
      document.getElementById("useSidecar").checked = !!stored.useSidecar;
      document.getElementById("sidecarUrl").value =
        stored.sidecarUrl || "http://127.0.0.1:8787";

      if (cal) {
        document.getElementById("calibration-out").textContent = JSON.stringify(
          cal,
          null,
          2
        );
      }

      document.getElementById("params-grid").innerHTML = PARAM_FIELDS.map((f) =>
        fieldHtml(f.key, f.label, params[f.key] ?? defaults.params[f.key], f.step)
      ).join("");

      renderWeightGrids(weights);
      renderProfiles();
    }
  );
}

function collect() {
  const defaults = NARVWeights.cloneDefaults();
  const weights = { ...defaults.weights };
  const params = { ...defaults.params };

  document.querySelectorAll("#pos-weights input, #neg-weights input").forEach((input) => {
    weights[input.dataset.key] = Number(input.value);
  });
  document.querySelectorAll("#params-grid input").forEach((input) => {
    params[input.dataset.key] = Number(input.value);
  });

  return {
    weights,
    params,
    profileId: selectedProfileId,
    inNetworkDefault: document.getElementById("inNetworkDefault").checked,
    historyAffinity: Number(document.getElementById("historyAffinity").value),
    mutedKeywords: document.getElementById("mutedKeywords").value,
    useSidecar: document.getElementById("useSidecar").checked,
    sidecarUrl: document.getElementById("sidecarUrl").value.trim(),
    affinityCalibration: lastCalibration,
  };
}

function parseHistoryInput() {
  return new Promise((resolve, reject) => {
    const file = document.getElementById("historyFile").files?.[0];
    const paste = document.getElementById("historyPaste").value.trim();
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
      return;
    }
    if (paste) {
      try {
        resolve(JSON.parse(paste));
      } catch (e) {
        reject(e);
      }
      return;
    }
    reject(new Error("Provide a JSON file or paste history JSON"));
  });
}

document.getElementById("calibrate").addEventListener("click", async () => {
  const msg = document.getElementById("msg");
  try {
    const raw = await parseHistoryInput();
    const cal = NARVAffinity.calibrate(raw);
    lastCalibration = cal;
    document.getElementById("historyAffinity").value = cal.historyAffinity.toFixed(3);
    document.getElementById("calibration-out").textContent = JSON.stringify(cal, null, 2);
    const suggested = NARVAffinity.suggestProfile(cal);
    msg.textContent = `Calibrated · suggested profile: ${suggested}`;
  } catch (e) {
    msg.textContent = e.message || String(e);
  }
});

document.getElementById("apply-suggested-profile").addEventListener("click", () => {
  if (!lastCalibration) {
    document.getElementById("msg").textContent = "Calibrate first";
    return;
  }
  const suggested = NARVAffinity.suggestProfile(lastCalibration);
  selectedProfileId = suggested;
  applyProfileToForm(suggested);
  renderProfiles();
  document.getElementById("msg").textContent = `Applied profile: ${suggested}`;
});

document.getElementById("ping-sidecar").addEventListener("click", async () => {
  const url = document.getElementById("sidecarUrl").value.trim();
  const el = document.getElementById("sidecar-status");
  el.textContent = "Pinging…";
  const res = await NARVSidecar.health(url);
  if (res.ok) {
    el.textContent = `OK · mode=${res.mode || "?"} · version=${res.version || "?"}`;
    el.style.color = "#00ba7c";
  } else {
    el.textContent = `Offline: ${res.error}`;
    el.style.color = "#f4212e";
  }
});

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
  lastCalibration = null;
  chrome.storage.sync.set(
    {
      ...defaults,
      profileId: "balanced",
      inNetworkDefault: true,
      historyAffinity: 0.55,
      mutedKeywords: "",
      useSidecar: false,
      sidecarUrl: "http://127.0.0.1:8787",
      affinityCalibration: null,
    },
    () => {
      render();
      document.getElementById("msg").textContent = "Reset to defaults";
      document.getElementById("calibration-out").textContent = "No calibration yet.";
    }
  );
});

render();
