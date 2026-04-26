const siteStatus = document.getElementById("site-status");
const notifyCountdown = document.getElementById("notify-countdown");
const settingsBtn = document.getElementById("settings-btn");

let countdownTimer = null;

function startCountdown(tabId, intervalMinutes, lastFireMs) {
  if (countdownTimer) clearInterval(countdownTimer);
  const intervalMs = intervalMinutes * 60 * 1000;

  function render() {
    const remaining = Math.max(0, intervalMs - (Date.now() - lastFireMs));
    const totalSec = Math.ceil(remaining / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    notifyCountdown.textContent = `Next reminder in ${m}:${String(s).padStart(2, "0")}`;
    notifyCountdown.hidden = false;
  }

  render();
  countdownTimer = setInterval(() => {
    const remaining = Math.max(0, intervalMs - (Date.now() - lastFireMs));
    if (remaining === 0) {
      // Timer fired since popup opened; re-fetch updated lastFireMs
      browser.runtime
        .sendMessage({ type: "get-notify-timer", tabId })
        .then((meta) => {
          if (meta) {
            lastFireMs = meta.lastFireMs;
          }
        });
    }
    render();
  }, 1000);
}

function setStatusSpans(hostname, labelClass, labelText) {
  siteStatus.replaceChildren();
  if (hostname) {
    const siteSpan = document.createElement("span");
    siteSpan.className = "status-site";
    siteSpan.textContent = hostname;
    siteStatus.appendChild(siteSpan);
  }
  const labelSpan = document.createElement("span");
  labelSpan.className = `status-label ${labelClass}`;
  labelSpan.textContent = labelText;
  siteStatus.appendChild(labelSpan);
}

async function checkCurrentTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.url) {
    siteStatus.textContent = "No active site";
    return;
  }

  // Skip internal pages (about:, moz-extension://, etc.)
  if (!tab.url.startsWith("http://") && !tab.url.startsWith("https://")) {
    setStatusSpans(null, "not-blocked", "Not on a website");
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
    setStatusSpans(hostname, "not-blocked", "Not blocked");
    return;
  }

  const result = await browser.runtime.sendMessage({
    type: "check-limits",
    url: tab.url,
  });
  const s = result.settings;

  if (s.mode === "block") {
    setStatusSpans(hostname, "blocked", "Completely blocked");
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
    setStatusSpans(hostname, "tracked", parts.join(" · "));
  } else {
    setStatusSpans(hostname, "tracked", "Blocked (no limits set)");
  }

  // Show countdown to next notification if a timer is active for this tab
  browser.runtime
    .sendMessage({ type: "get-notify-timer", tabId: tab.id })
    .then((meta) => {
      if (meta) {
        startCountdown(tab.id, meta.intervalMinutes, meta.lastFireMs);
      } else {
        notifyCountdown.hidden = true;
      }
    });
}

settingsBtn.addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

checkCurrentTab();
