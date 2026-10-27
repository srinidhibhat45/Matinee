/** Credentials stay on this device. Account sync is independent of API keys. */
export async function bindKeys(_tmdbKey: string, _geminiKey: string): Promise<void> {}
export async function lookupKey(_enteredKey: string): Promise<{
  tmdbKey: null;
  geminiKey: null;
}> {
  return {
    tmdbKey: null,
    geminiKey: null
  };
}
export async function handleKeyAutofill(enteredKey: string, type: 'tmdb' | 'gemini') {
  return {
    tmdbKey: type === 'tmdb' ? enteredKey : null,
    geminiKey: type === 'gemini' ? enteredKey : null,
    autofilled: false
  };
}
