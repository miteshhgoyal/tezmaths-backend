const { admin, db } = require("../config/firebase");

async function sendToAllUsers(title, message, redirect = "") {
  try {
    const snap = await db.ref("fcmTokens").once("value");
    if (!snap.exists()) {
      console.log("No FCM tokens found");
      return { sent: 0, failure: 0 };
    }

    const tokens = Object.values(snap.val()).filter(Boolean);
    if (tokens.length === 0) return { sent: 0, failure: 0 };

    console.log(`Sending to ${tokens.length} devices...`);

    const messages = tokens.map((token) => ({
      token,
      notification: { title, body: message },
      data: { redirect: redirect || "" },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "default",
        },
      },
    }));

    let success = 0;
    let failure = 0;

    // FCM allows max 500 per batch
    for (let i = 0; i < messages.length; i += 500) {
      const batch = messages.slice(i, i + 500);
      const response = await admin.messaging().sendEach(batch);
      success += response.successCount;
      failure += response.failureCount;

      // Clean up invalid tokens so they don't accumulate
      const staleTokens = [];
      response.responses.forEach((r, idx) => {
        if (!r.success) {
          const code = r.error?.code;
          console.log(`Token failed: ${batch[idx].token} — ${code}`);
          // These codes mean the token is permanently invalid
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-argument'
          ) {
            staleTokens.push(batch[idx].token);
          }
        }
      });

      // Remove stale tokens from fcmTokens node
      if (staleTokens.length > 0) {
        try {
          const snap = await db.ref("fcmTokens").once("value");
          if (snap.exists()) {
            const removeOps = [];
            snap.forEach((child) => {
              if (staleTokens.includes(child.val())) {
                removeOps.push(db.ref(`fcmTokens/${child.key}`).remove());
              }
            });
            await Promise.all(removeOps);
            console.log(`Removed ${removeOps.length} stale token(s)`);
          }
        } catch (cleanupErr) {
          console.error("Stale token cleanup failed:", cleanupErr.message);
        }
      }
    }

    console.log(`FCM result: success=${success} failure=${failure}`);
    return { sent: success, failure };
  } catch (error) {
    console.error("sendToAllUsers error:", error.message);
    return { sent: 0, failure: 0 };
  }
}

async function processScheduledNotifications() {
  try {
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
    }
  } catch (error) {
    console.error("processScheduledNotifications error:", error.message);
  }
}

module.exports = { sendToAllUsers, processScheduledNotifications };
