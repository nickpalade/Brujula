const DENSITY_KEY = 'brujula.command.density.v1';

function loadCommandDensity() {
  try {
    return localStorage.getItem(DENSITY_KEY) || 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function saveCommandDensity(value) {
  try {
    localStorage.setItem(DENSITY_KEY, value);
  } catch {
    // Storage may be unavailable in private mode; state still lasts this session.
  }
}

export { loadCommandDensity, saveCommandDensity };
