import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SettingsAreaIcon } from './settingsIcons';

/**
 * Settings hub icons (2026-11): every area the hub can list has its own
 * icon — the neutral gear is only a fallback, never what an area shows.
 */
const AREAS_SOURCE = readFileSync(path.join(__dirname, '../../app/(portal)/settings/settingsAreas.ts'), 'utf8');
const AREA_KEYS = [...AREAS_SOURCE.matchAll(/^\s+key: '([^']+)',$/gm)].map((m) => m[1]);
const iconMarkup = (areaKey: string) => render(<SettingsAreaIcon areaKey={areaKey} />).container.innerHTML;

describe('SettingsAreaIcon', () => {
  it('finds the areas', () => {
    expect(AREA_KEYS).toContain('price-catalog');
    expect(AREA_KEYS.length).toBeGreaterThan(10);
  });

  it.each(AREA_KEYS)('%s has its own icon', (key) => {
    expect(iconMarkup(key)).not.toBe(iconMarkup('no-such-area'));
  });
});
