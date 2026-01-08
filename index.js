import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHRIS_TELEGRAM_ID = process.env.CHRIS_TELEGRAM_ID;
const PORT = process.env.PORT || 3000;

/* ------------------------------------------------
   LEVEL 2 DEDUP — Agent + Topic + Time Window
------------------------------------------------- */
const escalationCache = new Map();
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// Simple rule-based topic detection (NO AI yet)
const detectTopic = (text) => {
  const t = text.toLowerCase();

  if (t.includes("annuity") || t.includes("500k") || t.includes("$")) {
    return "high_value_annuity";
  }
  if (t.includes("replacement") || t.includes("1035")) {
    return "replacement_case";
  }
  if (t.includes("first appointment")) {
    return "first_appointment";
  }

  return "general";
};

/* ---------------------------
   SOP STEP 4 — GATING
---------------------------- */
const shouldRespond = (text) => {
  const t = text.toLowerCase();

  const highRisk = ["annuity", "replacement", "rollover", "ira", "401k", "$"];
  if (highRisk.some(p => t.includes(p))) return true;

  if (t.includes("?")) return true;

  const starts = [
    "how", "what", "when", "where", "who",
    "can you", "should i", "help", "next step"
  ];
  if (starts.some(p => t.startsWith(p))) return true;

  const contains = [
    "need", "stuck", "blocked",
    "does anyone know", "i can't",
    "urgent", "not sure what to do"
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
    const userId = message.from.id;
    const text = message.text;
    const now = Date.now();

    console.log("Incoming message:", text);

    if (!shouldRespond(text)) {
      console.log("Ignored (chatter)");
      return res.sendStatus(200);
    }

    /* ---------------------------
       AGENT ATTRIBUTION (SYSTEM DATA)
    ---------------------------- */
    const agentName = message.from.first_name || "Unknown";
    const agentUsername = message.from.username
      ? `@${message.from.username}`
      : "(no username)";
    const groupName = message.chat.title || "Private Chat";
    const timestamp = new Date(message.date * 1000).toLocaleString();

    const attributionBlock = `
Agent: ${agentName} ${agentUsername}
Group: ${groupName}
Time: ${timestamp}
Message:
"${text}"
`;

    /* ---------------------------
       TOPIC + DEDUP KEY
    ---------------------------- */
    const topic = detectTopic(text);
    const dedupKey = `${userId}|${topic}`;

    const lastEscalation = escalationCache.get(dedupKey);
    const withinCooldown =
      lastEscalation && now - lastEscalation < DEDUP_WINDOW_MS;

    /* ---------------------------
       OPENAI DECISION (STRUCTURE ONLY)
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
              content: "Return escalation decision in required format."
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
    const USER_REPLY = get("USER_REPLY");
    const DM_TO_CHRIS = get("DM_TO_CHRIS");

    /* ---------------------------
       PUBLIC REPLY (SILENT IF NONE)
    ---------------------------- */
    if (USER_REPLY && USER_REPLY !== "NONE") {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: USER_REPLY
        })
      });
    } else {
      console.log("No public reply (silent / seen behavior)");
    }

    /* ---------------------------
       ESCALATION (LEVEL 2 DEDUP + ATTRIBUTION)
    ---------------------------- */
    if (ESCALATE === "YES") {
      if (withinCooldown) {
        console.log(
          `Escalation suppressed (agent + topic cooldown): ${dedupKey}`
        );
        return res.sendStatus(200);
      }

      escalationCache.set(dedupKey, now);
      console.log("ESCALATION SENT:", dedupKey);

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: Number(CHRIS_TELEGRAM_ID),
          text: `${attributionBlock}\n\n${DM_TO_CHRIS}`
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
