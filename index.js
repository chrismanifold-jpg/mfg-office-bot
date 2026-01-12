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
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/* ---------------------------
   Topic detection (rule-based)
---------------------------- */
const detectTopic = (text) => {
  const t = text.toLowerCase();
  if (t.includes("annuity") || t.includes("$")) return "high_value";
  if (t.includes("replacement") || t.includes("1035")) return "replacement";
  return "general";
};

/* ---------------------------
   GATING
---------------------------- */
const shouldRespond = (text) => {
  const t = text.toLowerCase();
  if (["annuity","replacement","rollover","ira","401k","$"].some(p => t.includes(p))) return true;
  if (t.includes("?")) return true;
  if (["help","need","stuck","blocked","urgent","not sure"].some(p => t.includes(p))) return true;
  return false;
};

/* ---------------------------
   Health
---------------------------- */
app.get("/", (_, res) => {
  res.send("MFG Office Bot is running ✅");
});

/* ---------------------------
   Webhook
---------------------------- */
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text;
    const now = Date.now();

    if (!shouldRespond(text)) return res.sendStatus(200);

    /* ---------------------------
       Agent attribution
    ---------------------------- */
    const agentName = message.from.first_name || "Unknown";
    const agentUsername = message.from.username ? `@${message.from.username}` : "(no username)";
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
       Dedup key
    ---------------------------- */
    const topic = detectTopic(text);
    const dedupKey = `${userId}|${topic}`;
    const lastEscalation = escalationCache.get(dedupKey);
    const withinCooldown = lastEscalation && now - lastEscalation < DEDUP_WINDOW_MS;

    /* ---------------------------
       AI SYSTEM PROMPT (ENFORCED)
    ---------------------------- */
    const systemPrompt = `
You are an INTERNAL office AI. You do NOT give product, legal, or tax advice.

You MUST choose a MODE:
- ANSWER: safe, procedural, short
- CLARIFY: missing info (ask 1–2 questions max)
- ESCALATE: risk, compliance, high value, uncertainty

You MUST set CONFIDENCE:
- HIGH if you are certain and safe
- LOW if unsure → escalation required

OUTPUT FORMAT (STRICT):

MODE: ANSWER | CLARIFY | ESCALATE
CONFIDENCE: HIGH | LOW
USER_REPLY:
<short reply OR NONE>
DM_TO_CHRIS:
<only if MODE=ESCALATE or CONFIDENCE=LOW, else NONE>
`;

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text }
        ]
      })
    });

    const aiData = await aiRes.json();
    const output = aiData?.choices?.[0]?.message?.content;
    if (!output) return res.sendStatus(200);

    const get = (label) => {
      const m = output.match(new RegExp(`${label}:([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`));
      return m ? m[1].trim() : null;
    };

    const MODE = get("MODE");
    const CONFIDENCE = get("CONFIDENCE");
    const USER_REPLY = get("USER_REPLY");
    const DM_TO_CHRIS = get("DM_TO_CHRIS");

    /* ---------------------------
       ENFORCEMENT
    ---------------------------- */
    const mustEscalate =
      MODE === "ESCALATE" ||
      CONFIDENCE === "LOW" ||
      !MODE ||
      !CONFIDENCE;

    /* ---------------------------
       Public reply (only if allowed)
    ---------------------------- */
    if (!mustEscalate && USER_REPLY && USER_REPLY !== "NONE") {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: USER_REPLY })
      });
    }

    /* ---------------------------
       Escalation
    ---------------------------- */
    if (mustEscalate) {
      if (!withinCooldown) {
        escalationCache.set(dedupKey, now);
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: Number(CHRIS_TELEGRAM_ID),
            text: `${attributionBlock}\n\n${DM_TO_CHRIS || "Escalation triggered due to low confidence or risk."}`
          })
        });
      }
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(200);
  }
});

/* ---------------------------
   Start
---------------------------- */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
