# Brujula 1-Minute Spoken Demo Script

Use this as the voiceover for the submission video. The goal is to sound human,
show the working app, and make the judges understand why offline Gemma is not a
nice-to-have, but the whole point.

## Main 60-Second Script

### 0:00-0:08 - Why We Built This

Say:

> Disasters are becoming more frequent, more complex, and harder to coordinate.
> And even when the trigger is not climate, like the June 2026 Venezuela
> earthquakes, the failure pattern is the same: power drops, networks overload,
> responders lose the shared picture, and people wait while help and resources
> exist but do not get matched.

Show:

- Laptop Command Post open at `/command`.
- Phone Field app open at `/field`.
- The field app showing `Hub conectado`.

### 0:08-0:18 - The Problem

Say:

> In the first hours after a disaster, field reports come in as messy voice
> notes, texts, photos, rumors, duplicate messages, and partial locations. A
> coordinator has to answer three questions fast: what is happening, where is
> it, and what resource should move next?

Show:

- The phone report form.
- Start entering or dictating the Playa Grande collapse report.

Demo report:

> Urgente, edificio colapsado en Playa Grande, Catia La Mar. Escuchamos voces
> bajo los escombros, unas 20 personas atrapadas. Necesitamos maquinaria pesada.

### 0:18-0:29 - The Solution

Say:

> This is Brujula: an offline disaster-response coordinator. A laptop becomes
> the local hub. Phones join its hotspot, send reports, and keep working even if
> they drop in and out of range. Gemma runs locally on the laptop, so after
> setup, nothing needs the internet and sensitive reports never leave the
> command post.

Show:

- Tap `ENVIAR REPORTE`.
- Show the phone outbox moving from queued to synced, if visible.
- Pan to the laptop Command Post.

### 0:29-0:42 - What Gemma Does

Say:

> Gemma turns that messy Spanish report into an operational incident: rescue,
> Playa Grande, around 20 people trapped, critical urgency because voices were
> heard. It also deduplicates related reports, prioritizes the board, and
> proposes the best available resource.

Show:

- The new or seeded critical rescue incident at the top of the Command Post.
- Point to category, location, people count, urgency, and priority ranking.
- If already visible, show the dispatch proposal.

### 0:42-0:53 - Human In Command

Say:

> The agent does not silently dispatch anyone. It proposes: send the available
> machinery crew or excavator team to the collapse. The coordinator sees the
> reason, confirms it, or overrides it. The human stays in command.

Show:

- Click `Confirm` on the dispatch proposal.
- Show the phone assignment or synced status after confirmation.

### 0:53-1:00 - Close

Say:

> So the product is simple: messy reports in, coordinated action out. No cloud,
> no connectivity assumption, no data leaving the laptop. Brujula is built for
> the moment when every normal tool has failed.

Show:

- Command Post with confirmed dispatch, map/feed, or protocol panel.
- End on both laptop and phone in the same visual frame if possible.

## Shorter 45-Second Version

Say:

> Disasters are becoming more frequent and harder to coordinate. In Venezuela,
> the June 2026 earthquakes show the exact failure mode: power and networks go
> down, field reports become scattered, and responders lose the shared picture.
>
> This is Brujula, an offline disaster-response coordinator. A laptop becomes
> the local command hub, phones connect to its hotspot, and Gemma runs locally
> on the laptop.
>
> A responder sends a messy Spanish report: a collapsed building in Playa
> Grande, voices under the rubble, around 20 people trapped, machinery needed.
>
> Gemma parses it into a critical rescue incident, deduplicates related reports,
> ranks it at the top of the board, and proposes the best available resource.
>
> The coordinator confirms the dispatch. The agent recommends; the human
> decides.
>
> Messy reports in, coordinated action out. No cloud, no internet, and nothing
> sensitive leaving the command post.

## One-Line Pitch

> Brujula turns chaotic disaster reports into coordinated rescue action,
> offline, with Gemma running locally and a human always in command.

## Submission Description

Brujula is an offline disaster-response coordination system for the first hours
after a crisis, when internet access is down or overloaded. Field phones connect
to a laptop hub over local Wi-Fi and submit voice, text, or photo reports.
Gemma runs locally on the laptop to parse messy reports, merge duplicates,
prioritize incidents, propose dispatches, surface protocol guidance, and
generate situation reports. The coordinator confirms every action, so AI helps
turn chaos into action without removing human control or sending sensitive data
to the cloud.

## Lines To Avoid

- Do not say earthquakes are caused by climate change.
- Do not call it a dashboard as the main feature. Say coordinator, agent, or
  command hub.
- Do not say the AI makes final decisions. Say it proposes and the human
  confirms.
- Do not say it gives medical advice. Say it surfaces responder protocols and
  operational guidance.
