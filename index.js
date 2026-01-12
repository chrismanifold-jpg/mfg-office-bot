import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHRIS_TELEGRAM_ID = process.env.CHRIS_TELEGRAM_ID;
const PORT = process.env.PORT || 3000;

/* ---------------------------
   SOP STEP 4 — GATING (FIXED)
---------------------------- */
const shouldRespond = (text) => {
  if (!text) return false;
  const t = text.toLowerCase().trim();

  // High-risk keywords → always respond
  const highRisk = [
    "annuity",
    "replacement",
    "rollover",
    "ira",
    "401k",
    "$",
    "commission"
  ];
  if (highRisk.some(p => t.includes(p))) return true;

  // Explicit question mark
  if (t.includes("?")) return true;

  // Strong starters (phrase-aware)
  const starters = [
    "how",
    "how do i",
    "what",
    "what is",
    "what are",
    "when",
    "where",
    "who",
    "can you",
    "should i",
    "help",
    "next step",
    "next steps"
  ];

  if (starters.some(p => t === p || t.startsWith(p + " "))) {
    return true;
  }

  // Explicit help / stuck language
  const contains = [
    "need help",
    "need to",
    "stuck",
    "blocked",
    "does anyone know",
    "i can't",
    "urgent",
    "not sure what to do",
    "what should i do"
  ];

  return contains.some(p => t.includes(p));
};

/* ---------------------------
   Health Check
---------------------------- */
app.get("/", (req, res) => {
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
    const text = message.text;

    console.log("Incoming Telegram message:", text);

    if (!shouldRespond(text)) {
      console.log("Ignored (gating)");
      return res.sendStatus(200);
    }

    /* ---------------------------
       SOP STEP 5 — OPENAI DECISION
    ---------------------------- */
    const systemInstructions = `
You are the internal AI assistant for Manifold Financial Group.

You MUST output in this exact structure every time:

ESCALATE: <YES/NO>
ESCALATE_REASON: <short reason or NONE>
EXPECTED_COMMISSION_USD: <number or UNKNOWN>
USER_REPLY:
<short, action-forcing response>
DM_TO_CHRIS:
<only if ESCALATE=YES, else NONE>
EMAIL_TO_CHRIS:
<only if ESCALATE=YES, else NONE>
`;

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
            { role: "system", content: systemInstructions },
            { role: "user", content: text }
          ],
          temperature: 0
        })
      }
    );

    const data = await openaiResponse.json();
    if (!data.choices?.[0]) {
      console.error("OpenAI response malformed:", data);
      return res.sendStatus(200);
    }

    const output = data.choices[0].message.content;
    console.log("OpenAI raw output:\n", output);

    /* ---------------------------
       PARSE MODEL OUTPUT
    ---------------------------- */
    const get = (label) => {
      const match = output.match(
        new RegExp(`${label}:([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`)
      );
      return match ? match[1].trim() : null;
    };

    const ESCALATE = get("ESCALATE");
    const USER_REPLY = get("USER_REPLY");

    // If model says nothing → stay silent
    if (!USER_REPLY || USER_REPLY === "NONE") {
      console.log("No public reply required");
      return res.sendStatus(200);
    }

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

    console.log("Bot replied successfully");

    /* ---------------------------
       Escalation (Telegram only)
    ---------------------------- */
    if (ESCALATE === "YES" && CHRIS_TELEGRAM_ID) {
      const DM_TO_CHRIS = get("DM_TO_CHRIS");
      if (DM_TO_CHRIS && DM_TO_CHRIS !== "NONE") {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: Number(CHRIS_TELEGRAM_ID),
            text: DM_TO_CHRIS
          })
        });
        console.log("Escalation DM sent");
      }
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
