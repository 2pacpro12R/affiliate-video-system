#!/usr/bin/env node

require('dotenv').config();

const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const {spawn} = require('child_process');
const {pipeline: streamPipeline} = require('stream/promises');

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'affiliate-video-system',
    'X-Title': 'Affiliate Video System',
  },
});

const CONFIG = {
  outputDir: path.resolve(process.cwd(), process.env.OUTPUT_DIR || 'output'),
  openRouterModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4-6',
  openRouterModelFallbacks: process.env.OPENROUTER_MODEL_FALLBACKS || 'anthropic/claude-sonnet-4-5,anthropic/claude-haiku-4-5,openrouter/auto',
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || 'FIba8m5J0VX1qo9cMnRE',
  elevenLabsModelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
  pixabayApiKey: process.env.PIXABAY_API_KEY || '',
  remotionVersion: process.env.REMOTION_VERSION || '4.0.434',
  reactVersion: process.env.REACT_VERSION || '19.2.4',
  fetchTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS || 20000),
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 60000),
  ttsTimeoutMs: Number(process.env.TTS_TIMEOUT_MS || 120000),
  maxPageChars: Number(process.env.MAX_PAGE_CHARS || 12000),
  fps: 30,
  width: 1080,
  height: 1920,
};

function printUsage() {
  console.log([
    'Usage:',
    '  node pipeline.js "<affiliate-url>"',
    '',
    'Examples:',
    '  node pipeline.js "https://www.make.com/en/register?pc=toncode"',
    '  npm run pipeline -- "https://example.com/?ref=abc"',
    '',
    'Required env:',
    '  OPENROUTER_API_KEY',
  ].join('\n'));
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(Math.max(numeric, min), max);
}

function round2(value) {
  return Number(value.toFixed(2));
}

function pickString(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeStringList(value, maxItems, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback.slice(0, maxItems);
  }

  const items = value
    .map((item) => pickString(item))
    .filter(Boolean);

  if (items.length === 0) {
    return fallback.slice(0, maxItems);
  }

  return items.slice(0, maxItems);
}

function normalizeKeywordList(value, maxItems, fallback = []) {
  const items = normalizeStringList(value, maxItems, fallback)
    .map((item) => item.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (items.length === 0) {
    return fallback.slice(0, maxItems);
  }

  return items.slice(0, maxItems);
}

function uniqueList(items) {
  return [...new Set(items)];
}

function splitCsvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildModelCandidates() {
  const primary = pickString(process.env.OPENROUTER_MODEL, CONFIG.openRouterModel);
  const fallbacks = splitCsvList(process.env.OPENROUTER_MODEL_FALLBACKS || CONFIG.openRouterModelFallbacks);
  return uniqueList([primary, ...fallbacks]);
}

function formatOpenRouterError(error) {
  const status = Number(error?.status);
  const message = pickString(error?.message, String(error || 'Unknown OpenRouter error'));
  return status ? `${status} ${message}` : message;
}

function isAuthError(errorMessage) {
  return /missing authentication|unauthorized|invalid api key/i.test(errorMessage);
}

function isRetryableModelError(errorMessage) {
  return /not available in your region|model.*not available|no endpoints found|unavailable/i.test(errorMessage);
}

function slugify(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'project';
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  ).trim();
}

function extractFirstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return decodeHtmlEntities(match[1].trim());
    }
  }

  return '';
}

function extractMetaTag(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return extractFirstMatch(html, [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"]+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"]+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+(?:name|property)=['"]${escaped}['"][^>]+content=['"]([^']+)['"][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=['"]([^']+)['"][^>]+(?:name|property)=['"]${escaped}['"][^>]*>`, 'i'),
  ]);
}

function normalizeHexColor(value) {
  const raw = pickString(value);
  const sixDigit = raw.match(/^#([0-9a-f]{6})$/i);
  if (sixDigit) {
    return `#${sixDigit[1].toUpperCase()}`;
  }

  const threeDigit = raw.match(/^#([0-9a-f]{3})$/i);
  if (threeDigit) {
    return `#${threeDigit[1]
      .split('')
      .map((char) => `${char}${char}`)
      .join('')
      .toUpperCase()}`;
  }

  return '#22C55E';
}

function guessNameFromUrl(affiliateUrl) {
  try {
    const parsed = new URL(affiliateUrl);
    const host = parsed.hostname.replace(/^www\./i, '');
    const base = host.split('.')[0] || 'tool';

    return base
      .split(/[-_]/)
      .filter(Boolean)
      .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
      .join(' ');
  } catch {
    return 'Tool';
  }
}

function guessNameFromTitle(title, affiliateUrl) {
  const rawTitle = pickString(title);
  if (!rawTitle) {
    return guessNameFromUrl(affiliateUrl);
  }

  const candidate = rawTitle
    .split(/[\-|:|]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .sort((a, b) => a.length - b.length)[0];

  return candidate || guessNameFromUrl(affiliateUrl);
}

function extractJsonFromText(text) {
  const raw = pickString(text);
  if (!raw) {
    throw new Error('OpenRouter returned an empty response.');
  }

  const fencedMatches = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]);
  const candidates = [...fencedMatches, raw];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();

    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue trying.
    }

    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
      const slice = trimmed.slice(objectStart, objectEnd + 1);
      try {
        return JSON.parse(slice);
      } catch {
        // Continue trying.
      }
    }

    const arrayStart = trimmed.indexOf('[');
    const arrayEnd = trimmed.lastIndexOf(']');
    if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
      const slice = trimmed.slice(arrayStart, arrayEnd + 1);
      try {
        return JSON.parse(slice);
      } catch {
        // Continue trying.
      }
    }
  }

  throw new Error(`Could not parse JSON from OpenRouter response:\n${raw.slice(0, 500)}`);
}

function extractTextBlocks(message) {
  if (!message || !Array.isArray(message.content)) {
    return '';
  }

  return message.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

async function fetchPageContext(affiliateUrl) {
  const response = await axios.get(affiliateUrl, {
    timeout: CONFIG.fetchTimeoutMs,
    maxRedirects: 5,
    responseType: 'text',
    validateStatus: (status) => status >= 200 && status < 500,
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
    },
  });

  const finalUrl = response.request?.res?.responseUrl || affiliateUrl;
  const html = typeof response.data === 'string' ? response.data : '';
  const contentType = String(response.headers?.['content-type'] || '');
  const textExcerpt = stripHtml(html).slice(0, CONFIG.maxPageChars);

  return {
    status: response.status,
    requestedUrl: affiliateUrl,
    finalUrl,
    contentType,
    title: extractFirstMatch(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]),
    description: extractMetaTag(html, 'description'),
    ogTitle: extractMetaTag(html, 'og:title'),
    ogDescription: extractMetaTag(html, 'og:description'),
    excerpt: textExcerpt,
  };
}

function buildAnalysisPrompt(affiliateUrl) {
  return [
    `Analyse cet outil : ${affiliateUrl}. Deduis son nom, fonctionnalites et benefices a partir de l URL et de tes connaissances. Retourne le JSON.`,
    'Reponds avec un JSON valide uniquement, sans markdown.',
    '',
    'Schema JSON attendu:',
    '{',
    '  "name": "Nom du produit",',
    '  "tagline": "Promesse courte",',
    '  "websiteUrl": "https://...",',
    '  "category": "categorie courte",',
    '  "mainFeatures": ["feature 1", "feature 2", "feature 3"],',
    '  "targetAudience": "public cible",',
    '  "mainBenefit": "benefice principal",',
    '  "competitors": ["competiteur 1", "competiteur 2"],',
    '  "affiliateCommission": "commission si connue, sinon A verifier",',
    '  "color": "#RRGGBB"',
    '}',
  ].join('\n');
}

function buildBriefPrompt(toolData, affiliateUrl) {
  return [
    'Tu es un directeur creatif specialise en videos verticales affiliate Remotion.',
    'Tu dois produire un brief strictement compatible avec une video de 7 scenes et 35 secondes.',
    'Reponds avec un JSON valide uniquement, sans markdown.',
    '',
    'Donnees produit:',
    JSON.stringify(toolData, null, 2),
    '',
    `Lien d affiliation a pousser dans le CTA final: ${affiliateUrl}`,
    '',
    'Contraintes creatives:',
    '- hook ultra court et curieux',
    '- problems: 2 a 3 problemes concrets',
    '- benefits: 3 resultats orientes outcome (pas juste des features)',
    '- cta direct et actionnable',
    '- brandColor au format #RRGGBB',
    '- appInterface doit etre une string JSX unique representant AppInterfaceMockup',
    '- appMockup doit contenir des textes UI credibles pour la demo outil',
    '- appMockup.tabs: 2 a 3 onglets UI',
    '- appMockup.metrics: 2 a 3 micro-resultats chiffrables',
    '- appMockup.resultBullets: 2 a 3 points de resultat concret',
    '',
    'Schema JSON attendu (strict):',
    '{',
    '  "videoTitle": "titre max 60 caracteres",',
    '  "hook": "phrase d ouverture",',
    '  "problems": ["probleme 1", "probleme 2", "probleme 3"],',
    '  "toolName": "nom outil",',
    '  "tagline": "promesse outil",',
    '  "brandColor": "#22C55E",',
    '  "benefits": ["benefice 1", "benefice 2", "benefice 3"],',
    '  "rating": 4.8,',
    '  "userCount": "12,000+",',
    '  "ctaText": "CTA court",',
    '  "affiliateUrl": "https://...",',
    '  "appInterface": "<div>...jsx string...</div>",',
    '  "appMockup": {',
    '    "screenTitle": "titre ecran app",',
    '    "inputLabel": "label champ principal",',
    '    "inputPlaceholder": "texte saisi par le curseur",',
    '    "buttonLabel": "texte bouton principal",',
    '    "resultLabel": "texte bloc resultat",',
    '    "tabs": ["onglet 1", "onglet 2", "onglet 3"],',
    '    "metrics": ["metrique 1", "metrique 2", "metrique 3"],',
    '    "resultBullets": ["resultat 1", "resultat 2", "resultat 3"]',
    '  },',
    '  "voiceScript": "script voix off complet"',
    '}',
  ].join('\n');
}

function buildPixabayKeywordPrompt(toolData, brief) {
  return [
    'You generate concise Pixabay video search keywords for short-form vertical ad videos.',
    'Return valid JSON only.',
    '',
    'Product data:',
    JSON.stringify(toolData, null, 2),
    '',
    'Brief data:',
    JSON.stringify(
      {
        hook: brief.hook,
        problems: brief.problems,
        benefits: brief.benefits,
        toolName: brief.toolName,
      },
      null,
      2
    ),
    '',
    'Constraints:',
    '- Return exactly 3 keywords',
    '- Keywords must be in English',
    '- Each keyword should be 2-6 words',
    '- Keywords should describe visual stock footage scenes',
    '- No brand names, no URLs',
    '',
    'Expected JSON:',
    '{',
    '  "keywords": ["keyword 1", "keyword 2", "keyword 3"]',
    '}',
  ].join('\n');
}

async function requestJsonFromOpenRouter(options) {
  const prompt = [options.system, options.prompt].filter(Boolean).join('\n\n');
  const models = buildModelCandidates();
  const failures = [];

  for (const model of models) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 4000,
      });

      const text = pickString(response.choices?.[0]?.message?.content);
      if (!text) {
        throw new Error('OpenRouter returned no message content.');
      }

      if (model !== models[0]) {
        console.warn(`[warn] OpenRouter switched model to ${model}`);
      }

      return extractJsonFromText(text);
    } catch (error) {
      const errorMessage = formatOpenRouterError(error);
      failures.push(`${model}: ${errorMessage}`);

      if (isAuthError(errorMessage)) {
        throw new Error(errorMessage);
      }

      if (isRetryableModelError(errorMessage) && model !== models[models.length - 1]) {
        continue;
      }
    }
  }

  throw new Error(`OpenRouter model attempts failed. ${failures.join(' | ')}`);
}

function normalizeToolData(raw, affiliateUrl, pageContext) {
  const fallbackName = guessNameFromTitle(pageContext?.title || pageContext?.ogTitle, affiliateUrl);
  const name = pickString(raw?.name, fallbackName);
  const fallbackFeatures = [
    'Gain de temps sur le flux de travail',
    'Automatisation ou execution plus rapide',
    'Prise en main simple pour demarrer vite',
  ];

  let websiteUrl = pickString(raw?.websiteUrl, pickString(pageContext?.finalUrl, affiliateUrl));
  try {
    websiteUrl = new URL(websiteUrl).origin;
  } catch {
    websiteUrl = pickString(pageContext?.finalUrl, affiliateUrl);
  }

  return {
    name,
    slug: slugify(name),
    tagline: pickString(raw?.tagline, pickString(pageContext?.description, 'Levier de croissance pour equipes digitales')),
    websiteUrl,
    category: pickString(raw?.category, 'software'),
    mainFeatures: normalizeStringList(raw?.mainFeatures, 3, fallbackFeatures),
    targetAudience: pickString(raw?.targetAudience, 'Freelances, agences et equipes operationnelles'),
    mainBenefit: pickString(raw?.mainBenefit, 'Faire gagner du temps et clarifier le travail'),
    competitors: normalizeStringList(raw?.competitors, 2, ['Alternative 1', 'Alternative 2']),
    affiliateCommission: pickString(raw?.affiliateCommission, 'A verifier'),
    color: normalizeHexColor(raw?.color),
    affiliateUrl,
  };
}

function buildFallbackScenes(toolData) {
  const featureA = toolData.mainFeatures[0] || 'Automatisation rapide';
  const featureB = toolData.mainFeatures[1] || 'Interface claire';
  const featureC = toolData.mainFeatures[2] || 'Execution fiable';

  return [
    {
      id: 'scene-1',
      name: 'Hook',
      headline: `Pourquoi ${toolData.name} revient partout`,
      body: 'Tu vois cet outil partout parce qu il enleve une grosse friction.',
      visual: `Ouverture rapide avec ${toolData.name} en gros titre et contexte pain point.`,
      animation: 'spring scale-in',
      remotionHint: 'Use spring for a punchy entry on the hook text.',
    },
    {
      id: 'scene-2',
      name: 'Problem',
      headline: 'Le probleme actuel',
      body: 'Le travail est lent, disperse et souvent manuel.',
      visual: 'Ecrans fragmentes, taches en retard, sentiment de surcharge.',
      animation: 'parallax slide',
      remotionHint: 'Layer cards with slight vertical offsets and interpolate opacity.',
    },
    {
      id: 'scene-3',
      name: 'Feature A',
      headline: featureA,
      body: `${toolData.name} simplifie la partie la plus chronophage.`,
      visual: `Focus sur ${featureA} avec cartes, checkmarks et progression.`,
      animation: 'card reveal',
      remotionHint: 'Stagger cards with Sequence and interpolate translateY.',
    },
    {
      id: 'scene-4',
      name: 'Feature B',
      headline: featureB,
      body: `L experience est plus nette pour ${toolData.targetAudience.toLowerCase()}.`,
      visual: `${toolData.name} montre une interface propre et des etapes fluides.`,
      animation: 'mask wipe',
      remotionHint: 'Use a wipe effect with clipPath or scaleX interpolation.',
    },
    {
      id: 'scene-5',
      name: 'Feature C',
      headline: featureC,
      body: toolData.mainBenefit,
      visual: 'Avant / apres avec resultats mesurables et gain de vitesse.',
      animation: 'before-after split',
      remotionHint: 'Animate a split layout with contrasting panels.',
    },
    {
      id: 'scene-6',
      name: 'CTA',
      headline: `Tester ${toolData.name}`,
      body: 'Si le use case te parle, passe par le lien affilie pour voir le produit.',
      visual: `CTA propre, branding ${toolData.name}, URL d affiliation et call to action final.`,
      animation: 'final pulse',
      remotionHint: 'Pulse the CTA badge with spring and a subtle shadow.',
    },
  ];
}

function normalizeScenes(rawScenes, duration, toolData) {
  const sourceScenes = Array.isArray(rawScenes) && rawScenes.length >= 4 ? rawScenes : buildFallbackScenes(toolData);
  const limitedScenes = sourceScenes.slice(0, 7);
  const weights = limitedScenes.map((scene) => {
    const start = Number(scene.startSec);
    const end = Number(scene.endSec);
    const span = end - start;
    return Number.isFinite(span) && span > 0 ? span : 1;
  });
  const totalWeight = weights.reduce((sum, item) => sum + item, 0) || limitedScenes.length;

  let cursor = 0;

  return limitedScenes.map((scene, index) => {
    const rawSpan = (duration * weights[index]) / totalWeight;
    const span = index === limitedScenes.length - 1 ? duration - cursor : round2(rawSpan);
    const startSec = round2(cursor);
    const endSec = index === limitedScenes.length - 1 ? duration : round2(cursor + span);
    cursor = endSec;

    const fallbackHeadline =
      index === limitedScenes.length - 1
        ? `Passe a ${toolData.name}`
        : pickString(scene.name, `Scene ${index + 1}`);
    const fallbackBody = pickString(scene.visual, toolData.mainBenefit);

    return {
      id: pickString(scene.id, `scene-${index + 1}`),
      name: pickString(scene.name, `Scene ${index + 1}`),
      startSec,
      endSec,
      headline: pickString(scene.headline, fallbackHeadline),
      body: pickString(scene.body, fallbackBody),
      visual: pickString(scene.visual, fallbackBody),
      animation: pickString(scene.animation, 'spring'),
      remotionHint: pickString(scene.remotionHint, 'Use spring and interpolate for clean motion.'),
    };
  });
}

function normalizeBrief(raw, toolData, affiliateUrl) {
  const problems = normalizeStringList(raw?.problems, 3, [
    'Tu perds trop de temps sur une tache repetitive.',
    'Le rendu manque de constance d une publication a l autre.',
    'La production est trop lente pour publier regulierement.',
  ]);
  const benefits = normalizeStringList(raw?.benefits, 3, [
    'Production acceleree jusqu a 10x',
    'Resultat plus pro en quelques clics',
    'Moins de frictions, plus de clics',
  ]);
  const hook = pickString(raw?.hook, `Personne ne parle de ${toolData.name}... pourtant il change tout.`);
  const tagline = pickString(raw?.tagline, toolData.tagline);
  const ctaText = pickString(raw?.ctaText, `Teste ${toolData.name} maintenant`);
  const rating = round2(clampNumber(raw?.rating, 3.5, 5, 4.8));
  const userCount = pickString(raw?.userCount, '12,000+');
  const toolName = pickString(raw?.toolName, toolData.name);
  const brandColor = normalizeHexColor(raw?.brandColor || toolData.color);
  const appInterface = pickString(raw?.appInterface);
  const appMockup = {
    screenTitle: pickString(raw?.appMockup?.screenTitle, toolName),
    inputLabel: pickString(raw?.appMockup?.inputLabel, 'Titre de la video'),
    inputPlaceholder: pickString(raw?.appMockup?.inputPlaceholder, 'Mon titre video...'),
    buttonLabel: pickString(raw?.appMockup?.buttonLabel, 'Generate thumbnail'),
    resultLabel: pickString(raw?.appMockup?.resultLabel, 'Preview ready'),
    tabs: normalizeStringList(raw?.appMockup?.tabs, 3, ['Dashboard', 'Templates', 'Export']),
    metrics: normalizeStringList(raw?.appMockup?.metrics, 3, ['CTR +37%', '30 sec', 'A/B ready']),
    resultBullets: normalizeStringList(
      raw?.appMockup?.resultBullets,
      3,
      ['Contraste optimise', 'Texte lisible mobile', 'Pret a publier']
    ),
  };
  const fallbackScript = [hook, ...problems, tagline, ...benefits, ctaText].join(' ');

  return {
    videoTitle: pickString(raw?.videoTitle, `${toolName}: video 35s`),
    hook,
    problems,
    toolName,
    tagline,
    brandColor,
    benefits,
    rating,
    userCount,
    ctaText,
    affiliateUrl,
    appInterface,
    appMockup,
    duration: 35,
    voiceScript: pickString(raw?.voiceScript, fallbackScript),
  };
}

function renderRootFile() {
  return `import {Composition, registerRoot} from 'remotion';
import {AffiliateToolVideo} from './AffiliateToolVideo';

const FPS = 30;
const durationInFrames = 1050;

export const Root = () => {
  return (
    <Composition
      id="VideoOutput"
      component={AffiliateToolVideo}
      durationInFrames={durationInFrames}
      fps={FPS}
      width={1080}
      height={1920}
    />
  );
};

registerRoot(Root);
`;
}

function renderIndexFile() {
  return `import './Root';
`;
}

function renderSceneCardFile() {
  return `import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export const SceneCard = ({scene, tool, brief, sceneIndex, sceneCount}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const entrance = spring({
    frame,
    fps,
    config: {
      damping: 16,
      stiffness: 130,
      mass: 0.8,
    },
  });

  const textOpacity = interpolate(frame, [0, 10, 25], [0, 0.7, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const textShift = interpolate(entrance, [0, 1], [90, 0]);
  const orbX = interpolate(frame, [0, 120], [0, 80], {
    extrapolateRight: 'extend',
  });
  const orbY = Math.sin(frame / 18) * 22;
  const isFinalScene = sceneIndex === sceneCount - 1;
  const accent = tool.color || '#22C55E';
  const sceneLabel = String(sceneIndex + 1).padStart(2, '0');

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#070B16',
        backgroundImage:
          'radial-gradient(circle at top left, rgba(255,255,255,0.06), transparent 38%), linear-gradient(145deg, #0B1020 0%, #05070D 100%)',
        color: '#F4F7FB',
        fontFamily:
          'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: 64,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 20,
          borderRadius: 36,
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 90 + orbY,
          right: 60 - orbX / 4,
          width: 220 + orbX,
          height: 220 + orbX,
          borderRadius: '50%',
          background: accent,
          opacity: 0.16,
          filter: 'blur(60px)',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
          gap: 28,
        }}
      >
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 16px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.12)',
              backgroundColor: 'rgba(255,255,255,0.04)',
              fontSize: 24,
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          >
            <span style={{color: accent}}>#{sceneLabel}</span>
            <span>{tool.name}</span>
          </div>

          <div
            style={{
              padding: '10px 16px',
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.04)',
              color: '#B8C2D2',
              fontSize: 22,
            }}
          >
            {scene.name}
          </div>
        </div>

        <div
          style={{
            transform: \`translateY(\${textShift}px)\`,
            opacity: textOpacity,
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
            maxWidth: 860,
          }}
        >
          <div
            style={{
              fontSize: 88,
              lineHeight: 1,
              fontWeight: 800,
              letterSpacing: -3,
            }}
          >
            {scene.headline}
          </div>

          <div
            style={{
              fontSize: 34,
              lineHeight: 1.35,
              color: '#D6DEEA',
              maxWidth: 820,
            }}
          >
            {scene.body}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.3fr 0.9fr',
            gap: 24,
            alignItems: 'stretch',
          }}
        >
          <div
            style={{
              padding: 32,
              borderRadius: 32,
              backgroundColor: 'rgba(10,16,32,0.78)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 25px 80px rgba(0,0,0,0.3)',
            }}
          >
            <div
              style={{
                fontSize: 20,
                textTransform: 'uppercase',
                letterSpacing: 2,
                color: accent,
                marginBottom: 18,
              }}
            >
              Visual
            </div>
            <div
              style={{
                fontSize: 28,
                lineHeight: 1.45,
                color: '#EFF4FF',
                whiteSpace: 'pre-wrap',
              }}
            >
              {scene.visual}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
          >
            <div
              style={{
                flex: 1,
                padding: 28,
                borderRadius: 28,
                backgroundColor: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  textTransform: 'uppercase',
                  letterSpacing: 2,
                  color: '#8DA2BE',
                  marginBottom: 16,
                }}
              >
                Motion
              </div>
              <div style={{fontSize: 24, lineHeight: 1.35}}>{scene.animation}</div>
            </div>

            <div
              style={{
                flex: 1,
                padding: 28,
                borderRadius: 28,
                backgroundColor: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  textTransform: 'uppercase',
                  letterSpacing: 2,
                  color: '#8DA2BE',
                  marginBottom: 16,
                }}
              >
                Remotion hint
              </div>
              <div style={{fontSize: 22, lineHeight: 1.4, color: '#DCE5F2'}}>
                {scene.remotionHint}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 20,
          }}
        >
          <div
            style={{
              padding: '18px 24px',
              borderRadius: 24,
              backgroundColor: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              fontSize: 24,
              color: '#D4DCE8',
              maxWidth: 620,
            }}
          >
            {isFinalScene ? brief.ctaText : brief.hook}
          </div>

          <div
            style={{
              padding: '18px 24px',
              borderRadius: 24,
              backgroundColor: isFinalScene ? accent : 'rgba(255,255,255,0.06)',
              color: isFinalScene ? '#05101A' : '#F4F7FB',
              fontSize: isFinalScene ? 22 : 20,
              fontWeight: 700,
              maxWidth: 360,
              textAlign: 'right',
              wordBreak: 'break-word',
              boxShadow: isFinalScene ? '0 20px 60px rgba(0,0,0,0.25)' : 'none',
            }}
          >
            {isFinalScene ? brief.affiliateUrl : tool.tagline}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
`;
}

function renderVideoFile() {
  return `import {
  AbsoluteFill,
  Easing,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import brief from './data/brief.json';
import tool from './data/tool.json';

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'};
const SCENE = {
  HOOK: [0, 90],
  PROBLEM: [90, 300],
  SOLUTION: [300, 540],
  DEMO: [540, 840],
  BENEFITS: [840, 960],
  PROOF: [960, 1020],
  CTA: [1020, 1050],
};

const withAlpha = (hex, alpha) => {
  const raw = String(hex || '#22C55E').replace('#', '');
  const full = raw.length === 3
    ? raw.split('').map((char) => char + char).join('')
    : raw.padEnd(6, '0').slice(0, 6);
  const channel = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return \`#\${full.toUpperCase()}\${channel}\`;
};

const parseCount = (value, fallback = 12000) => {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sceneOpacity = (frame, start, end) =>
  interpolate(frame, [start, start + 8, end - 8, end], [0, 1, 1, 0], CLAMP);

const buildParticles = (color) =>
  Array.from({length: 14}).map((_, index) => ({
    x: 120 + ((index * 63) % 820),
    startY: 1580 - ((index * 91) % 380),
    size: 8 + (index % 4) * 3,
    color,
  }));

const getHookWords = (hook) => {
  const words = String(hook || '').split(/\\s+/).filter(Boolean);
  if (words.length > 0) {
    return words;
  }

  return ['Personne', 'ne', 'parle', 'de', 'cet', 'outil'];
};

const getList = (value, fallback, limit) => {
  if (!Array.isArray(value) || value.length === 0) {
    return fallback.slice(0, limit);
  }

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
};

function AppInterfaceMockup({toolData, briefData, localFrame, fps}) {
  const mockupData = briefData.appMockup || {};
  const title = String(mockupData.screenTitle || briefData.toolName || toolData.name || 'Tool');
  const inputLabel = String(mockupData.inputLabel || 'Titre de la video');
  const inputPlaceholder = String(mockupData.inputPlaceholder || 'Mon titre video...');
  const buttonLabel = String(mockupData.buttonLabel || 'Generate thumbnail');
  const resultLabel = String(mockupData.resultLabel || 'Preview ready');
  const tabs = getList(mockupData.tabs, ['Dashboard', 'Templates', 'Export'], 3);
  const metrics = getList(mockupData.metrics, ['CTR +37%', '30 sec', 'A/B ready'], 3);
  const resultBullets = getList(
    mockupData.resultBullets,
    ['Contraste optimise', 'Texte lisible mobile', 'Pret a publier'],
    3
  );
  const typingTarget = Math.max(12, Math.min(inputPlaceholder.length, 42));
  const typing = Math.floor(interpolate(localFrame, [60, 110], [0, typingTarget], CLAMP));
  const buttonScale = spring({
    frame: localFrame - 120,
    fps,
    config: {damping: 10, stiffness: 180},
  });
  const previewOpacity = interpolate(localFrame, [180, 210], [0, 1], CLAMP);
  const pulse = 1 + 0.03 * Math.sin(localFrame * 0.3);
  const brandColor = String(briefData.brandColor || toolData.color || '#22C55E');
  const interfaceHint = String(briefData.appInterface || '').slice(0, 220);
  const activeTab = Math.max(0, Math.floor(interpolate(localFrame, [20, 80], [0, tabs.length - 1], CLAMP)));

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        fontFamily: 'Arial, sans-serif',
        padding: 16,
        background: '#F7F9FC',
        color: '#101828',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          background: brandColor,
          color: '#FFFFFF',
          borderRadius: 14,
          padding: '10px 14px',
          fontWeight: 700,
          fontSize: 20,
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>{title}</span>
        <span
          style={{
            fontSize: 11,
            letterSpacing: 1,
            fontWeight: 700,
            padding: '4px 8px',
            borderRadius: 999,
            background: withAlpha('#FFFFFF', 0.22),
          }}
        >
          LIVE
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 10,
          minHeight: 28,
        }}
      >
        {tabs.map((tab, index) => (
          <div
            key={\`tab-\${tab}-\${index}\`}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              border: '1px solid #D0D5DD',
              background: index === activeTab ? withAlpha(brandColor, 0.18) : '#FFFFFF',
              color: index === activeTab ? brandColor : '#667085',
            }}
          >
            {tab}
          </div>
        ))}
      </div>

      <div
        style={{
          border: '2px solid #E5E7EB',
          borderRadius: 14,
          background: '#FFFFFF',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          flex: 1,
          overflow: 'hidden',
        }}
      >
        <div style={{fontSize: 14, color: '#475467', fontWeight: 600}}>{inputLabel}</div>
        <div
          style={{
            border: \`2px solid \${brandColor}\`,
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 15,
            background: '#FFFFFF',
          }}
        >
          {inputPlaceholder.substring(0, typing)}
        </div>

        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8}}>
          {resultBullets.slice(0, 2).map((item, index) => (
            <div
              key={\`field-\${index}\`}
              style={{
                border: '1px solid #E4E7EC',
                borderRadius: 8,
                padding: '8px 9px',
                fontSize: 11,
                color: '#667085',
                background: '#FCFCFD',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item}
            </div>
          ))}
        </div>

        <div
          style={{
            background: brandColor,
            color: '#FFFFFF',
            borderRadius: 10,
            textAlign: 'center',
            padding: '10px 10px',
            fontWeight: 700,
            transform: \`scale(\${Math.max(buttonScale, 0) * pulse})\`,
            transformOrigin: 'center',
            opacity: interpolate(localFrame, [120, 140], [0, 1], CLAMP),
          }}
        >
          {buttonLabel}
        </div>

        <div
          style={{
            borderRadius: 12,
            minHeight: 122,
            background: '#EEF2F6',
            border: '1px solid #D0D5DD',
            display: 'grid',
            gap: 8,
            alignContent: 'start',
            padding: 10,
            fontWeight: 600,
            color: '#344054',
            opacity: previewOpacity,
          }}
        >
          <div style={{fontSize: 13, color: '#101828'}}>{resultLabel}</div>
          {resultBullets.map((item, index) => (
            <div
              key={\`result-\${index}\`}
              style={{
                fontSize: 11,
                color: '#475467',
                background: '#FFFFFF',
                border: '1px solid #D0D5DD',
                borderRadius: 8,
                padding: '6px 8px',
                opacity: interpolate(localFrame, [190 + index * 10, 210 + index * 10], [0, 1], CLAMP),
              }}
            >
              {item}
            </div>
          ))}
        </div>

        <div style={{display: 'flex', gap: 8}}>
          {metrics.map((metric, index) => (
            <div
              key={\`metric-\${index}\`}
              style={{
                flex: 1,
                borderRadius: 8,
                background: withAlpha(brandColor, 0.12),
                color: brandColor,
                fontSize: 11,
                fontWeight: 700,
                padding: '7px 6px',
                textAlign: 'center',
              }}
            >
              {metric}
            </div>
          ))}
        </div>

        {interfaceHint ? (
          <div
            style={{
              fontSize: 10,
              lineHeight: 1.3,
              color: '#667085',
              background: '#F2F4F7',
              borderRadius: 8,
              padding: '6px 8px',
              maxHeight: 44,
              overflow: 'hidden',
            }}
          >
            {interfaceHint}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const AffiliateToolVideo = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const brandColor = String(brief.brandColor || tool.color || '#22C55E');
  const hookWords = getHookWords(brief.hook);
  const problems = getList(brief.problems, [
    'Tu perds trop de temps sur une tache repetitive.',
    'Le rendu manque de constance d une publication a l autre.',
    'La production est trop lente pour publier regulierement.',
  ], 3);
  const benefits = getList(brief.benefits, [
    '10x plus rapide',
    'Resultat pro en quelques clics',
    'Moins d effort, plus de clics',
  ], 3);
  const particles = buildParticles(brandColor);

  const toolName = String(brief.toolName || tool.name || 'Tool');
  const tagline = String(brief.tagline || tool.tagline || 'Transforme ton workflow');
  const ctaText = String(brief.ctaText || 'Teste cet outil maintenant');
  const affiliateUrl = String(brief.affiliateUrl || tool.affiliateUrl || '');
  const pixabayClips = getList(brief.pixabayClips, [], 6);

  const numericBenefitMatch = benefits.join(' ').match(/(\\d+)\\s*x/i);
  const targetNumber = numericBenefitMatch ? Number(numericBenefitMatch[1]) : 10;
  const counter = Math.max(0, Math.floor(interpolate(frame, [840, 900], [0, targetNumber], CLAMP)));

  const userCountTarget = parseCount(brief.userCount, 12000);
  const usersAnimated = Math.max(0, Math.floor(interpolate(frame, [960, 1018], [0, userCountTarget], CLAMP)));
  const ratingTarget = Number(brief.rating || 4.8);
  const ratingAnimated = interpolate(frame, [960, 1018], [0, ratingTarget], CLAMP);

  const hookShake = Math.sin(frame * 1.5) * interpolate(frame, [0, 8, 82, 90], [0, 1, 1, 0], CLAMP) * 3;
  const flash = interpolate(frame, [300, 303, 306], [0, 1, 0], CLAMP);
  const logoScale = spring({
    frame: frame - 304,
    fps,
    config: {mass: 0.5, damping: 8, stiffness: 140},
  });
  const charCount = Math.max(0, Math.floor(interpolate(frame, [310, 340], [0, toolName.length], CLAMP)));
  const displayName = toolName.substring(0, charCount);

  const phoneRotate = interpolate(frame, [540, 600], [25, 0], CLAMP);
  const demoZoom = interpolate(frame, [600, 840], [1, 1.3], CLAMP);
  const cursorX = interpolate(frame, [600, 650, 700, 750], [150, 200, 180, 220], CLAMP);
  const cursorY = interpolate(frame, [600, 650, 700, 750], [300, 280, 350, 320], CLAMP);

  const annotationScaleA = spring({
    frame: frame - 660,
    fps,
    config: {damping: 10, stiffness: 170},
  });
  const annotationScaleB = spring({
    frame: frame - 710,
    fps,
    config: {damping: 10, stiffness: 170},
  });

  const ctaRise = spring({
    frame: frame - 1020,
    fps,
    config: {damping: 12, stiffness: 180},
  });
  const ctaY = interpolate(ctaRise, [0, 1], [180, 0], CLAMP);
  const pulse = 1 + 0.05 * Math.sin(frame * 0.3);

  const renderStockBackground = (sceneIndex) => {
    if (pixabayClips.length === 0) {
      return null;
    }

    const clipRef = pixabayClips[sceneIndex % pixabayClips.length];
    if (!clipRef) {
      return null;
    }

    return (
      <>
        <OffthreadVideo
          src={staticFile(clipRef)}
          muted
          delayRenderTimeoutInMilliseconds={180000}
          delayRenderRetries={2}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
        <AbsoluteFill
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.58) 100%)',
          }}
        />
      </>
    );
  };

  return (
    <AbsoluteFill style={{backgroundColor: '#000000', color: '#FFFFFF', fontFamily: 'Arial, sans-serif'}}>
      <AbsoluteFill
        style={{
          opacity: sceneOpacity(frame, SCENE.HOOK[0], SCENE.HOOK[1]),
          backgroundColor: '#000000',
          justifyContent: 'center',
          alignItems: 'center',
          transform: \`translateX(\${hookShake}px)\`,
          padding: '0 80px',
        }}
      >
        {renderStockBackground(0)}
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center'}}>
          {hookWords.map((word, index) => {
            const reveal = spring({
              frame: frame - index * 6,
              fps,
              config: {damping: 8, stiffness: 220, mass: 0.45},
            });
            const scale = interpolate(reveal, [0, 0.7, 1], [0, 1.2, 1], CLAMP);
            const opacity = interpolate(reveal, [0, 0.18, 1], [0, 1, 1], CLAMP);
            const isLast = index === hookWords.length - 1;
            return (
              <span
                key={\`hook-word-\${index}\`}
                style={{
                  fontSize: 94,
                  fontWeight: 800,
                  letterSpacing: -2,
                  transform: \`scale(\${scale})\`,
                  opacity,
                  color: isLast ? brandColor : '#FFFFFF',
                  textShadow: isLast ? \`0 0 20px \${brandColor}\` : 'none',
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          opacity: sceneOpacity(frame, SCENE.PROBLEM[0], SCENE.PROBLEM[1]),
          background:
            \`linear-gradient(180deg, #070707 0%, #161010 55%, \${withAlpha(brandColor, 0.35)} 100%)\`,
          padding: '140px 90px',
        }}
      >
        {renderStockBackground(1)}
        <div style={{fontSize: 42, fontWeight: 800, marginBottom: 40}}>Le vrai probleme</div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 24}}>
          {problems.map((problem, index) => {
            const startFrame = 100 + index * 28;
            const slideIn = interpolate(frame, [startFrame, startFrame + 15], [-100, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.out(Easing.back(1.5)),
            });
            const opacity = interpolate(frame, [startFrame, startFrame + 12], [0, 1], CLAMP);
            const pulseIcon = 1 + 0.2 * Math.sin((frame - startFrame) * 0.35);

            return (
              <div
                key={\`problem-\${index}\`}
                style={{
                  transform: \`translateX(\${slideIn}px)\`,
                  opacity,
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 20,
                  padding: '22px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    background: '#FF7A59',
                    transform: \`scale(\${pulseIcon})\`,
                    flexShrink: 0,
                  }}
                />
                <div style={{fontSize: 36, lineHeight: 1.25}}>{problem}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          opacity: sceneOpacity(frame, SCENE.SOLUTION[0], SCENE.SOLUTION[1]),
          background:
            \`linear-gradient(180deg, #0A0F1A 0%, \${withAlpha(brandColor, 0.68)} 100%)\`,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 60,
        }}
      >
        {renderStockBackground(2)}
        <AbsoluteFill style={{backgroundColor: '#FFFFFF', opacity: flash}} />
        {particles.map((particle, index) => (
          <div
            key={\`particle-\${index}\`}
            style={{
              position: 'absolute',
              left: particle.x,
              top: interpolate(frame, [300, 540], [particle.startY, particle.startY - 200], CLAMP),
              opacity: interpolate(frame, [300, 540], [1, 0], CLAMP),
              width: particle.size,
              height: particle.size,
              borderRadius: '50%',
              background: particle.color,
            }}
          />
        ))}
        <div
          style={{
            width: 220,
            height: 220,
            borderRadius: 110,
            background: '#FFFFFF',
            border: \`8px solid \${withAlpha(brandColor, 0.78)}\`,
            transform: \`scale(\${Math.max(logoScale, 0)})\`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#111827',
            fontWeight: 800,
            fontSize: 74,
            marginBottom: 34,
            boxShadow: \`0 30px 80px \${withAlpha(brandColor, 0.45)}\`,
          }}
        >
          {toolName.charAt(0).toUpperCase()}
        </div>
        <div style={{fontSize: 92, fontWeight: 800, letterSpacing: -2, marginBottom: 18}}>
          {displayName}
        </div>
        <div
          style={{
            opacity: interpolate(frame, [330, 400], [0, 1], CLAMP),
            fontSize: 40,
            color: '#E5E7EB',
            textAlign: 'center',
            maxWidth: 900,
            lineHeight: 1.3,
          }}
        >
          {tagline}
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          opacity: sceneOpacity(frame, SCENE.DEMO[0], SCENE.DEMO[1]),
          background:
            \`linear-gradient(160deg, #05070D 0%, #0B1220 55%, \${withAlpha(brandColor, 0.28)} 100%)\`,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {renderStockBackground(3)}
        <div
          style={{
            perspective: 800,
            transform: \`rotateY(\${phoneRotate}deg) scale(\${demoZoom})\`,
            transition: 'all 0.3s',
          }}
        >
          <div
            style={{
              width: 300,
              height: 550,
              borderRadius: 40,
              border: '8px solid #333333',
              background: '#FFFFFF',
              overflow: 'hidden',
              boxShadow: \`0 30px 80px rgba(0,0,0,0.5), 0 0 40px \${withAlpha(brandColor, 0.27)}\`,
            }}
          >
            <AppInterfaceMockup toolData={tool} briefData={brief} localFrame={frame - 540} fps={fps} />
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            left: cursorX + 320,
            top: cursorY + 490,
            width: 28,
            height: 28,
            borderRadius: 14,
            background: '#FFFFFF',
            border: '3px solid #0F172A',
            boxShadow: '0 8px 18px rgba(0,0,0,0.35)',
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: 180,
            top: 680,
            opacity: interpolate(frame, [660, 680], [0, 1], CLAMP),
            transform: \`scale(\${Math.max(annotationScaleA, 0)})\`,
            background: '#FFFFFF',
            color: '#111827',
            borderRadius: 14,
            padding: '10px 14px',
            fontWeight: 700,
            fontSize: 24,
          }}
        >
          One click generation
        </div>

        <div
          style={{
            position: 'absolute',
            left: 650,
            top: 980,
            opacity: interpolate(frame, [710, 730], [0, 1], CLAMP),
            transform: \`scale(\${Math.max(annotationScaleB, 0)})\`,
            background: '#FFFFFF',
            color: '#111827',
            borderRadius: 14,
            padding: '10px 14px',
            fontWeight: 700,
            fontSize: 24,
          }}
        >
          Preview in seconds
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          opacity: sceneOpacity(frame, SCENE.BENEFITS[0], SCENE.BENEFITS[1]),
          background:
            \`linear-gradient(180deg, #06210E 0%, \${withAlpha(brandColor, 0.45)} 100%)\`,
          padding: '120px 70px',
        }}
      >
        {renderStockBackground(4)}
        <div style={{fontSize: 150, fontWeight: 900, lineHeight: 1, marginBottom: 20}}>
          {counter}x
        </div>
        <div style={{fontSize: 34, color: '#D1FAE5', marginBottom: 30}}>faster output</div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
          {benefits.map((benefit, index) => {
            const cardScale = spring({
              frame: frame - 840 - index * 10,
              fps,
              config: {damping: 12, stiffness: 200},
            });
            const bounce = 1 + 0.04 * Math.sin((frame + index * 6) * 0.28);

            return (
              <div
                key={\`benefit-\${index}\`}
                style={{
                  transform: \`scale(\${Math.max(cardScale, 0) * bounce})\`,
                  transformOrigin: 'left center',
                  background: 'rgba(255,255,255,0.14)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  borderRadius: 18,
                  padding: '18px 20px',
                  fontSize: 34,
                  fontWeight: 700,
                }}
              >
                {benefit}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          opacity: sceneOpacity(frame, SCENE.PROOF[0], SCENE.PROOF[1]),
          background:
            \`linear-gradient(180deg, #0A0A0A 0%, \${withAlpha(brandColor, 0.30)} 100%)\`,
          justifyContent: 'center',
          alignItems: 'center',
          gap: 24,
        }}
      >
        {renderStockBackground(5)}
        <div style={{display: 'flex', gap: 10}}>
          {Array.from({length: 5}).map((_, index) => {
            const starOpacity = interpolate(frame, [960 + index * 7, 970 + index * 7], [0, 1], CLAMP);
            return (
              <span
                key={\`star-\${index}\`}
                style={{
                  opacity: starOpacity,
                  fontSize: 66,
                  color: '#F59E0B',
                  transform: \`scale(\${0.85 + starOpacity * 0.15})\`,
                }}
              >
                *
              </span>
            );
          })}
        </div>

        <div style={{fontSize: 72, fontWeight: 800}}>{ratingAnimated.toFixed(1)} / 5</div>
        <div style={{fontSize: 42, color: '#E5E7EB'}}>
          {new Intl.NumberFormat('en-US').format(usersAnimated)}+ users
        </div>
        <div
          style={{
            marginTop: 10,
            padding: '12px 24px',
            borderRadius: 999,
            background: withAlpha(brandColor, 0.85),
            color: '#0B1324',
            fontSize: 26,
            fontWeight: 800,
            transform: \`scale(\${1 + 0.06 * Math.sin(frame * 0.35)})\`,
          }}
        >
          TRENDING
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          opacity: sceneOpacity(frame, SCENE.CTA[0], SCENE.CTA[1]),
          background: brandColor,
          justifyContent: 'center',
          alignItems: 'center',
          padding: '0 60px',
          transform: \`translateY(\${ctaY}px)\`,
        }}
      >
        {renderStockBackground(6)}
        <div style={{fontSize: 74, fontWeight: 900, textAlign: 'center', color: '#071019', lineHeight: 1.1}}>
          {ctaText}
        </div>
        <div
          style={{
            marginTop: 26,
            fontSize: 44,
            fontWeight: 800,
            color: '#071019',
            transform: \`translateY(\${Math.sin(frame * 0.45) * 8}px)\`,
          }}
        >
          Link in bio
        </div>
        <div
          style={{
            marginTop: 28,
            padding: '20px 30px',
            borderRadius: 18,
            background: '#FFFFFF',
            color: '#071019',
            fontSize: 32,
            fontWeight: 800,
            transform: \`scale(\${pulse})\`,
            boxShadow: \`0 0 \${20 + 10 * Math.sin(frame * 0.3)}px \${withAlpha(brandColor, 0.95)}\`,
          }}
        >
          Open now
        </div>
        <div
          style={{
            marginTop: 20,
            fontSize: 18,
            color: '#0F172A',
            maxWidth: 860,
            textAlign: 'center',
            opacity: 0.85,
            wordBreak: 'break-all',
          }}
        >
          {affiliateUrl}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
`;
}

function renderGeneratedProjectReadme(toolData) {
  return `# ${toolData.name}

Projet Remotion genere automatiquement par pipeline.js.

## Lancer le studio

\`\`\`bash
npm install
npx remotion studio src/index.jsx
\`\`\`

## Rendre la video

\`\`\`bash
npm run render
\`\`\`
`;
}

function buildGeneratedPackageJson(slug) {
  return {
    name: `affiliate-video-${slug}`,
    private: true,
    version: '1.0.0',
    scripts: {
      studio: 'remotion studio src/index.jsx',
      render: 'remotion render src/Root.jsx VideoOutput out/video.mp4',
    },
    dependencies: {
      react: CONFIG.reactVersion,
      'react-dom': CONFIG.reactVersion,
      remotion: CONFIG.remotionVersion,
    },
  };
}

async function writeGeneratedProject(projectDir, toolData, brief) {
  await fs.ensureDir(projectDir);
  await fs.ensureDir(path.join(projectDir, 'src'));
  await fs.ensureDir(path.join(projectDir, 'src', 'data'));
  await fs.ensureDir(path.join(projectDir, 'public', 'assets'));

  await fs.writeJson(path.join(projectDir, 'package.json'), buildGeneratedPackageJson(toolData.slug), { spaces: 2 });
  await fs.writeJson(path.join(projectDir, 'tool.json'), toolData, { spaces: 2 });
  await fs.writeJson(path.join(projectDir, 'brief.json'), brief, { spaces: 2 });
  await fs.writeJson(path.join(projectDir, 'src', 'data', 'tool.json'), toolData, { spaces: 2 });
  await fs.writeJson(path.join(projectDir, 'src', 'data', 'brief.json'), brief, { spaces: 2 });
  await fs.writeFile(path.join(projectDir, '.gitignore'), 'node_modules/\n*.mp4\n');
  await fs.writeFile(path.join(projectDir, 'voiceover.txt'), `${brief.voiceScript}\n`);
  await fs.writeFile(path.join(projectDir, 'README.md'), renderGeneratedProjectReadme(toolData));
  await fs.writeFile(path.join(projectDir, 'src', 'index.jsx'), renderIndexFile());
  await fs.writeFile(path.join(projectDir, 'src', 'Root.jsx'), renderRootFile());
  await fs.writeFile(path.join(projectDir, 'src', 'AffiliateToolVideo.jsx'), renderVideoFile());
}

function quoteShellArg(arg) {
  const value = String(arg);

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildShellCommand(command, args) {
  return [command, ...args].map((item) => quoteShellArg(item)).join(' ');
}

async function runCommandStreaming(command, args, cwd, envOverrides = {}) {
  await new Promise((resolve, reject) => {
    const useShell = process.platform === 'win32';
    const mergedEnv = {
      ...process.env,
      ...envOverrides,
    };
    const child = useShell
      ? spawn(buildShellCommand(command, args), {
          cwd,
          env: mergedEnv,
          stdio: 'inherit',
          shell: true,
        })
      : spawn(command, args, {
          cwd,
          env: mergedEnv,
          stdio: 'inherit',
        });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

async function runRenderPhase(projectDir) {
  const outputVideoPath = path.join(projectDir, 'out', 'video.mp4');
  await fs.ensureDir(path.dirname(outputVideoPath));
  const nodeOptions = [pickString(process.env.NODE_OPTIONS), '--max-old-space-size=4096']
    .filter(Boolean)
    .join(' ');

  console.log('[7/10] Installing dependencies in generated project...');
  await runCommandStreaming('npm', ['install'], projectDir);

  console.log('[8/10] Rendering MP4 with Remotion...');
  await runCommandStreaming(
    'npx',
    ['remotion', 'render', 'src/Root.jsx', 'VideoOutput', 'out/video.mp4'],
    projectDir,
    { NODE_OPTIONS: nodeOptions }
  );

  const exists = await fs.pathExists(outputVideoPath);
  if (!exists) {
    throw new Error(`Render completed but output file is missing: ${outputVideoPath}`);
  }

  const stat = await fs.stat(outputVideoPath);
  console.log(`[ok] MP4 generated: ${outputVideoPath} (${Math.round((stat.size / (1024 * 1024)) * 10) / 10} MB)`);

  return outputVideoPath;
}

async function runVoiceoverPhase(projectDir) {
  const scriptPath = path.join(projectDir, 'voiceover.txt');
  const voiceoverPath = path.join(projectDir, 'voiceover.mp3');

  const scriptExists = await fs.pathExists(scriptPath);
  if (!scriptExists) {
    throw new Error(`voiceover.txt is missing: ${scriptPath}`);
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is missing.');
  }

  const script = pickString(await fs.readFile(scriptPath, 'utf8'));
  if (!script) {
    throw new Error('voiceover.txt is empty.');
  }

  console.log('[9/10] Generating voice-over with ElevenLabs...');

  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${CONFIG.elevenLabsVoiceId}`,
      {
        text: script,
        model_id: CONFIG.elevenLabsModelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      },
      {
        timeout: CONFIG.ttsTimeoutMs,
        responseType: 'arraybuffer',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
      }
    );

    const audioBuffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
    if (audioBuffer.length === 0) {
      throw new Error('ElevenLabs returned an empty audio payload.');
    }

    await fs.writeFile(voiceoverPath, audioBuffer);
  } catch (error) {
    const status = Number(error?.response?.status);
    const apiMessage = pickString(
      error?.response?.data?.detail?.message || error?.response?.data?.detail,
      ''
    );
    const baseMessage = pickString(error?.message, 'Unknown ElevenLabs error');
    const statusPrefix = status ? `${status} ` : '';
    const suffix = apiMessage ? ` - ${apiMessage}` : '';
    throw new Error(`${statusPrefix}${baseMessage}${suffix}`);
  }

  const stat = await fs.stat(voiceoverPath);
  if (!stat.size) {
    throw new Error(`voiceover.mp3 was created but is empty: ${voiceoverPath}`);
  }

  console.log(`[ok] Voice-over generated: ${voiceoverPath} (${Math.round((stat.size / 1024) * 10) / 10} KB)`);
  return voiceoverPath;
}

async function runFinalMergePhase(projectDir) {
  const finalVideoPath = path.join(projectDir, 'out', 'final.mp4');
  await fs.ensureDir(path.dirname(finalVideoPath));

  console.log('[10/10] Merging rendered video with voice-over...');
  await runCommandStreaming(
    'ffmpeg',
    [
      '-y',
      '-i',
      'out/video.mp4',
      '-i',
      'voiceover.mp3',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-shortest',
      'out/final.mp4',
    ],
    projectDir
  );

  const exists = await fs.pathExists(finalVideoPath);
  if (!exists) {
    throw new Error(`Merge completed but final.mp4 is missing: ${finalVideoPath}`);
  }

  console.log('✅ final.mp4 généré avec voix off');
  return finalVideoPath;
}

async function analyzeTool(affiliateUrl) {
  const prompt = buildAnalysisPrompt(affiliateUrl);

  return requestJsonFromOpenRouter({
    system: 'You are a precise product analyst. Return valid JSON only.',
    prompt,
    maxTokens: 1800,
  });
}

async function generateBrief(toolData, affiliateUrl) {
  return requestJsonFromOpenRouter({
    system: 'You write concise, strong short-form video briefs. Return valid JSON only.',
    prompt: buildBriefPrompt(toolData, affiliateUrl),
    maxTokens: 2600,
  });
}

function buildFallbackPixabayKeywords(toolData, brief) {
  const category = pickString(toolData.category, 'software');
  const audience = pickString(toolData.targetAudience, 'content creator').toLowerCase();
  const benefit = pickString(toolData.mainBenefit, '').toLowerCase();
  const problem = Array.isArray(brief?.problems) ? pickString(brief.problems[0], '') : '';

  return normalizeKeywordList(
    [
      `${audience} working on laptop`,
      `${category} app interface animation`,
      problem ? `${problem} office` : '',
      benefit ? `${benefit} success team` : 'social media growth graph',
    ],
    3,
    ['content creator editing video', 'app dashboard closeup', 'team celebrating success']
  );
}

async function generatePixabayKeywords(toolData, brief) {
  try {
    const result = await requestJsonFromOpenRouter({
      system: 'You output production-ready stock-footage search keywords. Return valid JSON only.',
      prompt: buildPixabayKeywordPrompt(toolData, brief),
      maxTokens: 500,
    });

    return normalizeKeywordList(
      result?.keywords,
      3,
      buildFallbackPixabayKeywords(toolData, brief)
    );
  } catch (error) {
    console.warn(`[warn] OpenRouter unavailable for Pixabay keywords, using local fallback: ${error.message}`);
    return buildFallbackPixabayKeywords(toolData, brief);
  }
}

function scorePixabayVariant(video) {
  const width = Number(video?.width || 0);
  const height = Number(video?.height || 0);
  const size = Number(video?.size || 0);
  if (!width || !height) {
    return -Infinity;
  }

  const targetRatio = CONFIG.width / CONFIG.height; // 9:16
  const ratio = width / height;
  const ratioPenalty = Math.abs(ratio - targetRatio) * 1000;
  const area = Math.min(width * height, 1280 * 720);
  const sizeMb = size > 0 ? size / (1024 * 1024) : 0;
  const sizePenalty = sizeMb * 12000;
  const oversizePenalty = sizeMb > 35 ? 3_000_000 : 0;

  return area - ratioPenalty - sizePenalty - oversizePenalty;
}

function pickBestPixabayVideo(hit) {
  const variants = Object.values(hit?.videos || {}).filter((video) => video && video.url);
  if (variants.length === 0) {
    return null;
  }

  const sorted = variants.sort((a, b) => scorePixabayVariant(b) - scorePixabayVariant(a));
  return sorted[0];
}

async function downloadPixabayClipForKeyword(keyword, destinationPath) {
  const response = await axios.get('https://pixabay.com/api/videos/', {
    timeout: CONFIG.fetchTimeoutMs,
    params: {
      key: CONFIG.pixabayApiKey,
      q: keyword,
      per_page: 8,
      safesearch: true,
      order: 'popular',
    },
  });

  const hits = Array.isArray(response?.data?.hits) ? response.data.hits : [];
  if (hits.length === 0) {
    return null;
  }

  const candidates = hits
    .map((hit) => pickBestPixabayVideo(hit))
    .filter(Boolean)
    .sort((a, b) => scorePixabayVariant(b) - scorePixabayVariant(a));

  if (candidates.length === 0) {
    return null;
  }

  const selected = candidates[0];
  const streamResponse = await axios.get(selected.url, {
    timeout: CONFIG.fetchTimeoutMs * 3,
    responseType: 'stream',
  });

  await streamPipeline(streamResponse.data, fs.createWriteStream(destinationPath));
  return selected.url;
}

async function runPixabayPhase(projectDir, toolData, brief) {
  if (!CONFIG.pixabayApiKey) {
    console.log('[5/10] Pixabay API key missing, skipping stock clip download.');
    console.log('[6/10] No Pixabay clips downloaded (step skipped).');
    return [];
  }

  console.log('[5/10] Generating Pixabay search keywords...');
  const keywords = await generatePixabayKeywords(toolData, brief);
  console.log(`[ok] Pixabay keywords: ${keywords.join(' | ')}`);

  console.log('[6/10] Downloading Pixabay clips...');
  const assetsDir = path.join(projectDir, 'public', 'assets');
  await fs.ensureDir(assetsDir);

  const clipRefs = [];
  for (let index = 0; index < keywords.length; index += 1) {
    const keyword = keywords[index];
    const fileName = `pixabay-${index + 1}.mp4`;
    const destinationPath = path.join(assetsDir, fileName);

    try {
      const sourceUrl = await downloadPixabayClipForKeyword(keyword, destinationPath);
      if (!sourceUrl) {
        console.warn(`[warn] No Pixabay video found for keyword: ${keyword}`);
        continue;
      }

      const exists = await fs.pathExists(destinationPath);
      if (!exists) {
        continue;
      }

      clipRefs.push(`assets/${fileName}`);
      console.log(`[ok] Downloaded ${fileName} for "${keyword}"`);
    } catch (error) {
      console.warn(`[warn] Pixabay download failed for "${keyword}": ${error.message}`);
    }
  }

  if (clipRefs.length === 0) {
    console.warn('[warn] No Pixabay clips downloaded, rendering will use gradient backgrounds only.');
    return [];
  }

  const updatedBrief = {
    ...brief,
    pixabayKeywords: keywords,
    pixabayClips: clipRefs,
  };

  await fs.writeJson(path.join(projectDir, 'brief.json'), updatedBrief, {spaces: 2});
  await fs.writeJson(path.join(projectDir, 'src', 'data', 'brief.json'), updatedBrief, {spaces: 2});

  return clipRefs;
}

async function run(affiliateUrl) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('[warn] OPENROUTER_API_KEY is missing. The pipeline will use local fallbacks.');
  }

  const parsedUrl = new URL(affiliateUrl);

  console.log('[1/10] Fetching landing page context...');
  let pageContext = {};
  try {
    pageContext = await fetchPageContext(parsedUrl.toString());
  } catch (error) {
    console.warn(`[warn] Could not fetch landing page context: ${error.message}`);
    pageContext = {
      requestedUrl: parsedUrl.toString(),
      finalUrl: parsedUrl.toString(),
      title: '',
      description: '',
      ogTitle: '',
      ogDescription: '',
      excerpt: '',
    };
  }

  console.log('[2/10] Analysing the tool with Claude via OpenRouter...');
  let analyzedTool = {};
  try {
    analyzedTool = await analyzeTool(parsedUrl.toString());
  } catch (error) {
    console.warn(`[warn] OpenRouter unavailable for tool analysis, using local fallback: ${error.message}`);
    analyzedTool = {};
  }
  const toolData = normalizeToolData(analyzedTool, parsedUrl.toString(), pageContext);

  console.log(`[ok] Tool identified: ${toolData.name}`);
  console.log('[3/10] Generating the video brief...');
  let rawBrief = {};
  try {
    rawBrief = await generateBrief(toolData, parsedUrl.toString());
  } catch (error) {
    console.warn(`[warn] OpenRouter unavailable for brief generation, using local fallback: ${error.message}`);
    rawBrief = {};
  }
  const brief = normalizeBrief(rawBrief, toolData, parsedUrl.toString());

  console.log(`[ok] Brief generated: ${brief.videoTitle}`);
  console.log('[4/10] Writing the Remotion project...');
  const projectDir = path.join(CONFIG.outputDir, toolData.slug);
  await writeGeneratedProject(projectDir, toolData, brief);
  const pixabayClips = await runPixabayPhase(projectDir, toolData, brief);
  if (pixabayClips.length > 0) {
    console.log(`[ok] Pixabay clips ready: ${pixabayClips.length}`);
  }
  const videoPath = await runRenderPhase(projectDir);
  const voiceoverPath = await runVoiceoverPhase(projectDir);
  const finalVideoPath = await runFinalMergePhase(projectDir);

  console.log('');
  console.log('[done] Phase 05 pipeline run completed.');
  console.log(`[path] ${projectDir}`);
  console.log(`[video] ${videoPath}`);
  console.log(`[voiceover] ${voiceoverPath}`);
  console.log(`[final] ${finalVideoPath}`);
  console.log('[next] cd output/<tool-slug>');
  console.log('[next] npx remotion studio src/index.jsx');

  return {
    projectDir,
    videoPath,
    voiceoverPath,
    finalVideoPath,
    pixabayClips,
    toolData,
    brief,
  };
}

async function main() {
  const input = process.argv[2];

  if (!input || input === '--help' || input === '-h') {
    printUsage();
    process.exitCode = input ? 0 : 1;
    return;
  }

  try {
    await fs.ensureDir(CONFIG.outputDir);
    await run(input);
  } catch (error) {
    console.error(`[error] ${error.message}`);
    process.exitCode = 1;
  }
}

main();
