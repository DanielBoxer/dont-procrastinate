// Tracks tabs that have been approved through the interstitial
const approvedNavigations = new Set();

// Tracks tabs currently on blocked sites: tabId -> pattern
const activeBlockedTabs = new Map();

// Tracks per-domain active state: pattern -> { refCount, startTime }
const activeDomains = new Map();

// Tracks periodic notification timers for active blocked domains: pattern -> intervalId
const notifyTimers = new Map();

// Tracks notify timer metadata for popup display: pattern -> { intervalMinutes, lastFireMs }
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

async function startNotifyTimer(pattern) {
  // Only start a new timer if one isn't already running for this domain
  if (notifyTimers.has(pattern)) return;

  const { notifyIntervalMinutes } = await browser.storage.local.get({
    notifyIntervalMinutes: 0,
  });
  if (notifyIntervalMinutes <= 0) return;

  const ms = notifyIntervalMinutes * 60 * 1000;
  const meta = {
    intervalMinutes: notifyIntervalMinutes,
    lastFireMs: Date.now(),
  };
  notifyTimerMeta.set(pattern, meta);
  const timerId = setInterval(async () => {
    const domain = activeDomains.get(pattern);
    if (!domain) {
      clearInterval(timerId);
      notifyTimers.delete(pattern);
      notifyTimerMeta.delete(pattern);
      return;
    }
    meta.lastFireMs = Date.now();
    const heading = HEADINGS[Math.floor(Math.random() * HEADINGS.length)];
    const usage = await getDailyUsage();
    const site = getSiteUsage(usage, pattern);
    const elapsed = (Date.now() - domain.startTime) / 60000;
    const totalMin = Math.round(site.minutesUsed + elapsed);
    const display = patternToDisplayName(pattern);
    browser.notifications.create(`blocked-reminder-${pattern}`, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon-sad.png"),
      title: heading,
      message: `${display}: ${totalMin} min today`,
    });
  }, ms);
  notifyTimers.set(pattern, timerId);
}

async function flushTabTime(tabId) {
  const pattern = activeBlockedTabs.get(tabId);
  if (pattern == null) return;
  activeBlockedTabs.delete(tabId);

  const domain = activeDomains.get(pattern);
  if (!domain) return;

  domain.refCount--;
  if (domain.refCount > 0) {
    // Other tabs still open for this domain, don't flush yet
    return;
  }

  // Last tab for this domain closed, flush accumulated time and stop timer
  activeDomains.delete(pattern);

  if (notifyTimers.has(pattern)) {
    clearInterval(notifyTimers.get(pattern));
    notifyTimers.delete(pattern);
    notifyTimerMeta.delete(pattern);
  }

  const elapsed = (Date.now() - domain.startTime) / 60000;
  const usage = await getDailyUsage();
  const site = getSiteUsage(usage, pattern);
  site.minutesUsed = Math.round((site.minutesUsed + elapsed) * 100) / 100;
  usage.sites[pattern] = site;
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
      getMatchingPattern(message.url).then(async (pattern) => {
        if (pattern) {
          // Flush any prior tracking for this tab (e.g. navigating between blocked sites)
          await flushTabTime(tabId);
          recordOpen(pattern);
          activeBlockedTabs.set(tabId, pattern);
          if (activeDomains.has(pattern)) {
            activeDomains.get(pattern).refCount++;
          } else {
            activeDomains.set(pattern, { refCount: 1, startTime: Date.now() });
            startNotifyTimer(pattern);
          }
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
      const site = getSiteUsage(usage, pattern);
      // Include any in-progress (unflushed) time from active domain tracking
      const domain = activeDomains.get(pattern);
      const liveMinutes = domain ? (Date.now() - domain.startTime) / 60000 : 0;
      return {
        usage: { ...site, minutesUsed: site.minutesUsed + liveMinutes },
        settings: { ...DEFAULT_SITE_SETTINGS, ...allSettings[pattern] },
      };
    });
  }

  if (message.type === "get-notify-timer") {
    // Look up the domain-level timer via the tab's pattern
    const pattern = activeBlockedTabs.get(message.tabId);
    const meta = pattern ? notifyTimerMeta.get(pattern) : null;
    return Promise.resolve(meta ? { ...meta } : null);
  }

  if (message.type === "get-live-minutes") {
    return getDailyUsage().then((usage) => {
      const result = {};
      for (const [pattern, site] of Object.entries(usage.sites)) {
        result[pattern] = site.minutesUsed;
      }
      // Add in-progress time for any currently active domains
      for (const [pattern, domain] of activeDomains) {
        result[pattern] =
          (result[pattern] || 0) + (Date.now() - domain.startTime) / 60000;
      }
      return result;
    });
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
