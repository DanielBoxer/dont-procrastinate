const siteList = document.getElementById("site-list");
const newSiteInput = document.getElementById("new-site");
const addBtn = document.getElementById("add-btn");
const waitTimeInput = document.getElementById("wait-time");
const rotatingHeadlinesCheck = document.getElementById("rotating-headlines");
const requireIntentCheck = document.getElementById("require-intent");
const activityList = document.getElementById("activity-list");
const newActivityInput = document.getElementById("new-activity");
const addActivityBtn = document.getElementById("add-activity-btn");

const DEFAULT_SETTINGS = {
  mode: "wait",
  waitSeconds: 5,
  maxOpens: 0,
  maxMinutes: 0,
};

function domainToPattern(input) {
  input = input.trim().replace(/^https?:\/\//, "");
  if (!input) return null;
  if (input.includes("*://")) return input;

  const slashIndex = input.indexOf("/");
  if (slashIndex === -1) {
    return `*://*.${input}/*`;
  }

  const domain = input.slice(0, slashIndex);
  const path = input.slice(slashIndex);
  const suffix = path.endsWith("*") ? "" : "*";
  return `*://*.${domain}${path}${suffix}`;
}

function patternToDisplay(pattern) {
  return pattern.replace(/^\*:\/\/\*\./, "").replace(/\/?\*$/, "");
}

function extractDomain(pattern) {
  const display = patternToDisplay(pattern);
  const slashIndex = display.indexOf("/");
  return slashIndex === -1 ? display : display.slice(0, slashIndex);
}

async function getSiteSettings() {
  const { siteSettings } = await browser.storage.local.get({
    siteSettings: {},
  });
  return siteSettings;
}

async function updateSiteSetting(pattern, key, value) {
  const all = await getSiteSettings();
  all[pattern] = { ...DEFAULT_SETTINGS, ...all[pattern], [key]: value };
  await browser.storage.local.set({ siteSettings: all });
}

async function loadSites() {
  const { blockedSites } = await browser.storage.local.get({
    blockedSites: [],
  });
  const allSettings = await getSiteSettings();

  // Group patterns by domain
  const groups = new Map();
  for (const pattern of blockedSites) {
    const domain = extractDomain(pattern);
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push(pattern);
  }

  siteList.innerHTML = "";
  for (const [domain, patterns] of groups) {
    const group = document.createElement("div");
    group.className = "site-group";

    if (
      patterns.length > 1 ||
      extractDomain(patterns[0]) !== patternToDisplay(patterns[0])
    ) {
      const groupHeader = document.createElement("div");
      groupHeader.className = "group-header";
      groupHeader.textContent = domain;
      group.appendChild(groupHeader);
    }

    for (const pattern of patterns) {
      const settings = { ...DEFAULT_SETTINGS, ...allSettings[pattern] };
      group.appendChild(createSiteCard(pattern, settings));
    }

    siteList.appendChild(group);
  }
}

function createSiteCard(pattern, settings) {
  const card = document.createElement("div");
  card.className = "site-card";

  const header = document.createElement("div");
  header.className = "site-header";

  const name = document.createElement("span");
  name.className = "site-name";
  name.textContent = patternToDisplay(pattern);
  name.title = pattern;
  header.appendChild(name);

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    if (removeBtn.classList.contains("armed")) {
      removeSite(pattern);
      return;
    }
    removeBtn.disabled = true;
    let countdown = 3;
    removeBtn.textContent = `Wait (${countdown}s)`;
    const timer = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(timer);
        removeBtn.disabled = false;
        removeBtn.classList.add("armed");
        removeBtn.textContent = "Are you sure?";
        setTimeout(() => {
          removeBtn.classList.remove("armed");
          removeBtn.textContent = "Remove";
        }, 5000);
      } else {
        removeBtn.textContent = `Wait (${countdown}s)`;
      }
    }, 1000);
  });
  header.appendChild(removeBtn);
  card.appendChild(header);

  const controls = document.createElement("div");
  controls.className = "site-controls";

  // Mode selector
  const modeSelect = document.createElement("select");
  modeSelect.className = "mode-select";
  for (const [value, label] of [
    ["wait", "Wait"],
    ["block", "Block"],
  ]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    modeSelect.appendChild(opt);
  }
  modeSelect.value = settings.mode;

  const waitFields = document.createElement("div");
  waitFields.className = "wait-fields";
  waitFields.style.display = settings.mode === "wait" ? "" : "none";

  modeSelect.addEventListener("change", () => {
    updateSiteSetting(pattern, "mode", modeSelect.value);
    waitFields.style.display = modeSelect.value === "wait" ? "" : "none";
  });
  controls.appendChild(modeSelect);

  // Wait seconds (per-site)
  waitFields.appendChild(
    createNumberField("Wait", "s", settings.waitSeconds, 1, 120, (val) => {
      updateSiteSetting(pattern, "waitSeconds", val);
    }),
  );

  waitFields.appendChild(
    createToggleNumber("Opens/day", settings.maxOpens, 0, 9999, (val) => {
      updateSiteSetting(pattern, "maxOpens", val);
    }),
  );

  waitFields.appendChild(
    createToggleNumber("Min/day", settings.maxMinutes, 0, 9999, (val) => {
      updateSiteSetting(pattern, "maxMinutes", val);
    }),
  );

  controls.appendChild(waitFields);
  card.appendChild(controls);

  return card;
}

function createNumberField(label, unit, value, min, max, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "limit-field";

  const span = document.createElement("span");
  span.textContent = label;
  wrapper.appendChild(span);

  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.value = value;
  input.addEventListener("change", () => {
    const val = Math.max(min, Math.min(max, parseInt(input.value, 10) || min));
    input.value = val;
    onChange(val);
  });
  wrapper.appendChild(input);

  if (unit) {
    const unitSpan = document.createElement("span");
    unitSpan.className = "field-unit";
    unitSpan.textContent = unit;
    wrapper.appendChild(unitSpan);
  }

  return wrapper;
}

function createToggleNumber(label, value, min, max, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "toggle-field";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = value > 0;
  wrapper.appendChild(checkbox);

  const span = document.createElement("span");
  span.className = "toggle-label";
  span.textContent = label;
  wrapper.appendChild(span);

  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.value = value > 0 ? value : "";
  input.placeholder = "0";
  input.style.display = value > 0 ? "" : "none";
  input.addEventListener("change", () => {
    const val = Math.max(1, Math.min(max, parseInt(input.value, 10) || 1));
    input.value = val;
    onChange(val);
  });
  wrapper.appendChild(input);

  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      input.style.display = "";
      input.value = input.value || "5";
      onChange(parseInt(input.value, 10) || 5);
      input.focus();
    } else {
      input.style.display = "none";
      onChange(0);
    }
  });

  return wrapper;
}

async function addSite() {
  const pattern = domainToPattern(newSiteInput.value);
  if (!pattern) return;

  const { blockedSites } = await browser.storage.local.get({
    blockedSites: [],
  });
  if (blockedSites.includes(pattern)) {
    newSiteInput.value = "";
    return;
  }

  blockedSites.push(pattern);
  await browser.storage.local.set({ blockedSites });
  newSiteInput.value = "";
  loadSites();
}

async function removeSite(pattern) {
  const { blockedSites } = await browser.storage.local.get({
    blockedSites: [],
  });
  const updated = blockedSites.filter((s) => s !== pattern);
  await browser.storage.local.set({ blockedSites: updated });

  const allSettings = await getSiteSettings();
  delete allSettings[pattern];
  await browser.storage.local.set({ siteSettings: allSettings });

  loadSites();
}

addBtn.addEventListener("click", addSite);
newSiteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addSite();
});

waitTimeInput.addEventListener("change", async () => {
  const value = Math.max(
    1,
    Math.min(60, parseInt(waitTimeInput.value, 10) || 5),
  );
  waitTimeInput.value = value;
  await browser.storage.local.set({ waitSeconds: value });
});

async function loadWaitTime() {
  const { waitSeconds } = await browser.storage.local.get({ waitSeconds: 5 });
  waitTimeInput.value = waitSeconds;
}

async function loadInterceptSettings() {
  const { rotatingHeadlines, requireIntent } = await browser.storage.local.get({
    rotatingHeadlines: true,
    requireIntent: true,
  });
  rotatingHeadlinesCheck.checked = rotatingHeadlines;
  requireIntentCheck.checked = requireIntent;
}

rotatingHeadlinesCheck.addEventListener("change", () => {
  browser.storage.local.set({
    rotatingHeadlines: rotatingHeadlinesCheck.checked,
  });
});

requireIntentCheck.addEventListener("change", () => {
  browser.storage.local.set({ requireIntent: requireIntentCheck.checked });
});

async function loadActivities() {
  const { activities } = await browser.storage.local.get({ activities: [] });
  activityList.innerHTML = "";
  for (const activity of activities) {
    const item = document.createElement("div");
    item.className = "activity-item";

    const text = document.createElement("span");
    text.textContent = activity;
    item.appendChild(text);

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "\u00D7";
    removeBtn.addEventListener("click", async () => {
      const { activities: current } = await browser.storage.local.get({
        activities: [],
      });
      await browser.storage.local.set({
        activities: current.filter((a) => a !== activity),
      });
      loadActivities();
    });
    item.appendChild(removeBtn);

    activityList.appendChild(item);
  }
}

async function addActivity() {
  const value = newActivityInput.value.trim();
  if (!value) return;
  const { activities } = await browser.storage.local.get({ activities: [] });
  if (!activities.includes(value)) {
    activities.push(value);
    await browser.storage.local.set({ activities });
  }
  newActivityInput.value = "";
  loadActivities();
}

addActivityBtn.addEventListener("click", addActivity);
newActivityInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addActivity();
});

loadSites();
loadWaitTime();
loadInterceptSettings();
loadActivities();
