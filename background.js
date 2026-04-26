// Tracks tabs that have been approved through the interstitial
const approvedNavigations = new Set();

// Tracks tabs currently on blocked sites: tabId -> { pattern, startTime }
const activeBlockedTabs = new Map();

// Tracks periodic notification timers for active blocked tabs: tabId -> intervalId
const notifyTimers = new Map();

// Tracks notify timer metadata for popup display: tabId -> { intervalMinutes, lastFireMs }
const notifyTimerMeta = new Map();

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function getDailyUsage() {
  const { dailyUsage } = await browser.storage.local.get({
    dailyUsage: { date: todayKey(), sites: {} },
  });
  if (dailyUsage.date !== todayKey()) {
    return { date: todayKey(), sites: {} };
  }
  return dailyUsage;
}

async function saveDailyUsage(usage) {
  await browser.storage.local.set({ dailyUsage: usage });
}

async function getSiteSettings() {
  const { siteSettings } = await browser.storage.local.get({
    siteSettings: {},
  });
  return siteSettings;
}

const DEFAULT_SITE_SETTINGS = {
  mode: "wait",
  waitSeconds: 5,
  maxOpens: 0,
  maxMinutes: 0,
};

function getSiteUsage(usage, pattern) {
  return usage.sites[pattern] || { opens: 0, minutesUsed: 0 };
}

async function recordOpen(pattern) {
  const usage = await getDailyUsage();
  const site = getSiteUsage(usage, pattern);
  site.opens++;
  usage.sites[pattern] = site;
  await saveDailyUsage(usage);
}

function patternToDisplayName(pattern) {
  return pattern.replace(/^\*:\/\/\*\./, "").replace(/\/\?\*$|\/*\*$/, "");
}

async function startNotifyTimer(tabId, pattern) {
  // Clear any existing timer for this tab before starting a new one
  if (notifyTimers.has(tabId)) {
    clearInterval(notifyTimers.get(tabId));
    notifyTimers.delete(tabId);
  }

  const { notifyIntervalMinutes } = await browser.storage.local.get({
    notifyIntervalMinutes: 0,
  });
  if (notifyIntervalMinutes <= 0) return;

  const ms = notifyIntervalMinutes * 60 * 1000;
  const meta = {
    intervalMinutes: notifyIntervalMinutes,
    lastFireMs: Date.now(),
  };
  notifyTimerMeta.set(tabId, meta);
  const timerId = setInterval(async () => {
    const entry = activeBlockedTabs.get(tabId);
    if (!entry) {
      clearInterval(timerId);
      notifyTimers.delete(tabId);
      notifyTimerMeta.delete(tabId);
      return;
    }
    meta.lastFireMs = Date.now();
    const heading = HEADINGS[Math.floor(Math.random() * HEADINGS.length)];
    const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    const usage = await getDailyUsage();
    const site = getSiteUsage(usage, entry.pattern);
    const elapsed = (Date.now() - entry.startTime) / 60000;
    const totalMin = Math.round(site.minutesUsed + elapsed);
    const display = patternToDisplayName(entry.pattern);
    browser.notifications.create(`blocked-reminder-${tabId}`, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon-sad.png"),
      title: heading,
      message: `"${quote.text}"\n${display}: ${totalMin} min today`,
    });
  }, ms);
  notifyTimers.set(tabId, timerId);
}

async function flushTabTime(tabId) {
  const entry = activeBlockedTabs.get(tabId);
  if (entry == null) return;
  activeBlockedTabs.delete(tabId);

  // Clear any notification timer for this tab
  if (notifyTimers.has(tabId)) {
    clearInterval(notifyTimers.get(tabId));
    notifyTimers.delete(tabId);
    notifyTimerMeta.delete(tabId);
  }

  const elapsed = (Date.now() - entry.startTime) / 60000;
  const usage = await getDailyUsage();
  const site = getSiteUsage(usage, entry.pattern);
  site.minutesUsed = Math.round((site.minutesUsed + elapsed) * 100) / 100;
  usage.sites[entry.pattern] = site;
  await saveDailyUsage(usage);
}

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await browser.storage.local.set({ blockedSites: [] });
  }
});

async function getBlockedPatterns() {
  const { blockedSites } = await browser.storage.local.get({
    blockedSites: [],
  });
  return blockedSites;
}

function urlMatchesPattern(url, pattern) {
  // Convert match pattern to regex, treating *. (subdomain wildcard) as optional
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*\\\./g, "(?:.*\\.)?")
    .replace(/\\\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  return regex.test(url);
}

async function getMatchingPattern(url) {
  const patterns = await getBlockedPatterns();
  // Sort longer patterns first so more specific paths match before broader ones
  const sorted = [...patterns].sort((a, b) => b.length - a.length);
  for (const pattern of sorted) {
    // Expand scheme wildcard for matching
    const expandedPatterns = pattern.startsWith("*://")
      ? [`http://${pattern.slice(4)}`, `https://${pattern.slice(4)}`]
      : [pattern];

    for (const p of expandedPatterns) {
      if (urlMatchesPattern(url, p)) {
        return pattern;
      }
    }
  }
  return null;
}

// Listen for messages from the interstitial and popup pages
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "approve-navigation") {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      approvedNavigations.add(tabId);
      getMatchingPattern(message.url).then((pattern) => {
        if (pattern) {
          recordOpen(pattern);
          activeBlockedTabs.set(tabId, { pattern, startTime: Date.now() });
          startNotifyTimer(tabId, pattern);
        }
      });
      browser.tabs.update(tabId, { url: message.url });
    }
  }

  if (message.type === "check-limits") {
    return getMatchingPattern(message.url).then(async (pattern) => {
      if (!pattern)
        return {
          usage: { opens: 0, minutesUsed: 0 },
          settings: { ...DEFAULT_SITE_SETTINGS },
        };
      const usage = await getDailyUsage();
      const allSettings = await getSiteSettings();
      return {
        usage: getSiteUsage(usage, pattern),
        settings: { ...DEFAULT_SITE_SETTINGS, ...allSettings[pattern] },
      };
    });
  }

  if (message.type === "get-notify-timer") {
    const meta = notifyTimerMeta.get(message.tabId);
    return Promise.resolve(meta ? { ...meta } : null);
  }
});

// Clean up approved state after navigation completes
browser.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) {
    approvedNavigations.delete(details.tabId);
  }
});

// Flush time when navigating away from a blocked site
browser.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId === 0 && activeBlockedTabs.has(details.tabId)) {
    const pattern = await getMatchingPattern(details.url);
    if (!pattern) {
      await flushTabTime(details.tabId);
    }
  }
});

// Flush time when tab is closed
browser.tabs.onRemoved.addListener((tabId) => {
  approvedNavigations.delete(tabId);
  flushTabTime(tabId);
});

// Update the toolbar icon based on whether the active tab is on a blocked site
async function updateIcon(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url) return;
    const pattern = await getMatchingPattern(tab.url);
    const path = pattern ? "icons/icon-sad.svg" : "icons/icon.svg";
    browser.action.setIcon({ tabId, path: { 48: path } });
  } catch {
    // Tab may have been closed
  }
}

browser.tabs.onActivated.addListener(({ tabId }) => updateIcon(tabId));

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    updateIcon(tabId);
  }
});

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Only intercept top-level navigations
    if (details.type !== "main_frame") {
      return {};
    }

    // Let approved navigations through
    if (approvedNavigations.has(details.tabId)) {
      return {};
    }

    // Check synchronously using a blocking promise
    return getMatchingPattern(details.url).then((pattern) => {
      if (!pattern) {
        return {};
      }

      const interceptUrl = browser.runtime.getURL("intercept/intercept.html");
      const target = encodeURIComponent(details.url);
      return { redirectUrl: `${interceptUrl}?url=${target}` };
    });
  },
  { urls: ["<all_urls>"] },
  ["blocking"],
);
