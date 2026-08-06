const params = new URLSearchParams(window.location.search);
const targetUrl = params.get("url");
const blockedPattern = params.get("pattern");

const heading = document.getElementById("heading");
const visitCount = document.getElementById("visit-count");
const usageInfo = document.getElementById("usage-info");
const intentSection = document.getElementById("intent-section");
const intentPrompt = document.getElementById("intent-prompt");
const intentInput = document.getElementById("intent-input");
const activitySuggestion = document.getElementById("activity-suggestion");
const quoteEl = document.getElementById("quote");
const quoteAuthor = document.getElementById("quote-author");
const yesBtn = document.getElementById("yes-btn");
const noBtn = document.getElementById("no-btn");

function getSiteName(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    // Strip TLD and capitalize (e.g. "youtube.com" -> "Youtube")
    const name = hostname.split(".")[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "this site";
  }
}

// The countdown needs both an intent and the limit check, which resolve independently
let intentSatisfied = false;
let allowedSettings = null;

function maybeStartCountdown() {
  if (intentSatisfied && allowedSettings) {
    startCountdown(allowedSettings.waitSeconds);
  }
}

function showIntentPrompt() {
  intentPrompt.textContent = `What specifically will you do on ${getSiteName(targetUrl)}?`;
  intentSection.style.display = "";
  intentInput.focus();

  intentInput.addEventListener("input", function onInput() {
    if (intentInput.value.trim().length >= 5) {
      intentInput.removeEventListener("input", onInput);
      intentSatisfied = true;
      maybeStartCountdown();
    }
  });
}

async function init() {
  const limits = browser.runtime.sendMessage({
    type: "check-limits",
    url: targetUrl,
  });

  const { rotatingHeadlines, requireIntent, activities, siteSettings } =
    await browser.storage.local.get({
      rotatingHeadlines: true,
      requireIntent: true,
      activities: [],
      siteSettings: {},
    });

  if (rotatingHeadlines) {
    heading.textContent = HEADINGS[Math.floor(Math.random() * HEADINGS.length)];
  }

  // Show a subtle quote
  const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  quoteEl.textContent = `"${quote.text}"`;
  quoteAuthor.textContent = quote.author;
  // Show a random activity suggestion
  if (activities.length > 0) {
    const pick = activities[Math.floor(Math.random() * activities.length)];
    activitySuggestion.textContent = `Instead, you could: ${pick}`;
  }

  if (siteSettings[blockedPattern]?.mode !== "block") {
    if (requireIntent) {
      showIntentPrompt();
    } else {
      intentSatisfied = true;
    }
  }

  const { usage, settings } = await limits;

  // Completely blocked mode
  if (settings.mode === "block") {
    heading.textContent = "This site is blocked";
    yesBtn.style.display = "none";
    intentSection.style.display = "none";
    return;
  }

  // Show visit count
  if (usage.opens > 0) {
    visitCount.textContent = `You've visited this ${usage.opens} time${usage.opens !== 1 ? "s" : ""} today.`;
  }

  const opensExceeded =
    settings.maxOpens > 0 && usage.opens >= settings.maxOpens;
  const minutesExceeded =
    settings.maxMinutes > 0 && usage.minutesUsed >= settings.maxMinutes;

  if (settings.maxOpens > 0 || settings.maxMinutes > 0) {
    const parts = [];
    if (settings.maxOpens > 0) {
      parts.push(`${usage.opens}/${settings.maxOpens} opens`);
    }
    if (settings.maxMinutes > 0) {
      parts.push(`${Math.round(usage.minutesUsed)}/${settings.maxMinutes} min`);
    }
    usageInfo.textContent = `Today: ${parts.join(", ")}`;
  }

  if (opensExceeded || minutesExceeded) {
    heading.textContent = "Daily limit reached";
    yesBtn.style.display = "none";
    intentSection.style.display = "none";
    return;
  }

  allowedSettings = settings;
  maybeStartCountdown();
}

function startCountdown(waitSeconds) {
  let remaining = waitSeconds;
  yesBtn.textContent = `Yes, I want to waste my time (${remaining}s)`;

  const timer = setInterval(() => {
    remaining--;
    yesBtn.textContent = `Yes, I want to waste my time (${remaining}s)`;

    if (remaining <= 0) {
      clearInterval(timer);
      yesBtn.disabled = false;
      yesBtn.textContent = "Yes, I want to waste my time";
    }
  }, 1000);
}

init();

yesBtn.addEventListener("click", () => {
  if (yesBtn.disabled || !targetUrl) return;
  browser.runtime.sendMessage({ type: "approve-navigation", url: targetUrl });
});

noBtn.addEventListener("click", () => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.close();
  }
});
