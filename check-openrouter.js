#!/usr/bin/env node

require('dotenv').config();

const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'affiliate-video-system',
    'X-Title': 'Affiliate Video System',
  },
});

const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4-6';
const MODEL_FALLBACKS = process.env.OPENROUTER_MODEL_FALLBACKS || 'anthropic/claude-sonnet-4-5,anthropic/claude-haiku-4-5,openrouter/auto';

function splitCsvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueList(items) {
  return [...new Set(items)];
}

function buildModelCandidates() {
  return uniqueList([MODEL, ...splitCsvList(MODEL_FALLBACKS)]);
}

function formatOpenRouterError(error) {
  const status = Number(error?.status);
  const message = String(error?.message || error || '').trim();
  return status ? `${status} ${message}` : message;
}

function isAuthError(errorMessage) {
  return /missing authentication|unauthorized|invalid api key/i.test(errorMessage);
}

function isRetryableModelError(errorMessage) {
  return /not available in your region|model.*not available|no endpoints found|unavailable/i.test(errorMessage);
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  const modelCandidates = buildModelCandidates();

  console.log(`[info] Model: ${MODEL}`);
  console.log(`[info] Fallbacks: ${modelCandidates.slice(1).join(', ') || '<none>'}`);
  console.log(`[info] API key present: ${apiKey ? 'yes' : 'no'}`);

  if (!apiKey) {
    console.error('[error] OPENROUTER_API_KEY is missing in .env');
    process.exitCode = 1;
    return;
  }

  const failures = [];

  for (const model of modelCandidates) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{role: 'user', content: 'Say hello in one short sentence.'}],
        max_tokens: 100,
      });

      console.log(`[ok] Model used: ${model}`);
      console.log('[ok]', response.choices?.[0]?.message?.content || '<empty>');
      return;
    } catch (error) {
      const errorMessage = formatOpenRouterError(error);
      failures.push(`${model}: ${errorMessage}`);

      if (isAuthError(errorMessage)) {
        console.error('[error]', errorMessage);
        process.exitCode = 1;
        return;
      }

      if (isRetryableModelError(errorMessage) && model !== modelCandidates[modelCandidates.length - 1]) {
        continue;
      }
    }
  }

  console.error('[error] All OpenRouter model attempts failed.');
  console.error('[details]', failures.join(' | '));
  process.exitCode = 1;
}

main();
