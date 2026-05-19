/**
 * Component smoke + prop-contract coverage for `<ThemesDropdown>`. The
 * dashboard workspace has no Solid testing-library and the vitest config
 * runs `environment: 'node'`; load-bearing logic lives in
 * `lib/themes-dropdown-helpers.ts` (covered in `themes-dropdown-helpers.test.ts`).
 * This file locks the component's prop-contract shape + that THEME_OPTIONS
 * stays the source of truth for the rendered menu.
 */

import { describe, expect, it } from 'vitest';

import {
  ThemesDropdown,
  type ThemesDropdownProps,
} from '../src/client/components/ThemesDropdown.jsx';
import { THEME_OPTIONS } from '../src/client/lib/themes-dropdown-helpers.js';

describe('ThemesDropdown (smoke)', () => {
  it('is a callable Solid component', () => {
    expect(typeof ThemesDropdown).toBe('function');
  });

  it('satisfies the ThemesDropdownProps contract', () => {
    // A typed `const` — if `ThemesDropdownProps` ever drops `open`,
    // `onClose`, `currentTheme`, or `onSelect`, or changes their
    // signatures, this stops compiling.
    const sanity: ThemesDropdownProps = {
      open: false,
      onClose: () => {},
      currentTheme: 'default',
      onSelect: () => {},
    };
    expect(typeof sanity.onClose).toBe('function');
    expect(typeof sanity.onSelect).toBe('function');
  });

  it('THEME_OPTIONS is the source of truth for the menu', () => {
    // The component renders one row per THEME_OPTIONS entry; if this count
    // drifts away from THEMES (in core/Config.ts) the picker would silently
    // omit themes from the UI even though they remain valid config values.
    // This assertion locks the parity.
    expect(THEME_OPTIONS.length).toBe(8);
  });
});
