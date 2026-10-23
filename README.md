# ℓ Lepton

**Plan, generate and compare AI images and video on one canvas, on your own machine, with your own keys.**

Lepton is a node-based workspace for people who make things with generative models rather than just prompt them.
Drop in references, write prompts, send them through an LLM, fan them out to image and video generators, compare
takes side by side, and keep everything connected so the next shot picks up where the last one left off. It runs as a
small local server and opens in your browser: no account, no hosting, no telemetry, and your API keys never leave your
computer. Named after the elementary particle.

**What it does**

- **One board for the whole pipeline.** Prompt, Image, Video, LLM, Prompt batch, Compare, Preview, Media and Skill
  nodes, wired together by dragging. Drop a node onto a connection to splice it in.
- **Bring your own providers.** Higgsfield, Google Gemini, OpenAI, Anthropic, Kie.ai and fal.ai, each with your own
  key. Model lists come live from the provider, so new models appear the day they ship.
- **Nothing gets lost.** Every generation is kept in the node's history, runs survive a page refresh without
  re-spending credits, and projects save to plain folders you can back up or move.
- **Precise about references.** Type `@` in a prompt to point at a connected image (`@image 2`); tags follow their
  image when you rewire.
- **Built for comparing.** Slide, overlay or difference two takes; download a selection as one zip; copy, paste and
  group nodes; fold a group into a card and keep wiring to it.
- **Teach it your knowledge.** Install skills (folders of instructions and reference files) and connect them to any
  LLM node.

## Getting started

Lepton runs on your own computer and opens in your browser. The only requirement is **Node.js 18 or newer**; there is
nothing else to install and no account to create. Pick whichever of the three routes below suits you.

### Route 1 · In the terminal

1. **Install Node.js** (once) from https://nodejs.org — the "LTS" download.
2. **Open a terminal in this folder.**
   - Mac: right-click the folder in Finder and choose **New Terminal at Folder** (or type `cd `, drag the folder onto
     the Terminal window, press Enter).
   - Windows: open the folder in Explorer, click the address bar, type `cmd`, press Enter.
3. **Start it:**

   ```bash
   npm start
   ```

   It prints a line like `Lepton is running → http://localhost:3141`.
4. **Open that address** in Chrome, Safari, Edge or Firefox.
5. **Add a key.** Click the gear (top right), pick a provider card, paste your key, Connect. Models load immediately.
   Keys are stored only on your computer, in a file next to the app.

To stop, press `Ctrl+C` in the terminal. To run it again later, open the terminal in the folder and `npm start`;
your boards, projects and skills are kept.

If something goes wrong:

- `npm: command not found` — Node.js isn't installed, or the terminal was opened before installing it. Close the
  terminal and open a new one.
- A different address than 3141 is printed — that port was busy; use whatever address is shown.
- **Double-click launchers.** `Start Lepton.command` (Mac) and `Start Lepton.bat` (Windows) start the app and open
  the browser for you. On a Mac, a copy downloaded from the internet may refuse to open the first time: right-click
  the file and choose **Open** once, and if it says you don't have permission, run this in a terminal from the Lepton
  folder once: `chmod +x "Start Lepton.command"`. Either way, `npm start` always works.
- Everything opens but the model lists are empty — no key has been added yet.

### Route 2 · With an AI coding assistant

This works with any assistant that can run commands on your machine: Claude Code (in the terminal or the Code tab of
the Claude desktop app), Cursor, OpenAI Codex, Gemini CLI, GitHub Copilot's agent and similar.

1. Open this folder in the tool (or `cd` into it before starting the assistant).
2. Paste:

   > This folder contains a local web app called Lepton. Check that Node.js 18 or newer is installed and install it if
   > not, start the app with `npm start`, and give me the address to open in my browser. Don't change any files.

3. Open the address it reports and add a key in Settings.

The assistant takes care of installing Node, the terminal and any port problems, and explains errors in plain words.
If you get stuck later, ask it "it says X, what do I do?".

### Route 3 · ChatGPT or Claude in a browser tab

A chat window has no access to your computer, so it cannot run anything, but it can coach you through Route 1:

> I've downloaded a local web app called Lepton. It needs Node.js 18+ and starts with `npm start` in its folder, then
> opens at http://localhost:3141. Walk me through installing Node and running it on my [Mac / Windows PC], one step at a
> time, and wait for me to confirm each step.

Assistants with access to your computer (Route 2) do it for you; chat assistants (Route 3) tell you how.

To use another port, set `LEPTON_PORT`, for example `LEPTON_PORT=4000 npm start`. If the default port is busy, the
server steps to the next free one and prints the new address.

## Connect your providers

Open Settings (gear, top right). Each provider has its own card; add a key for the ones you use:

| Provider | Key from | What it adds |
|---|---|---|
| Anthropic | https://console.anthropic.com/settings/keys | Claude models for the LLM node (reads images; no video or audio input) |
| Google Gemini | https://aistudio.google.com/apikey | Nano Banana 2 / Nano Banana Pro image models, Veo video, Gemini models for the LLM node (reads images, video and audio) |
| OpenAI | https://platform.openai.com/api-keys | GPT Image models, Sora video, GPT models for the LLM node (reads images; audio is transcribed first; no video input) |
| Higgsfield | https://console.higgsfield.ai (Key ID + Secret) | Seedance, Kling, Wan, Soul, Grok Imagine, LTX, MiniMax, PixVerse and the rest of the Higgsfield catalogue |
| Kie.ai | https://kie.ai/api-key | One key for many models: Nano Banana Pro / 2, Seedream 4.5 / 5, GPT Image 2, Flux 2, Seedance 2 / 2.5, Kling 3.0, Grok Imagine, Wan 2.7, Hailuo 2.3 and Topaz image / video upscaling. Extra model ids from docs.kie.ai can be added in Settings |
| fal.ai | https://fal.ai/dashboard/keys | Nano Banana, Flux, Seedream, Veo 3.1, Kling 3, Seedance, Hailuo, Wan, LTX and Topaz upscaling, with controls read from fal's own model descriptions. Any other model id from fal.ai/models can be added in Settings |

Keys are checked against the provider before being saved to `.lepton.json` next to the app (owner-only permissions,
git-ignored). The page never sees a key; the local server adds it to each request. Keys can also be supplied by
environment variable: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `HF_KEY`, `KIE_API_KEY`, `FAL_KEY`.

Model lists come live from each provider, so new models appear as soon as the provider publishes them. Every model
picker groups models by provider. Adding another provider means adding one file in `providers/`.

## Nodes

| Node | What it does |
|---|---|
| Prompt | A text box. Connect its output to Image or Video nodes. Several prompts into one node are joined. Every text box in Lepton grows with its text and can be pulled taller by its bottom-right corner (double-click the corner to let it fit the text again). |
| Image | Model, aspect ratio, resolution / quality, background (when the model supports it), batch of 1–4. Inputs: prompt, reference images. Keeps a history of past runs (see below). |
| Video | Model, aspect ratio, resolution / mode, duration, sound toggle. Inputs: prompt, start frame, end frame, references (ports appear only when the model supports them). |
| LLM | Give it an instruction and connect any mix of prompt text, images, video or audio. The model's text output feeds the next node's prompt, so it can describe a frame, rewrite a brief into a Seedance prompt, or plan a shot from a reference clip. |
| Prompt batch | Feed it an LLM (or Prompt) node whose text contains several prompts. It splits them (numbered lists, headings, bullets, blank lines or a custom separator) and exposes each as its own output string, so every prompt can drive a different node. "Image per prompt" and "Video per prompt" create one generator per prompt, already connected. |
| Preview | Shows every result of the connected node. Click to enlarge, import back to the board, or download. |
| Storyboard | Scenes made of shot cards. Plan first, generate later: each shot has a title, a description, a dialogue line, a status (Concept → Working on → Done) and a frame for the result. See below. |
| Skill | An installed skill (a folder of knowledge) as a node. Connect its output to an LLM node's **Skills** input and the model works with that knowledge. See Skills below. |
| Compare | Connect two images or two videos to A and B. Slider (drag the divider; it can wipe left to right or top to bottom), Side by side, Overlay with adjustable opacity, and Difference (black means identical). Swap A and B with one click. Videos share one play button and scrubber, so both stay on the same frame. Shows each side's size and length; double-click for full screen. |
| Media | An uploaded or imported image, video or audio clip. Drag files onto the canvas, paste, or use Upload. |

Controls are generated from each model's parameter schema, so new models work without code changes.

**Generation history.** Pressing Generate never overwrites what an Image or Video node already has: the current results
move into the node's History strip and the new run becomes active (the active run is what the output port and Preview
nodes show). Each past run lists its time, model and aspect ratio; hover a thumbnail to delete that result, use the
restore button to make a past run active again (the current run goes back into history), or delete a whole run. History
is kept per node (up to 30 runs), saved with the board and copied into project folders.

**Mentions (`@image 1`).** Images connected to a node are numbered in the order they were connected, and a strip of
numbered thumbnails under the node's ports shows which is which. Type `@` in a prompt to pick one from a list (arrow
keys and Enter, or click); hovering an entry outlines that image on the board, and clicking a thumbnail in the strip
inserts its tag. This works in Prompt nodes (the list shows the images of the node the prompt feeds), in the prompt box
of Image and Video nodes, in LLM instructions and in Scene Builder sections. Video nodes also offer `@start frame`,
`@end frame` and `@video 1`; LLM nodes offer `@video 1` and `@audio 1`. Tags are tinted green when they point at
something connected and red when they do not. If a connection is removed or re-made, the tags in the prompt are
rewritten so they keep pointing at the same images; a tag whose image is gone becomes `@image ?`. Generate stops with
a message, before anything is sent, if a prompt mentions an image that is not connected. When sent, tags are phrased
for the model: `@Image 1` for Higgsfield video models, plain "image 1" for image models, and for Gemini, GPT and
Claude text models each attachment is labelled "Image 1:", "Image 2:" so the reference is unambiguous.

Aspect ratio defaults to **Auto** on Image and Video nodes. The prompt comes first: if it states a ratio ("9:16",
"1920x1080") or a plain shape word (portrait, vertical, landscape, square, widescreen, ultrawide), that is used, snapped
to the closest ratio the model supports. Otherwise a connected image (start frame, reference or upload) sets the shape.
With neither, softer prompt cues (cinematic, reel, poster) decide, and failing that the model's own default applies.
The node's status shows the ratio chosen and where it came from.

## Presets

The Presets button in the dock (or `⇧P`, or ⌘K) opens a sidebar of ready-made LLM nodes. Clicking one adds a node with a
curated system prompt already loaded, a default instruction, and the usual Prompt and media inputs; connect an image or
notes, pick a model, press Run, and wire its text output into an Image or Video node.

Presets are plain Markdown files in `presets/`. Each has a short header (title, description, node title, default
instruction) and the system prompt as its body; see `presets/README.md`. Files are read when the sidebar opens, so adding
or editing one needs no restart. The first preset, `environment-sheet.md`, writes hard-anchored environment prompts.

## Template nodes

Template nodes are prompt compilers built from a JSON file in `templates/`: one input per section of your prompt
template, with a short description under each saying what it is, what to connect and whether it is optional. Connect
reference images and notes to the sections you have, leave the rest empty, pick a text model and press Compile. The
model analyses each reference and uses only what you supplied: sections you leave empty are not sent and do not appear
in the prompt, and what you write is kept as written rather than embellished. Each section has an info button that opens
a plain-text guide with grouped suggestions for what to put there. Images are referred to as @Image 1, @Image 2… in the order
listed; connect the same images to the Video node's references in that order. The first template, Scene Builder,
follows the CINEDANCE V4 director system (`templates/cinedance-v4.md`, editable) under a strict rule: story content is
never invented, only technical control (first-frame lock, gaze and landmark locks, lens by content type, physics and
lighting locks) is derived from what you supplied. See `templates/README.md` to add more.

## Storyboard

A storyboard is one large node (dock, `S`, or ⌘K) that holds the plan for a film: scenes stacked top to bottom, each
with its shots left to right. Nothing generates inside it; it is where you work the idea out and keep track.

- **Scenes** have a title and a description. Drag a scene by its header to reorder. The header shows how many of its
  shots are done.
- **Shots** have a title, a description (action, framing, camera), a dialogue line and a status pill that cycles
  Concept → Working on → Done. Drag a shot along its row or into another scene; everything slides into place.
  Shots are numbered `1.1`, `1.2`… and renumber as you move them.
- **Result in, Brief out.** Each shot card has two ports. Connect an Image, Video or Media node to the **Result**
  port on the left and the card's frame shows that node's current result, so swapping in a new take is just
  reconnecting (or drop a file straight onto the frame). The **Brief** port on the right carries the scene and shot
  text as a prompt: wire it into an LLM or straight into an Image node to start generating from the plan.
- **Link nodes.** The link button on a shot ties it to a group of working nodes on the canvas (pick an existing group
  or make one from the current selection). Click it later to glide to that group.
- **Start from what you have.** Right-click a selection of Image, Video or Media nodes for "New storyboard from…" or
  "Add … to Storyboard": each becomes a shot with its result in the frame and its prompt as the description.
- The summary bar shows scenes, shots and progress; the node menu has "Copy outline as text" (Markdown). Deleting a
  storyboard with content asks first. Dropped files are copied into project folders on save, like any other media.

## Skills

A skill is a folder with a `SKILL.md` file (a name and description at the top, the instructions and knowledge below)
plus any reference files: notes, examples, glossaries, past work. This is the same layout other AI tools use, so a
skill made elsewhere installs as-is. Skills live in `~/Documents/Lepton Skills` (changeable in Settings), one folder
each, shared by every project and untouched by app updates.

- **Install:** drop a skill `.zip`, a `SKILL.md` / `.md` file, or a whole skill folder onto the canvas, and the skill is
  installed and its node placed where it landed. The Skills sidebar (dock, `⇧S`) has **Install…** and **Folder…** for
  the same, and **New skill** to write one in the app.
- **Use:** add the skill's node (sidebar, ⌘K, or drag from an LLM node's Skills input) and connect it to an LLM node's
  **Skills** input. Several skills can feed one node. When the node runs, the full text of each skill (SKILL.md and
  every text reference file) is sent with the request as instructions the model must follow, alongside the node's own
  system prompt. The node shows how large the skill is; very large ones are flagged because they may not fit a request.
- **Update:** install the newer version the same way. A skill with the same name is updated in place; files you added
  yourself are kept. The sidebar's menu also has "Update from file…".
- **Add more:** **Edit** in the sidebar (or on the node) opens the skill's text for changes, and **Add files…** adds
  reference files (`.md`, `.txt`, `.json`, `.csv`, `.yaml`, `.xml`, `.html`). Scripts and binaries inside a skill are kept
  on disk but not sent to the model. Because skills are plain files, you can also edit them with any editor; the app
  reads them fresh each time.
- A project that uses a skill not installed on this computer shows the node with a warning and an Install button.

## Canvas

- Two-finger scroll pans, ⌘ + scroll or pinch zooms, Space + drag pans.
- Drag a port to another port to connect. Drop a connection on empty canvas to create a matching node.
- **Connect many at once:** select several nodes, then drag a strand from any one of them. Every selected node with a
  matching output comes along (one strand each), and all of them connect when you drop on an input that takes several
  (References, an LLM's Media, a Prompt input…). Inputs that take one connection get the node you dragged from, with a note.
- Double-click a connection to remove it. Drag from a connected input to re-route it.
- `⌘K` quick add, `P` `I` `V` `L` `B` `O` `C` `S` add nodes, `⏎` runs the selected node, `⌘⏎` runs the whole board.
- `⌘C` / `⌘X` / `⌘V` copy, cut and paste nodes (pasted under the pointer; works between boards and browser tabs). `⇧⌘V` also reconnects whatever fed the originals. Pasting plain text makes a Prompt node; pasting an image makes a Media node. Copies keep settings and text but start without results or history.
- Hold `⌘` or `⌥` and drag a node to pull a copy away from it (Ctrl or Alt on Windows and Linux). `⌘D` duplicates in place.
- Arrow keys nudge the selection by 10 px, `⇧` + arrow by 50 px. `⌘Z` undoes a move, nudge or resize (`⇧⌘Z` redoes); results and connections are never touched by undo.
- Media, Preview and Compare nodes can be scaled: drag any corner and the picture scales with the node. Double-click a corner to return to the default size. A node stops shrinking once its controls would no longer fit (its outline turns amber at that point), so nothing spills out of it.
- Drag a node onto an existing connection to splice it in.
- Select nodes and press `⌘G` to group them: a dim labelled panel wraps them and follows their bounds. Drag the panel to move the whole group, double-click the label to rename, click the panel to pick one of eight muted colours, `⇧⌘G` or "Ungroup" to dissolve it (nodes are kept). Dropping a node inside a panel adds it to that group. The Groups button in the dock (or `G`) opens a sidebar listing every group; click one to glide the view to it.
- **Fold a group away:** select a group and press **Collapse** on its label (or right-click → Collapse). The nodes hide
  behind a small card showing the label, what is inside, and one proxy port per kind of input and output. Connections to
  the inside attach to the card, and you can keep wiring: drag from a card port (or drop a strand onto the card) and,
  when more than one inside node fits, pick which one from a short list. Drag the card to move everything inside; click
  it to open the group again. Folded groups still run as part of the board.

**Download several at once.** Select two or more nodes that hold media (marquee, or shift-click) and a bar appears at
the top with a Download button; it is also in the right-click menu and on `⇧⌘D`. Media nodes add their file, Image and
Video nodes add every result of their current run, Preview nodes add what they show. Everything arrives as a single
`.zip` named after the board and date, with files named after their node or model. Media is stored in the zip as-is
(it is already compressed), so large selections are quick.

Boards autosave in the browser and can be exported / imported as JSON from Settings. When a project has unsaved
changes, opening another project, creating a new one or closing the tab asks whether to save first.

Large boards stay smooth: the grid offset is written as a plain background position (a custom property there would
re-style every node each frame), nodes use a flat surface rather than a live blur, and the dot grid thins and fades out
below 40% zoom.

## Projects (save to a folder)

The Projects button in the dock (or `⌘O`) opens a sidebar. **Save as…** writes the board to a new folder under your
projects folder (default `~/Documents/Lepton Projects`, changeable in Settings); **Save** (`⌘S`) writes back to the
open project. A project is a plain folder:

```
My project/
  project.json   the board (nodes, connections, groups)
  media/         a copy of every image, video and audio the board uses, including generated results
```

Generated results are copied in on save, so a project stays complete after provider links expire. The sidebar lists
the projects in your folder and any you have opened by path from elsewhere; click one to open it. An amber dot next to
the board name means unsaved changes. Copy, zip, back up or move project folders freely; nothing in them is
machine-specific. Your API keys are never written into a project.

## Refresh-safe generation

Every generation and LLM run is registered by the local server and given an id before the provider is called; the
provider work runs in the background and the page polls. The id is written to the board immediately, so refreshing
(or closing and reopening) the page while something is generating just resumes polling; nothing is re-run and no
credits are spent twice. Job records live in `.cache/jobs.json` for seven days, so even a server restart keeps
results that finished while it was down (provider-side jobs) or already finished (files in `uploads/`).

## What is stored where

- `.lepton.json` — your provider keys, projects folder, skills folder and recent projects (git-ignored).
- Your skills folder — one folder per installed skill (see Skills).
- Your projects folder — one folder per saved project (see Projects).
- `uploads/` — files you drop onto the board and generated results, plus small caches of the links providers were
  given for them (git-ignored).
- `.cache/` — model parameter tables, fal.ai model descriptions, the job registry and temporary zips (git-ignored,
  safe to delete).
- Browser local storage — the board itself and a cache of the model catalogue.

## Layout

```
server.js              zero-dependency local server: routes, job registry, projects, skills, zip download
providers/             one module per provider (anthropic, google, openai, higgsfield, kie, fal) plus common.js helpers
public/index.html      app shell
public/styles.css      theme
public/js/             state, canvas, nodes, groups, projects, mentions, compare, clipboard, skills, history, textbox,
                       dialog, download, split, models, run engine, UI
public/catalog-api.json  fallback model catalogue
Start Lepton.command   Mac launcher   ·   Start Lepton.bat   Windows launcher
RELEASE-NOTES.md       what each version added
presets/               system-prompt presets   ·   templates/   template-node specs   ·   releases/   checkpoint archives
```
