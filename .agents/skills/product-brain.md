---
name: product-brain
description: Autonomous product analysis — reads canvases, identifies high-impact features not in backlog, deposits proposals in canvas F0AS7R771FG
user_invocable: true
---

# Product Brain — AurisIQ Feature Discovery

Run this agent every 5 sessions (not every session). It reads strategic canvases, identifies gaps, and proposes features.

## Protocol

1. **Read canvases** (all three, in order):
   - ROADMAP: F0ANYRKF0QJ — current stages and planned features
   - SESIONES: F0ALHCSA449 — changelog of recent sessions (what was built)
   - TECNICO: F0ALYPV5D16 — stack, schema, architecture decisions

2. **Identify 3-5 features** that meet ALL criteria:
   - Not already in the roadmap or backlog
   - Solves a real pain point for current clients (Inmobili, EnPagos)
   - Implementation effort < 1 session (S or M, not L)
   - Differentiates AurisIQ vs competitors (Siro, Rilla, Gong)

3. **Deposit proposals** in canvas F0AS7R771FG with this format per feature:
   ```
   ## [Feature Name]
   **Descripción:** 2 lines max
   **Justificación:** Why this matters for retention/activation
   **Esfuerzo:** S / M / L
   **Prioridad sugerida:** 1-5
   ```

4. **Post in #aurisiq** (C0AL7UWC1SM):
   ```
   Product Brain: X propuestas depositadas en canvas F0AS7R771FG.
   [1-line summary of each proposal]
   ```

## What NOT to propose
- Infrastructure/refactoring work (that goes in TECNICO gaps)
- Features already listed in ROADMAP
- Features that require > 1 session of effort
- Generic AI/ML features without specific client pain
