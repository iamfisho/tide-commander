/**
 * Version Display
 * Shows the app version in the bottom left corner of the UI.
 * Subtle and unobtrusive.
 */

import React from 'react';

export function VersionDisplay() {
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

  return (
    <div className="version-display" title={`Tide Commander v${version}`}>
      v{version}
    </div>
  );
}
