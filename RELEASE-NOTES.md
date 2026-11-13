# Lepton 0.6.1

Lepton is a private, local node canvas for AI image, video and text generation. It runs on your own computer, opens in
your browser, and talks to the providers with your own API keys. No account, no hosting, no telemetry.

## New in 0.6.1

A large update: the board is much faster, and there is a lot more you can do on it.

- **Much faster on big boards.** The board shows small copies of pictures and still frames of videos until you look
  closely, and far away nodes are drawn simply. On a 160-node board, panning went from 9 frames a second to 120.
- **Undo anything.** `⌘Z` puts back whatever you last did: deleting, moving, typing, settings, connections, groups,
  drawings. `⇧⌘Z` redoes it. Generated results are never rolled back.
- **Notes, titles and a film layout.** Sticky notes with checkboxes, large titles with bold, lists and a highlighter,
  and a one-click set of labelled sections. A web address in a note or a title is a clickable link.
- **Canvas tools.** Scissors cut strands with a slash. A pen draws on the board, over the nodes too.
- **Link in and Link out.** Gather references under a name in one place and use them anywhere else on the board without
  a strand crossing it.
- **Combine.** Join several prompts into one text, in the order you choose.
- **Audio node.** Speech through Kie.ai in Gemini or ElevenLabs voices: one voice or a conversation in one take,
  acted sounds like a laugh or a whisper, and voice isolation for cleaning up a recording.
- **Crop and draw on images.** Crop any picture on the board, or mark it up with a pen and arrows, and use the result
  as a reference.
- **Lining things up.** Nodes pull into line with each other as you drag, a magnet button snaps them to a grid, and
  Tidy up straightens a selection.
- **Groups.** Every group has a tab down the left edge: click to go to it, drag to reorder. A group's panel can be
  resized by its corners.
- **Stop a run** while it is generating, a **large editor** for any text box, **captions** on Media nodes, and a
  rebuilt quick add (`⇧A`).
- **Storage.** A Storage sheet shows what each project takes on disk and clears what is no longer used; saved projects
  keep one copy of each file, and results are stored as JPEG by default.
- **Hints.** Rest the pointer on any button or setting and a card says what it does, with a tip where one helps.
  Settings → Hints turns them off.
- **A safer local server.** It answers only its own page on your computer, so another website open in the same
  browser cannot start generations or change settings, and one bad request can no longer stop it.
- Seedance 2.5 on Kie.ai goes to 30 seconds. Double-click to edit works on names, titles, notes and group labels.

The changelog has every change in full.

## Getting it running

Install Node.js (18 or newer), double-click `Start Lepton.command` (Mac) or `Start Lepton.bat` (Windows), or run
`npm start` in the folder. Add a key in Settings and the model lists fill in. The README has the full guide, including
how to do it with an AI assistant.

## Everything in the app

### The canvas
- Prompt, Image, Video, Audio, LLM, Prompt batch, Combine, Preview, Compare, Media, Link and Skill nodes, wired by
  dragging between ports. Notes and titles for keeping a plan on the same board.
- Drop a connection on empty canvas to create a matching node; drop a node onto a connection to splice it in.
- Select several nodes and drag one strand: every selected node connects at once.
- Groups with labels and muted colours, a tab for each group down the left edge that glides to it, panels you can
  resize, and groups that fold into a small card you can keep wiring to.
- Copy, cut, paste (also between boards and tabs), duplicate with ⌘D or by ⌘/⌥-dragging, nudge with the arrow keys,
  undo anything with ⌘Z. Paste text to get a Prompt node; paste or drop images, video and audio to get Media.
- Resizable Media, Preview, Compare and Note nodes, with a minimum size so nothing spills out.
- Scissors and a pen at the left end of the dock; snapping to other nodes and to a grid; Tidy up.
- ⇧A quick add, single-key shortcuts for every node type, and a shortcuts list in Settings.

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

- 0.6.1 — A much faster board, undo for everything, notes and titles, scissors and pen, Link in / Link out, Combine,
  the Audio node, crop and draw on images, snapping and Tidy up, group tabs, stop a run, the large editor, Storage.
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
