const https = require("https");
const { db } = require("../config/firebase");

// ─── Send via Expo Push API ───────────────────────────────────────────────────

function sendExpoMessages(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(messages);
    const options = {
      hostname: "exp.host",
      path: "/--/api/v2/push/send",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (_) { resolve(data); }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Collect all push tokens from Firebase ───────────────────────────────────

async function getAllPushTokens() {
  const tokensSnapshot = await db.ref("fcmTokens").once("value");
  if (!tokensSnapshot.exists()) return [];
  const tokensObj = tokensSnapshot.val();
  return Object.values(tokensObj).filter(Boolean);
}

// ─── Send notification to ALL users ──────────────────────────────────────────

async function sendToAllUsers(title, message, redirect = "") {
  const tokens = await getAllPushTokens();
  if (tokens.length === 0) {
    console.log("No push tokens found");
    return { sent: 0 };
  }

  const messages = tokens.map((token) => ({
    to: token,
    sound: "default",
    title,
    body: message,
    data: { redirect },
    priority: "high",
  }));

  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    await sendExpoMessages(batch);
    sent += batch.length;
  }

  console.log(`Notifications sent to ${sent} tokens`);
  return { sent };
}

// ─── Process scheduled notifications (called by cron) ────────────────────────

async function processScheduledNotifications() {
  const now = Date.now();
  const snapshot = await db
    .ref("notifications")
    .orderByChild("status")
    .equalTo("scheduled")
    .once("value");

  if (!snapshot.exists()) return;

  const notifications = snapshot.val();
  const updates = {};

  for (const [notifId, notif] of Object.entries(notifications)) {
    if (notif.scheduledTime <= now) {
      console.log(`Sending scheduled: ${notif.title}`);
      await sendToAllUsers(notif.title, notif.message, notif.redirect || "");
      updates[`notifications/${notifId}/status`] = "sent";
      updates[`notifications/${notifId}/sentTime`] = now;
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log(`Processed ${Object.keys(updates).length / 2} scheduled notifications`);
  }
}

module.exports = { sendToAllUsers, processScheduledNotifications, getAllPushTokens };