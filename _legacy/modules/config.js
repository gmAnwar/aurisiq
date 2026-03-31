// ============================================================
//  AurisIQ — config.js
//  Configuración del workspace activo.
//  Aquí se edita: empresa, plan, integraciones, branding.
// ============================================================

export const WORKSPACE = {
  id:        'enpagos',
  nombre:    'EnPagos',
  producto:  'Crédito PyME',
  plan:      'BETA',
  scorecard: 'v1_financiero',

  integraciones: {
    vixiees:    { activo: false, estado: 'en_evaluacion' },
    fireflies:  { activo: false, estado: 'proximamente' },
    manual:     { activo: true,  estado: 'activo' }
  }
};

// Plan display info
export const PLAN_INFO = {
  BETA: {
    label:          'BETA',
    limite_mensual: 999,   // ilimitado en beta
    color:          '#d2aa50'
  },
  gratis: {
    label:          'GRATIS',
    limite_mensual: 5,
    color:          '#9a8a70'
  },
  starter: {
    label:          'STARTER',
    limite_mensual: 50,
    color:          '#4caf7d'
  },
  pro: {
    label:          'PRO',
    limite_mensual: 200,
    color:          '#7c3aed'
  }
};

export function getPlanInfo() {
  return PLAN_INFO[WORKSPACE.plan] || PLAN_INFO.gratis;
}
