# Demo Phone Report

Use this after running `npm run seed` and opening `/command/graph`.

## Main Paste

Paste this into the phone report text box, leave category/location optional, then send:

```text
Urgente en Playa Grande: el edificio que se cayó sigue con gente atrapada. Se escuchan gritos en la escalera trasera; Maria Torres y Luis Rivas están desaparecidos adentro con unas 4 personas más. Necesitamos equipo de rescate y maquinaria para abrir paso.
```

Expected graph update:

- A new report node appears and connects into the Gemma brain.
- The report should merge into the existing `Playa Grande` collapse incident.
- Named people should appear in the People view if the parser extracts them.
- Gemma should propose dispatching the excavator/shoring crew or rescue team, creating a dispatch/resource chain for the collapse.

## Backup New Incident

Use this if you want a clearly new node instead of a merge:

```text
En Catia La Mar, Escuela Básica Simón Bolívar: somos 90 personas en refugio y se acabó el agua potable esta mañana. Hay niños con diarrea y necesitamos camión cisterna urgente.
```

## Backup Resource Offer

Use this to show that a field phone can add capacity to the board:

```text
Tenemos una camioneta con 40 cajas de agua disponible en Maiquetía, conductor listo para salir hacia Macuto o La Guaira.
```
