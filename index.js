import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;

/* ------------------------------------------------
   SOP STEP 4 — SHOULD RESPOND (WITH RISK OVERRIDE)
------------------------------------------------- */
const shouldRespond = (text) => {
  const t = text.toLowerCase();

  // 🚨 Always respond to high-value or compliance-risk signals
  const highRiskSignals = [
    "annuity",
    "replacement",
    "rollover",
    "ira",
    "401k",
    "$"
  ];

  if (highRiskSignals.some(p => t.includes(p))) {
    console.log("High-risk signal detected");
    return true;
  }

  // Question mark
  if (t.includes("?")) return true;

  // Starts with common question words
  const startsWith = [
    "how",
    "what",
    "when",
    "where",
    "who",
    "can you",
    "should i",
    "help",
    "next step"
  ];

  if (startsWith.some(p => t.startsWith(p))) return true
