/**
 * How a provider kind reads to a person. The wire values are lowercase ids;
 * showing them raw (`openrouter (openrouter)`) reads as an unfinished screen.
 */
const KIND_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  'openai-compatible': 'OpenAI-compatible endpoint',
  'claude-subscription': 'Claude subscription',
  ollama: 'Ollama',
};

export function providerKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/**
 * One connection's name in a list. The id only earns a mention when it says
 * something the kind does not: a second account of the same provider.
 */
export function providerConnectionLabel(provider: { id: string; name: string }): string {
  const label = providerKindLabel(provider.name);
  return provider.id === provider.name ? label : `${label} · ${provider.id}`;
}
