# ℓ Lepton

Named after the elementary particle. A private, local node-based canvas for AI image, video and text generation, driven by your own API keys.
Runs on your computer, in your browser. Nothing is hosted, no accounts, no telemetry.

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
- Mac says the launcher "cannot be opened because it is from an unidentified developer" — that is the optional
  `Start Lepton.command` double-click launcher. Skip it and use `npm start`.
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

Keys are checked against the provider before being saved to `.lepton.json` next to the app (owner-only permissions,
git-ignored). The page never sees a key; the local server adds it to each request. Keys can also be supplied by
environment variable: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `HF_KEY`.

Model lists come live from each provider, so new models appear as soon as the provider publishes them. Every model
picker groups models by provider. Adding another provider means adding one file in `providers/`.

## Nodes

| Node | What it does |
|---|---|
| Prompt | A text box. Connect its output to Image or Video nodes. Several prompts into one node are joined. |
| Image | Model, aspect ratio, resolution / quality, background (when the model supports it), batch of 1–4. Inputs: prompt, reference images. Keeps a history of past runs (see below). |
| Video | Model, aspect ratio, resolution / mode, duration, sound toggle. Inputs: prompt, start frame, end frame, references (ports appear only when the model supports them). |
| LLM | Give it an instruction and connect any mix of prompt text, images, video or audio. The model's text output feeds the next node's prompt, so it can describe a frame, rewrite a brief into a Seedance prompt, or plan a shot from a reference clip. |
| Prompt batch | Feed it an LLM (or Prompt) node whose text contains several prompts. It splits them (numbered lists, headings, bullets, blank lines or a custom separator) and exposes each as its own output string, so every prompt can drive a different node. "Image per prompt" and "Video per prompt" create one generator per prompt, already connected. |
| Preview | Shows every result of the connected node. Click to enlarge, import back to the board, or download. |
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
of Image and Video nodes, and in LLM instructions. Video nodes also offer `@start frame`,
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

## Canvas

- Two-finger scroll pans, ⌘ + scroll or pinch zooms, Space + drag pans.
- Drag a port to another port to connect. Drop a connection on empty canvas to create a matching node.
- **Connect many at once:** select several nodes, then drag a strand from any one of them. Every selected node with a
  matching output comes along (one strand each), and all of them connect when you drop on an input that takes several
  (References, an LLM's Media, a Prompt input…). Inputs that take one connection get the node you dragged from, with a note.
- Double-click a connection to remove it. Drag from a connected input to re-route it.
- `⌘K` quick add, `P` `I` `V` `L` `B` `O` `C` add nodes, `⏎` runs the selected node, `⌘⏎` runs the whole board.
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

Boards autosave in the browser and can be exported / imported as JSON from Settings.

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
- `uploads/` — files you drop onto the board, plus a small cache of their Higgsfield upload URLs (git-ignored).
- `.cache/` — parsed model parameter tables (git-ignored, safe to delete).
- Browser local storage — the board itself and a cache of the model catalogue.

## Layout

```
server.js            zero-dependency local server; routes to providers
providers/           one module per provider (anthropic, google, openai, higgsfield) plus shared helpers
public/index.html    app shell
public/styles.css    theme
public/js/           state, canvas, nodes, groups, projects, run engine, UI
public/catalog-api.json  fallback model catalogue
```
