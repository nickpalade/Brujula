// Field-specific strings for alerts and mission lifecycle.
// Part of the shared i18n system; not in shared/translations.js to keep field concerns isolated.

import { useI18n } from '../shared/i18n.jsx'

const strings = {
  es: {
    // Alert banner
    'alert.critical': 'Alerta crítica',
    'alert.warning': 'Advertencia',
    'alert.info': 'Información',
    'alert.dismiss': 'Descartar',

    // Mission lifecycle
    'mission.step.confirmed': 'Confirmada',
    'mission.step.accepted': 'Aceptada',
    'mission.step.enroute': 'En camino',
    'mission.step.onsite': 'En el sitio',
    'mission.step.done': 'Completada',
    'mission.accept': 'Aceptar misión',
    'mission.enroute': 'En camino',
    'mission.onsite': 'En el sitio',
    'mission.complete': 'Completar misión',
    'mission.outcome.label': 'Resultado',
    'mission.outcome.placeholder': 'Ej: rescatadas 12 personas, 2 heridos trasladados a clínica…',
    'mission.confirm': 'Confirmar',
    'mission.cancel': 'Cancelar',
    'mission.completed': 'Misión completada',
    'mission.withdrawn': 'Misión cancelada',
    'mission.error': 'Error al actualizar — reintenta',
    'mission.busy': 'Actualizando…',
  },
  en: {
    // Alert banner
    'alert.critical': 'Critical alert',
    'alert.warning': 'Warning',
    'alert.info': 'Information',
    'alert.dismiss': 'Dismiss',

    // Mission lifecycle
    'mission.step.confirmed': 'Confirmed',
    'mission.step.accepted': 'Accepted',
    'mission.step.enroute': 'En route',
    'mission.step.onsite': 'On site',
    'mission.step.done': 'Completed',
    'mission.accept': 'Accept mission',
    'mission.enroute': 'En route',
    'mission.onsite': 'On site',
    'mission.complete': 'Complete mission',
    'mission.outcome.label': 'Outcome',
    'mission.outcome.placeholder': 'e.g. rescued 12 people, 2 injured transferred to clinic…',
    'mission.confirm': 'Confirm',
    'mission.cancel': 'Cancel',
    'mission.completed': 'Mission completed',
    'mission.withdrawn': 'Mission cancelled',
    'mission.error': 'Error updating — retry',
    'mission.busy': 'Updating…',
  },
}

export function useFieldStrings() {
  const { lang } = useI18n()

  return (key) => {
    const table = strings[lang] || {}
    const fallback = strings.en || {}
    const value = key in table ? table[key] : key in fallback ? fallback[key] : key
    return value
  }
}
