const SERVER_URL = "http://127.0.0.1:5000";

// Create Context Menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tailorResume",
    title: "Tailor Resume for Selection",
    contexts: ["selection"]
  });
});

// Handle Click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "tailorResume" && info.selectionText) {

    // 1. Ask user for filename via a prompt on the page
    let jobTitle = "New_Job";

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return prompt("Enter a filename for this Job (e.g. Google_SDE):", "");
        }
      });

      if (results && results[0] && results[0].result) {
        jobTitle = results[0].result;
      }
    } catch (e) {
      console.log("Could not prompt user, using default name.");
    }

    // 2. Send to Backend
    try {
      const response = await fetch(`${SERVER_URL}/api/queue/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: info.selectionText,
          title: jobTitle
        })
      });

      if (response.ok) {
        chrome.action.setBadgeText({ text: "OK" });
        chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
        setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
      } else {
        throw new Error("Server Error");
      }
    } catch (err) {
      console.error(err);
      chrome.action.setBadgeText({ text: "ERR" });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    }
  }
});