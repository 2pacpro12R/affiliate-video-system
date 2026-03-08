require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

async function test() {
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 100,
      messages: [{ role: "user", content: "Say hello" }]
    });
    console.log("✅ SUCCESS:", msg.content[0].text);
  } catch(e) {
    console.log("❌ ERROR:", e.status, e.message);
  }
}

test();
