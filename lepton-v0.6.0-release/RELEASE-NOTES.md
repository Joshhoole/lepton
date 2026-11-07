# Lepton 0.6.0

Lepton is a private, local node canvas for AI image, video and text generation. It runs on your own computer, opens in
your browser, and talks to the providers with your own API keys. No account, no hosting, no telemetry.

## New in 0.6.0

- **Audio references.** Drop a WAV, MP3, M4A, OGG, AAC, FLAC or AIFF on the canvas and it becomes an audio Media node.
  Video models that take audio (Seedance 2.0 and 2.5 on Higgsfield and Kie.ai, Kling 4.0 reference-to-video and others
  on Kie.ai) show an "Audio refs" port, and the clip is sent as the model's audio reference.
- **One node, many prompts.** Connect a Prompt batch's "All prompts" port to a single Image or Video node and it
  generates every prompt at once, one result per prompt. Preview shows the lot as numbered tiles. Any row of a batch
  can be popped out into its own Prompt node.
- **Peek.** Hover a connected-image chip, a linked prompt or an input port and a card beside the node shows what that
  strand carries: the picture large, the full text, or the list of what is connected.
- **Reorder references.** Drag the numbered chips to change which image is 1, 2, 3. The model gets them in that order
  and the @ tags in your prompt follow.
- **Show in folder.** A folder button on every result, Preview item, Media node and the enlarged view reveals the saved
  file in Finder or Explorer. Nothing needs downloading twice.
- **Prompt length warning.** Models with a prompt cap (Kling: 2,500 characters) show a counter as you approach it and
  say by how many characters to cut; Generate refuses before anything is spent.
- Skills install from `.skill` files as well as .zip.
- Fixed: Kling 4.0 on Higgsfield refused reference images ("image_url is a required property"); clicking a result in a
  busy Preview no longer moves the camera.

## Getting it running

Install Node.js (18 or newer), double-click `Start Lepton.command` (Mac) or `Start Lepton.bat` (Windows), or run
`npm start` in the folder. Add a key in Settings and the model lists fill in. The README has the full guide, including
how to do it with an AI assistant.

## Everything in the app

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
  (Claude text), Kie.ai and fal.ai.
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
  so a project stays complete after provider links expire, and unsaved changes are never dropped silently.

## Version history

- 0.6.0 — Audio references, one node for a whole prompt batch, peek cards, reorderable references, show in
  folder, prompt length warning, .skill installs.
- 0.5.1 — Kie.ai and fal.ai providers, stretchable text boxes, save prompt, plain key placeholders.
- 0.5.0 — Layout undo, launchers for Mac and Windows, tidier Skills sidebar, Auto aspect ratio follows the prompt
  first, Higgsfield models with undocumented file inputs get their ports, Space no longer re-presses the last button.
- 0.4.0 — Skills, multi-connect from a selection, collapsible groups.
- 0.3.1 — Media saved into a project folder works as an input again.
- 0.3.0 — Compare node, resizable nodes, copy / cut / paste and modifier-drag duplicate, @ mentions, multi-download.
- 0.2.0 — Projects, generation history, groups sidebar, refresh-safe jobs, performance work for large boards.
- 0.1.0 — The canvas, the first four providers, live model lists, groups and auto aspect ratio.

## Known limits

- Anthropic text models read images but not video or audio; OpenAI text models transcribe audio and cannot read video.
- Kie.ai and fal.ai field maps come from their documentation; a model that rejects a field needs a one-line fix.
- The Windows launcher has not been exercised on Windows yet; `npm start` always works.
- LoRA / character training and a dedicated upscaling workflow are not built in yet (Topaz upscalers are available
  as ordinary models through Kie.ai and fal.ai).
