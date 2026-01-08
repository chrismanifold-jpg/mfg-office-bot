import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHRIS_TELEGRAM_ID = process.env.CHRIS_TELEGRAM_ID;
const PORT = process.env.PORT || 3000;

/* ---------------------------
   DEDUPLICATION STATE
---------------------------- */
const escalationCache = new Map();
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

const normalizeText = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/* ---------------------------
   SOP STEP 4 — GATING
---------------------------- */
const shouldRespond = (text) => {
  const t = text.toLowerCase();

  const highRisk = ["annuity", "replacement", "rollover", "ira", "401k", "$"];
  if (highRisk.some(p => t.includes(p))) return true;

  if (t.includes("?")) return true;

  const starts = [
    "how","what","when","where","who",
    "can you","should i","help","next step"
  ];
  if (starts.some(p => t.startsWith(p))) return true;

  const contains = [
    "need","stuck","blocked",
    "does anyone know","i can't",
    "urgent","not sure what to do"
  ];
  return contains.some(p => t.includes(p));
};

/* ---------------------------
   Health Check
---------------------------- */
app.get("/", (_, res) => {
  res.send("MFG Office Bot is running ✅");
});

/* ---------------------------
   Telegram Webhook
---------------------------- */
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = message.chat.id;
    const userId = message.from.id; // agent Telegram ID
    const text = message.text;

    console.log("Incoming message:", text);

    if (!shouldRespond(text)) {
      console.log("Ignored (chatter)");
      return res.sendStatus(200);
    }

    const normalized = normalizeText(text);
    const dedupKey = `${userId}|${normalized}`;
    const now = Date.now();

    /* ---------------------------
       OPENAI DECISION
    ---------------------------- */
    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [
            {
              role: "system",
              content: `You MUST output in the required escalation format.`
            },
            { role: "user", content: text }
          ],
          temperature: 0
        })
      }
    );

    const data = await openaiResponse.json();
    const output = data?.choices?.[0]?.message?.content;
    if (!output) return res.sendStatus(200);

    const get = (label) => {
      const match = output.match(
        new RegExp(`${label}:([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`)
      );
      return match ? match[1].trim() : "NONE";
    };

    const ESCALATE = get("ESCALATE");
    const USER_REPLY = get("USER_REPLY") || "Acknowledged. Stand by.";
    const DM_TO_CHRIS = get("DM_TO_CHRIS");

    /* ---------------------------
       Public reply
    ---------------------------- */
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: USER_REPLY
      })
    });

    /* ---------------------------
       Escalation (DEDUPED)
    ---------------------------- */
    if (ESCALATE === "YES") {
      const lastEscalation = escalationCache.get(dedupKey);

      if (lastEscalation && now - lastEscalation < DEDUP_WINDOW_MS) {
        console.log("Escalation suppressed (duplicate)");
        return res.sendStatus(200);
      }

      escalationCache.set(dedupKey, now);

      console.log("ESCALATION SENT");

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: Number(CHRIS_TELEGRAM_ID),
          text: DM_TO_CHRIS
        })
      });
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(200);
  }
});

/* ---------------------------
   Start Server
---------------------------- */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
