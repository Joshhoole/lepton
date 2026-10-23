# Lepton 0.5.1 — first public release

Lepton is a private, local node canvas for AI image, video and text generation. It runs on your own computer, opens in
your browser, and talks to the providers with your own API keys. No account, no hosting, no telemetry.

## Getting it running

Install Node.js (18 or newer), double-click `Start Lepton.command` (Mac) or `Start Lepton.bat` (Windows), or run
`npm start` in the folder. Add a key in Settings and the model lists fill in. The README has the full guide, including
how to do it with an AI assistant.

## Features

### The canvas
- Prompt, Image, Video, LLM, Prompt batch, Preview, Compare, Media and Skill nodes, wired by dragging between ports.
- Drop a connection on empty canvas to create a matching node; drop a node onto a connection to splice it in.
- Select several nodes and drag one strand: every selected node connects at once.
- Groups with labels and muted colours, a Groups sidebar that glides to any group, and groups that fold into a small
  card you can keep wiring to.
- Copy, cut, paste (also between boards and tabs), duplicate with ⌘D or by ⌘/⌥-dragging, nudge with the arrow keys,
  undo a move or resize with ⌘Z. Paste text to get a Prompt node; paste or drop images, video and audio to get Media.
- Resizable Media, Preview and Compare nodes, with a minimum size so nothing spills out.
- ⌘K quick add, single-key shortcuts for every node type, and a shortcuts list in Settings.

### Providers, with your keys
- Higgsfield (Seedance, Kling, Wan, Soul, Grok Imagine, LTX, MiniMax, PixVerse and the rest of the catalogue),
  Google Gemini (Nano Banana image models, Veo video, Gemini text), OpenAI (GPT Image, Sora, GPT text), Anthropic
  (Claude text), Kie.ai and fal.ai (one key each for a wide catalogue of image and video models, including Topaz
  upscaling).
- Model lists come live from each provider, so new models appear as soon as they are published. One entry per model;
  input modes (text, image, reference) are chosen automatically from what you connect.
- Controls are built from each model's own parameter list: aspect ratio, resolution, quality, duration, sound, batch
  size and the model's extras under Advanced. Credit cost per run is shown on the button when the catalogue states it.
- Keys are checked before they are saved, stored only on your machine, and never written into boards or projects.

### Generation that doesn't lose work
- Every run is tracked by the local server: refresh or close the page mid-generation and it resumes, with no credits
  spent twice.
- Generation history on every Image and Video node: past runs are kept, restorable and deletable, and the active run
  is what feeds the next node.
- Auto aspect ratio: a ratio or shape word in the prompt wins, otherwise a connected image sets the shape.
- Mentions: type `@` in a prompt to refer to a connected image (`@image 2`), with a numbered thumbnail strip on the
  node; tags follow their image when you rewire, and a run stops early if a mention points at nothing.

### Text and knowledge
- LLM nodes take a system prompt, an instruction and any mix of text, images, video and audio, and feed their output
  onward as a prompt.
- Prompt batch splits one LLM answer into separate prompts, each on its own port, with one-click fan-out to an Image
  or Video node per prompt.
- Skills: install folders of knowledge (`SKILL.md` plus reference files, the layout other AI tools use) from a .zip,
  .md or folder, edit them in the app, and connect them to any LLM node.

### Comparing and delivering
- Compare node: two images or videos under a slider, side by side, overlaid or as a difference, with synced video
  playback.
- Select nodes and download everything they hold as one .zip.
- Projects save to plain folders (`project.json` + `media/`) that you can back up, move or share; media is copied in
  so a project stays complete after provider links expire. Unsaved changes are never dropped silently: switching or
  creating projects, importing a board or closing the tab asks first.

## Updates on the way to 0.5.1

- 0.5.1 — Kie.ai and fal.ai providers; text boxes can be pulled taller; a save prompt guards unsaved project changes.
- 0.5.0 — Layout undo, launchers for Mac and Windows, tidier Skills sidebar, Auto aspect ratio follows the prompt
  first, Higgsfield models with undocumented file inputs (Soul 2 · Image to image, Genjutsu Restyle) get their ports,
  Space no longer re-presses the last button.
- 0.4.0 — Skills, multi-connect from a selection, collapsible groups.
- 0.3.1 — Media saved into a project folder works as an input again.
- 0.3.0 — Compare node, resizable nodes, copy / cut / paste and modifier-drag duplicate, @ mentions, multi-download.
- 0.2.0 — Projects, generation history, groups sidebar, refresh-safe jobs, performance work for large boards.
- 0.1.0 — The canvas, the four providers, live model lists, groups and auto aspect ratio.

## Known limits

- Anthropic text models read images but not video or audio; OpenAI text models transcribe audio and cannot read video.
- The Windows launcher has not been exercised on Windows yet; `npm start` always works.
- Upscaling and LoRA / character training are not built in yet.
