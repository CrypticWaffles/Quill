'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggleEnabled');
  const languageSelect = document.getElementById('languageSelect');
  const providerSelect = document.getElementById('providerSelect');
  const providerNote = document.getElementById('providerNote');
  const claudeSection = document.getElementById('claudeSection');
  const claudeApiKey = document.getElementById('claudeApiKey');
  const claudeModel = document.getElementById('claudeModel');
  const clearIgnored = document.getElementById('clearIgnored');

  // Load saved settings
  chrome.storage.sync.get(
    ['enabled', 'language', 'provider', 'claudeApiKey', 'claudeModel', 'ignoredWords'],
    (prefs) => {
      toggleEnabled.checked = prefs.enabled !== false;
      languageSelect.value = prefs.language || 'en-US';
      providerSelect.value = prefs.provider || 'languagetool';
      claudeApiKey.value = prefs.claudeApiKey || '';
      claudeModel.value = prefs.claudeModel || 'claude-haiku-4-5-20251001';
      updateProviderUI(prefs.provider || 'languagetool');
      updateIgnoredCount(prefs.ignoredWords || []);
    }
  );

  toggleEnabled.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: toggleEnabled.checked });
  });

  languageSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ language: languageSelect.value });
  });

  providerSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ provider: providerSelect.value });
    updateProviderUI(providerSelect.value);
  });

  claudeApiKey.addEventListener('change', () => {
    chrome.storage.sync.set({ claudeApiKey: claudeApiKey.value.trim() });
  });

  claudeModel.addEventListener('change', () => {
    chrome.storage.sync.set({ claudeModel: claudeModel.value });
  });

  clearIgnored.addEventListener('click', () => {
    chrome.storage.sync.set({ ignoredWords: [] });
    updateIgnoredCount([]);
  });

  function updateProviderUI(provider) {
    if (provider === 'claude') {
      claudeSection.style.display = 'block';
      providerNote.textContent = 'Uses your Anthropic API key.';
    } else {
      claudeSection.style.display = 'none';
      providerNote.textContent = 'No API key required.';
    }
  }

  function updateIgnoredCount(words) {
    const n = words.length;
    clearIgnored.textContent = n ? `Clear all (${n})` : 'Clear all';
    clearIgnored.disabled = n === 0;
  }

  // Live update ignored word count if changed from another tab
  chrome.storage.onChanged.addListener((changes) => {
    if ('ignoredWords' in changes) {
      updateIgnoredCount(changes.ignoredWords.newValue || []);
    }
  });
});
