/**
 * `<ProviderMenu>` — the TopBar "Provider ▾" dropdown.
 *
 * The "Multi-Provider Vendor Selection + Auth" milestone shipped
 * `<ProviderAuthPanel>` (provider dropdown + API-key flow + OAuth) but it
 * was buried as the 5th panel in the narrow far-right tools column and was
 * 100%-absent on greenfield. This dropdown SURFACES it: a dedicated TopBar
 * menu, sibling to "Options ▾", hosting the existing panel verbatim.
 *
 * Like `OptionsMenu`, this is open/close-CONTROLLED — `TopBar` owns the open
 * state + the trigger `ref` + the focus-return. It reuses the shared
 * `<Popover>` primitive for the dropdown mechanics (Escape / click-outside /
 * focus-on-open / anchoring), and mounts `<ProviderAuthPanel>` as its body
 * with whatever props the consumer passes through — the panel is fully
 * props-controlled, so it renders identically here and in (the now-removed)
 * tools-column slot.
 */

import { type Component } from 'solid-js';

import { Popover } from './Popover.js';
import { ProviderAuthPanel, type ProviderAuthPanelProps } from './ProviderAuthPanel.js';

export interface ProviderMenuProps {
  /** Open/close-controlled by the parent — ProviderMenu does NOT read the store. */
  open: boolean;
  /** Called when the popover requests dismissal (Esc, click-outside). */
  onClose: () => void;
  /**
   * The full `ProviderAuthPanel` prop set, threaded straight through. The
   * panel is the same props-controlled component the tools column hosted —
   * this dropdown is purely an exposure change.
   */
  panelProps: ProviderAuthPanelProps;
}

export const ProviderMenu: Component<ProviderMenuProps> = (props) => {
  return (
    <Popover
      open={props.open}
      onClose={props.onClose}
      role="menu"
      ariaLabel="Provider"
      class="provider-menu"
    >
      <ProviderAuthPanel {...props.panelProps} />
    </Popover>
  );
};
