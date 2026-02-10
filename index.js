import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

/* =========================
   ENV
========================= */
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHRIS_TELEGRAM_ID = process.env.CHRIS_TELEGRAM_ID;
const PORT = process.env.PORT || 3000;

/* =========================
   HELPERS
========================= */
const sendMessage = async (chatId, text) => {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
};

const sendDMToChris = async (text) => {
  if (!CHRIS_TELEGRAM_ID) return;
  await sendMessage(Number(CHRIS_TELEGRAM_ID), text);
};

/* =========================
   CONVERSATION STATE
   chatId → { intent, step }
========================= */
const pendingState = new Map();

/* =========================
   INTENT DETECTION
========================= */
const getIntent = (text) => {
  const t = text.toLowerCase();
  if (t.includes("contract") || t.includes("agreement") || t.includes("arc")) {
    return "CONTRACTING";
  }
  return null;
};

/* =========================
   HARD ESCALATION
========================= */
const isHardEscalation = (text) => {
  const t = text.toLowerCase();
  return (
    t.includes("annuity") ||
    t.includes("replacement") ||
    t.includes("rollover") ||
    t.includes("commission") ||
    /\$\s?\d{2,}/.test(t)
  );
};
/* =========================
   GOOGLE DRIVE TEST ROUTE
========================= */
app.get("/test-drive", async (_, res) => {
  try {
    const files = await listSOPFiles();

    res.json({
      status: "success",
      count: files.length,
      files: files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.mimeType
      }))
    });
  } catch (err) {
    console.error("Google Drive test error:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});


/* =========================
   TELEGRAM WEBHOOK
========================= */
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg || !msg.text) return res.sendStatus(200);

    const chatId = msg.chat.id;
    const rawText = msg.text;
    const text = rawText.toLowerCase().trim();
    const user = msg.from;

    const agentName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    const agentUsername = user.username ? `@${user.username}` : "no_username";
    const agentLabel = `${agentName} (${agentUsername})`;

    console.log("Incoming:", agentLabel, rawText);

    /* =========================
       1️⃣ HARD ESCALATION FIRST
    ========================== */
    if (isHardEscalation(text)) {
      await sendMessage(
        chatId,
        "This looks like a high-risk or high-value case. I’m escalating this to Chris for guidance."
      );

      await sendDMToChris(
        `🚨 HIGH-RISK CASE\nAgent: ${agentLabel}\nQuestion:\n"${rawText}"`
      );

      return res.sendStatus(200);
    }

    /* =========================
       2️⃣ ACTIVE STATE HANDLER
    ========================== */
    const state = pendingState.get(chatId);

    // ---- ARC ACCESS STEP ----
    if (state?.step === "ARC_ACCESS") {
      const yes = ["yes", "yep", "yeah", "i do", "have"];
      const no = ["no", "no access", "none", "dont", "don't"];

      if (no.some(v => text.includes(v))) {
        pendingState.delete(chatId);

        await sendMessage(
          chatId,
          "You’ll need ARC access first.\n\n" +
          "1. Go to https://arc.naaleads.com\n" +
          "2. Log in using your NAA credentials\n\n" +
          "If you didn’t receive access or can’t log in, email contracting@naaleads.com."
        );

        await sendDMToChris(
          `🚨 ARC ACCESS ISSUE\nAgent: ${agentLabel}\nAgent reports NO ARC access.`
        );

        return res.sendStatus(200);
      }

      if (yes.some(v => text.includes(v))) {
        pendingState.set(chatId, { intent: "CONTRACTING", step: "STAGE" });

        await sendMessage(
          chatId,
          "Which part are you currently on?\n" +
          "• Haven’t started contracting\n" +
          "• Submitted contracting requests\n" +
          "• Waiting for carrier approval\n" +
          "• Not sure / stuck"
        );

        return res.sendStatus(200);
      }

      await sendMessage(
        chatId,
        "Please reply **yes** or **no** so I can guide you correctly."
      );

      return res.sendStatus(200);
    }

    /* =========================
       3️⃣ NEW QUESTION
    ========================== */
    if (!state) {
      const intent = getIntent(text);

      if (!intent) {
        await sendMessage(
          chatId,
          "This question isn’t in my approved knowledge base yet. I’ll escalate this to Chris for review."
        );

        await sendDMToChris(
          `📚 KB GAP\nAgent: ${agentLabel}\nQuestion:\n"${rawText}"`
        );

        return res.sendStatus(200);
      }

      // Start CONTRACTING flow
      pendingState.set(chatId, { intent: "CONTRACTING", step: "ARC_ACCESS" });

      await sendMessage(
        chatId,
        "Quick check first — do you already have access to the ARC website using your NAA credentials? (yes / no)"
      );

      return res.sendStatus(200);
    }

    /* =========================
       4️⃣ FALLBACK
    ========================== */
    await sendMessage(
      chatId,
      "I’m not sure how to proceed yet. I’m escalating this to Chris for guidance."
    );

    await sendDMToChris(
      `⚠️ UNRESOLVED QUESTION\nAgent: ${agentLabel}\nQuestion:\n"${rawText}"`
    );

    return res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(200);
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
