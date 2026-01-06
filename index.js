import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("MFG Office Bot is running ✅");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
