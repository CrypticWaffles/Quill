'use strict';

const LANGUAGETOOL_URL = 'https://api.languagetool.org/v2/check';
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    enabled: true,
    language: 'en-US',
    provider: 'languagetool',
    claudeApiKey: '',
    claudeModel: 'claude-haiku-4-5-20251001',
    ignoredWords: []
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CHECK_TEXT') {
    handleCheck(msg).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // keep channel open for async response
  }
});

async function handleCheck({ text, language, provider, claudeApiKey, claudeModel }) {
  if (provider === 'claude' && claudeApiKey) {
    return checkWithClaude(text, claudeApiKey, claudeModel);
  }
  return checkWithLanguageTool(text, language);
}

async function checkWithLanguageTool(text, language) {
  const res = await fetch(LANGUAGETOOL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ text, language })
  });

  if (!res.ok) throw new Error(`LanguageTool error ${res.status}`);
  const data = await res.json();

  const matches = (data.matches || []).map(m => ({
    offset: m.offset,
    length: m.length,
    message: m.message,
    type: m.rule?.category?.id === 'TYPOS' ? 'spelling' : 'grammar',
    replacements: (m.replacements || []).slice(0, 5).map(r => r.value)
  }));

  return { matches };
}

async function checkWithClaude(text, apiKey, model) {
  const prompt = `You are a grammar and spelling checker. Analyze the following text and return ONLY a valid JSON array with no markdown fences or extra text.

Each item must have exactly these fields:
- "offset": integer, 0-based character index where the error starts
- "length": integer, number of characters in the erroneous span
- "message": string, brief explanation of the problem
- "type": "spelling" or "grammar"
- "replacements": array of up to 3 corrected string values

Return [] if there are no errors.

Text:
"""
${text}
"""`;

  const res = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Claude API error ${res.status}`);
  }

  const data = await res.json();
  const raw = data.content?.[0]?.text?.trim() || '[]';

  let matches;
  try {
    matches = JSON.parse(raw);
  } catch {
    // try extracting a JSON array from the response if Claude added commentary
    const m = raw.match(/\[[\s\S]*\]/);
    matches = m ? JSON.parse(m[0]) : [];
  }

  if (!Array.isArray(matches)) matches = [];

  // Validate each match; drop anything with bad offsets
  const safe = matches.filter(m =>
    typeof m.offset === 'number' &&
    typeof m.length === 'number' &&
    typeof m.message === 'string' &&
    m.offset >= 0 &&
    m.length > 0 &&
    m.offset + m.length <= text.length
  ).map(m => ({
    offset: m.offset,
    length: m.length,
    message: m.message,
    type: m.type === 'spelling' ? 'spelling' : 'grammar',
    replacements: Array.isArray(m.replacements)
      ? m.replacements.slice(0, 5).map(String)
      : []
  }));

  return { matches: safe };
}
