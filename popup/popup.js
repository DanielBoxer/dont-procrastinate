const siteStatus = document.getElementById("site-status");
const settingsBtn = document.getElementById("settings-btn");

async function checkCurrentTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.url) {
    siteStatus.textContent = "No active site";
    return;
  }

  // Skip internal pages (about:, moz-extension://, etc.)
  if (!tab.url.startsWith("http://") && !tab.url.startsWith("https://")) {
    siteStatus.innerHTML = `<span class="status-label not-blocked">Not on a website</span>`;
    return;
  }

  let hostname;
  try {
    hostname = new URL(tab.url).hostname.replace(/^www\./, "");
  } catch {
    siteStatus.textContent = "No active site";
    return;
  }

  const { blockedSites } = await browser.storage.local.get({
    blockedSites: [],
  });

  // Check if the URL matches any blocked pattern
  let matched = false;
  for (const pattern of blockedSites) {
    const expanded = pattern.startsWith("*://")
      ? [`http://${pattern.slice(4)}`, `https://${pattern.slice(4)}`]
      : [pattern];
    for (const p of expanded) {
      const escaped = p
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\*/g, ".*");
      if (new RegExp(`^${escaped}$`, "i").test(tab.url)) {
        matched = true;
        break;
      }
    }
    if (matched) break;
  }

  if (!matched) {
    siteStatus.innerHTML = `<span class="status-site">${hostname}</span><span class="status-label not-blocked">Not blocked</span>`;
    return;
  }

  const result = await browser.runtime.sendMessage({
    type: "check-limits",
    url: tab.url,
  });
  const s = result.settings;

  if (s.mode === "block") {
    siteStatus.innerHTML = `<span class="status-site">${hostname}</span><span class="status-label blocked">Completely blocked</span>`;
    return;
  }

  const parts = [];
  if (s.maxOpens > 0) {
    const remaining = Math.max(0, s.maxOpens - result.usage.opens);
    parts.push(`${remaining} open${remaining !== 1 ? "s" : ""} left`);
  }
  if (s.maxMinutes > 0) {
    const remaining = Math.max(
      0,
      s.maxMinutes - Math.round(result.usage.minutesUsed),
    );
    parts.push(`${remaining} min left`);
  }

  if (parts.length > 0) {
    siteStatus.innerHTML = `<span class="status-site">${hostname}</span><span class="status-label tracked">${parts.join(" · ")}</span>`;
  } else {
    siteStatus.innerHTML = `<span class="status-site">${hostname}</span><span class="status-label tracked">Blocked (no limits set)</span>`;
  }
}

settingsBtn.addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

checkCurrentTab();
