import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;

/* -------------------------
   SOP Step 4 — Should Respond
-------------------------- */
const shouldRespond = (text) => {
  const t = text.toLowerCase();

  if (t.includes("?")) return true;

  const startsWith = [
    "how", "what", "when", "where", "who",
    "can you", "should i", "help", "next step"
  ];

  if (startsWith.some(p => t.startsWith(p))) return true;

  const contains = [
    "need", "stuck", "blocked",
    "does anyone know", "i can't", "urgent"
  ];

  return contains.some(p => t.includes(p));
};

/* -------------------------
   Health Check
-------------------------- */
app.get("/", (req, res) => {
  res.send("MFG Office Bot is running ✅");
});

/* -------------------------
   Telegram Webhook
-------------------------- */
app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userText = message.text;

  console.log("Incoming:", userText);

  if (!shouldRespond(userText)) {
    console.log("Ignored (chatter)");
    return res.sendStatus(200);
  }

  /* -------------------------
     Call OpenAI
  -------------------------- */
  const systemPrompt = `
MFG INTERNAL AI ASSISTANT — SYSTEM INSTRUCTIONS (v1.2)

ROLE & IDENTITY
You are the internal AI assistant for Manifold Financial Group.

PRIMARY OBJECTIVE
Drive immediate progress. Be short, direct, and action-forcing.

COMPLIANCE
Never give product, legal, tax, or licensing advice.
Escalate immediately if risk or $2,500+ commission exists.

OUTPUT FORMAT (REQUIRED)
ESCALATE: <YES/NO>
ESCALATE_REASON: <short or NONE>
EXPECTED_COMMISSION_USD: <number or UNKNOWN>
USER_REPLY:
<short action-forcing reply>
DM_TO_CHRIS:
<only if ESCALATE=YES, else NONE>
EMAIL_TO_CHRIS:
<only if ESCALATE=YES, else NONE>
`;

  const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ],
      temperature: 0.2
    })
  });

  const data = await openaiResponse.json();
  const output = data.choices[0].message.content;

  console.log("OpenAI output:", output);

  /* -------------------------
     Parse Decision Header
  -------------------------- */
  const extract = (label) => {
    const match = output.match(new RegExp(`${label}:([\\s\\S]*?)(\\n[A-Z_]+:|$)`));
    return match ? match[1].trim() : "";
  };

  const escalate = extract("ESCALATE");
  const userReply = extract("USER_REPLY");
  const dmToChris = extract("DM_TO_CHRIS");
  const emailToChris = extract("EMAIL_TO_CHRIS");

  /* -------------------------
     Post ONLY USER_REPLY
  -------------------------- */
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: userReply || "I need a bit more info. What’s the exact situation?"
    })
  });

  /* -------------------------
     Escalation (log only for now)
  -------------------------- */
  if (escalate === "YES") {
    console.log("🚨 ESCALATION TRIGGERED");
    console.log("DM TO CHRIS:", dmToChris);
    console.log("EMAIL TO CHRIS:", emailToChris);
  }

  res.sendStatus(200);
});

/* -------------------------
   Start Server
-------------------------- */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
