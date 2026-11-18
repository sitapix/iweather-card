// How deeply the temperature digits bend the sky in Home view.
export const GLASS_OPTIONS = [
  { value: 'subtle', label: 'Subtle' },
  { value: 'standard', label: 'Standard' },
  { value: 'strong', label: 'Strong' },
  { value: 'clear', label: 'Clear' },
] as const;
export const GLASS_STRENGTHS = GLASS_OPTIONS.map(option => option.value);
export const GLASS_DEFAULTS = { glass_refraction: true, glass_strength: 'standard' } as const;
