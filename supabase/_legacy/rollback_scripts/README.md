# Rollback scripts (legacy)

Scripts de rollback DRY mantenidos fuera del path escaneado por la CLI por seguridad operacional.

## 041_multi_role_rollback.sql

Rollback dry de la feature multi-rol (DROP destructivo de columnas, índices, triggers, funciones, policies). Mantenido como referencia. NUNCA aplicado en producción.
