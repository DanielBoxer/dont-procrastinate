const params = new URLSearchParams(window.location.search);
const targetUrl = params.get("url");

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

const HEADINGS = [
  "Is this important?",
  "Is this really what you want to do right now?",
  "What were you working on before this?",
  "Will this matter in an hour?",
  "Is this the best use of your time?",
  "Are you choosing this, or is it a reflex?",
];

const QUOTES = [
  { text: "You may delay, but time will not.", author: "Benjamin Franklin" },
  {
    text: "The secret of getting ahead is getting started.",
    author: "Mark Twain",
  },
  {
    text: "A year from now you may wish you had started today.",
    author: "Karen Lamb",
  },
  {
    text: "Amateurs sit and wait for inspiration, the rest of us just get up and go to work.",
    author: "Stephen King",
  },
  {
    text: "It is not enough to be busy. The question is: what are we busy about?",
    author: "Henry David Thoreau",
  },
  {
    text: "The way to get started is to quit talking and begin doing.",
    author: "Walt Disney",
  },
  { text: "Lost time is never found again.", author: "Benjamin Franklin" },
  {
    text: "Only put off until tomorrow what you are willing to die having left undone.",
    author: "Pablo Picasso",
  },
  {
    text: "Do the hard jobs first. The easy jobs will take care of themselves.",
    author: "Dale Carnegie",
  },
  {
    text: "Nothing is so fatiguing as the eternal hanging on of an uncompleted task.",
    author: "William James",
  },
  {
    text: "In a moment of decision, the best thing you can do is the right thing. The worst thing you can do is nothing.",
    author: "Theodore Roosevelt",
  },
  {
    text: "Until we can manage time, we can manage nothing else.",
    author: "Peter Drucker",
  },
];

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

async function init() {
  const { rotatingHeadlines, requireIntent, activities } =
    await browser.storage.local.get({
      rotatingHeadlines: true,
      requireIntent: true,
      activities: [],
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

  const { usage, settings } = await browser.runtime.sendMessage({
    type: "check-limits",
    url: targetUrl,
  });

  // Completely blocked mode
  if (settings.mode === "block") {
    heading.textContent = "This site is blocked";
    yesBtn.style.display = "none";
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
    return;
  }

  if (requireIntent) {
    intentPrompt.textContent = `What specifically will you do on ${getSiteName(targetUrl)}?`;
    intentSection.style.display = "";
    intentInput.focus();

    intentInput.addEventListener("input", function onInput() {
      if (intentInput.value.trim().length >= 5) {
        intentInput.removeEventListener("input", onInput);
        startCountdown(settings.waitSeconds);
      }
    });
  } else {
    startCountdown(settings.waitSeconds);
  }
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
