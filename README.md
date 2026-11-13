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
| Kie.ai | https://kie.ai/api-key | One key for many models: Nano Banana Pro / 2, Seedream 4.5 / 5, GPT Image 2, Flux 2, Seedance 2 / 2.5, Kling 3.0, Grok Imagine, Wan 2.7, Hailuo 2.3, Topaz image / video upscaling, and ElevenLabs speech for the Audio node. Extra model ids from docs.kie.ai can be added in Settings |
| fal.ai | https://fal.ai/dashboard/keys | Nano Banana, Flux, Seedream, Veo 3.1, Kling 3, Seedance, Hailuo, Wan, LTX and Topaz upscaling, with controls read from fal's own model descriptions. Any other model id from fal.ai/models can be added in Settings |

Keys are checked against the provider before being saved to `.lepton.json` next to the app (owner-only permissions,
git-ignored). The page never sees a key; the local server adds it to each request. Keys can also be supplied by
environment variable: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `HF_KEY`, `KIE_API_KEY`, `FAL_KEY`.

Model lists come live from each provider, so new models appear as soon as the provider publishes them. The model
picker opens as a two-column menu: providers on the left, the chosen provider's models on the right grouped by family
(Kling, Seedance, Nano Banana…), with a search box across everything. **Latest only** (on by default) hides versions
that a newer one of the same family and task has replaced; untick it to see every version. Adding another provider means adding one file in `providers/`.

## Nodes

| Node | What it does |
|---|---|
| Prompt | A text box. Connect its output to Image or Video nodes. Several prompts into one node are joined. Every text box in Lepton grows with its text and can be pulled taller by its bottom-right corner (double-click the corner to let it fit the text again). |
| Image | Model, aspect ratio, resolution / quality, background (when the model supports it), batch of 1–4. Inputs: prompt, reference images. Keeps a history of past runs (see below). |
| Video | Model, aspect ratio, resolution / mode, duration, sound toggle. Inputs: prompt, start frame, end frame, references (ports appear only when the model supports them). |
| Audio | Speech from text, through ElevenLabs on Kie.ai. Pick a model, a voice (the ▶ beside the list plays a sample), and set stability, similarity, style and speed. Inputs: text, typed or from a Prompt, LLM or Prompt batch (one clip per prompt). Output: audio, which connects to Preview, an LLM, or a Video model that takes audio. See Audio below. |
| LLM | Give it an instruction and connect any mix of prompt text, images, video or audio. The model's text output feeds the next node's prompt, so it can describe a frame, rewrite a brief into a Seedance prompt, or plan a shot from a reference clip. |
| Prompt batch | Feed it an LLM (or Prompt) node whose text contains several prompts. It splits them (numbered lists, headings, bullets, blank lines or a custom separator). Connect its "All prompts" header port to one Image or Video node and that node generates every prompt at once with the same settings, one result per prompt; a Preview shows them as tiles (click one to look closer). Each row also has its own output, a pop-out button that turns that prompt into its own Prompt node, and "Image per prompt" / "Video per prompt" still create one generator per prompt. |
| Preview | Shows every result of the connected node. Click to enlarge, import back to the board, or download. |
| Skill | An installed skill (a folder of knowledge) as a node. Connect its output to an LLM node's **Skills** input and the model works with that knowledge. See Skills below. |
| Combine | Several texts in, one text out (`J`, quick add, the right-click menu, or drag a text strand onto empty canvas). Connect Prompt nodes, LLM outputs, a Prompt batch or a Link out's text; they are joined in the order listed, exactly as written, with no model involved. Drag a piece by its grip to change the order, × to disconnect it. "Between each" sets what separates them: a blank line, a new line, a space, a comma, nothing, or your own text (`\n` for a new line). The node shows the joined text, follows its sources as they change, and its output goes anywhere a prompt can. A batch's "All prompts" comes in as one piece per prompt. |
| Link in / Link out | A connection without a strand. Plug references into a **Link in** and name it; a **Link out** anywhere else on the board stands for them. See [Links](#links). |
| Compare | Connect two images or two videos to A and B. Slider (drag the divider; it can wipe left to right or top to bottom), Side by side, Overlay with adjustable opacity, and Difference (black means identical). Swap A and B with one click. Videos share one play button and scrubber, so both stay on the same frame. Shows each side's size and length; double-click for full screen. |
| Media | An uploaded or imported image, video or audio clip. Drag files onto the canvas, paste, or use Upload. |

Controls are generated from each model's parameter schema, so new models work without code changes.

**Generation history.** Pressing Generate never overwrites what an Image or Video node already has: the current results
move into the node's History strip and the new run becomes active (the active run is what the output port and Preview
nodes show). Each past run lists its time, model and aspect ratio; hover a thumbnail to delete that result, use the
restore button to make a past run active again (the current run goes back into history), or delete a whole run. History
is kept per node (up to 30 runs), saved with the board and copied into project folders.

**Mentions (`@image 1`).** Images connected to a node are numbered in the order they were connected, and a strip of
numbered thumbnails under the node's ports shows which is which; hover a thumbnail and press its × to disconnect that
image. Type `@` in a prompt to pick one from a list (arrow
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

## Audio

The Audio node (`A`, or Audio in the dock and quick add) needs a Kie.ai key. It has two families of voices.

**Gemini** (the node starts on Gemini 3.8 Flash):

- **Gemini 3.8 Flash · Speech** and **Flash Lite · Speech** (quicker and cheaper) — speak the text in one of 70 voices,
  listed by what each suits (Storyteller, Podcast, Commercial voiceover…). For two voices in one take, start a line
  with a voice's name and a colon (`Zephyr: Did it work?`); lines with no name keep the last voice. Sounds in angle
  brackets are acted: `<laugh>`, `<sigh>`, `<whispers>`, `<short pause>`. Temperature sets how varied the delivery is.

**ElevenLabs:**

- **Multilingual v2** — speaks the text in the voice you pick. The most natural of the two speech models; it works out
  the language from the text.
- **Turbo v2.5** — the same, faster and cheaper, and it has a Language setting to hold it to one language.
- **Dialogue v3** — a conversation in one take. Start a line with a voice name and a colon to change speaker
  (`James: Did you bring the map?`); a line with no name keeps the last voice, and the lines before the first name use
  the voice chosen on the node. A name is a voice's name, first name or id. Directions in square brackets, like
  `[whispers]` or `[laughs]`, are acted. Stability is Creative, Natural or Robust.
- **Voice isolation** — takes a recording (connect a Media audio node, up to 10 MB) and returns the voice on its own,
  with music and background noise removed. It has no text box.

ElevenLabs has 67 voices, each with a sample you can play from the node. Each run is up to 5,000 characters; the node counts against that as you type. Results are players
in the node: with more than one, the number beside a player picks which is the node's output. Past runs are in History.
Text is sent as written, so `@` in a script is just a character.

## Links

For references you use again and again, so that one strand does not have to cross the whole board each time.

- **Link in** (`K`, the dock, quick add, or drag a strand onto empty canvas and choose "Add Link in"): connect any
  number of images, videos, audio clips and prompts to it and give it a name. Let go of a strand anywhere on the node
  to plug it in. It can sit off to the side with your references.
- **Link out** (`⇧K`, the dock, or quick add, which lists one "Link out: name" per link): choose the link from its
  list, and it stands for everything in that link. It has one output per kind of thing the link holds (Images, Video,
  Audio, Text); connect those to the nodes next to it with short strands. Use as many Link outs as you like.

No line is drawn between the two. Each link has a coloured dot that is the same on its Link in and on every Link out
(click the dot on the Link in to change it), "used in 2 places" on a Link in jumps to its Link outs, and the target
button on a Link out jumps back.

A link holds no copy of anything. The node on the far side sees the real sources, exactly as if each had its own
strand: its reference strip shows every image (with a dashed outline, since it arrives through a link), `@image 2`
mentions work, and a new result, another pick or an edited prompt at the source is what gets sent next time. A port
that takes one thing (a start frame) takes the link's first. Unplug something at the Link in and it is gone from
every place the link is used. Deleting a Link in leaves its Link outs in place, saying the link was removed, with
their strands intact, so you can point them at another link.

Links belong to one board. A Link out copied together with its Link in goes with the copy; copied alone, it still
names the original. A connection that would make a link feed itself is refused.

## Skills

A skill is a folder with a `SKILL.md` file (a name and description at the top, the instructions and knowledge below)
plus any reference files: notes, examples, glossaries, past work. This is the same layout other AI tools use, so a
skill made elsewhere installs as-is. Skills live in `~/Documents/Lepton Skills` (changeable in Settings), one folder
each, shared by every project and untouched by app updates.

- **Install:** drop a skill `.zip`, a `SKILL.md` / `.md` file, or a whole skill folder onto the canvas, and the skill is
  installed and its node placed where it landed. The Skills sidebar (dock, `⇧S`) has **Install…** and **Folder…** for
  the same, and **New skill** to write one in the app.
- **Use:** add the skill's node (sidebar, quick add, or drag from an LLM node's Skills input) and connect it to an LLM node's
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
- Over a text box holding more text than it shows, the wheel (or two fingers) scrolls the text instead of the board.
  A scroll that starts on the board keeps moving the board even when a text box slides under the pointer.
- **Large editor:** hover any text box in a node and press the arrows button in its top-right corner to open the same
  text in a big editor. What you type goes straight into the node (and is saved) as you type; `@` mentions work there
  too. **Revert** puts back the text as it was when you opened it; `Esc`, `⌘⏎`, Done or a click outside closes it.
- Drag a port to another port to connect. Drop a connection on empty canvas to create a matching node.
- **Connect many at once:** select several nodes, then drag a strand from any one of them. Every selected node with a
  matching output comes along (one strand each), and all of them connect when you drop on an input that takes several
  (References, an LLM's Media, a Prompt input…). Inputs that take one connection get the node you dragged from, with a note.
- Double-click a connection to remove it. Drag from a connected input to re-route it.
- **Hints.** Rest the pointer on a button or a setting and a small card says what it does, sometimes with a tip. Turn them off in Settings → Hints once you know your way around.
- `⇧A` opens quick add at the pointer: hover a category (Text, Image, Video, Audio, View, Link, Notes, Skills) for its
  list, or just type to search everything; the node lands where the menu opened, and a click or scroll elsewhere puts
  it away. `⌘K` opens it too, which is the one to use while the cursor is in a text box.
- `P` `I` `V` `A` `L` `B` `O` `C` add nodes, `J` a Combine, `K` a Link in and `⇧K` a Link out, `N` a note and `T` a title where the pointer is, `X` scissors, `D` pen, `⏎` runs the selected node.
- `⌘C` / `⌘X` / `⌘V` copy, cut and paste nodes (pasted under the pointer; works between boards and browser tabs). `⇧⌘V` also reconnects whatever fed the originals. Pasting plain text makes a Prompt node; pasting an image makes a Media node. Copies keep settings and text but start without results or history.
- Hold `⌘` or `⌥` and drag a node to pull a copy away from it (Ctrl or Alt on Windows and Linux). `⌘D` duplicates in place.
- **Nodes pull into line as you drag.** A dragged node (or a dragged selection or group, taken as one box) that comes within 6 pixels of lining up with another node on screen is pulled the rest of the way: left, right, top and bottom edges against edges, and middles against middles. A thin amber line shows what it lined up with. Hold `⇧` during a drag to place a node freely.
- **Snap to grid.** The magnet beside the zoom buttons (or `⇧G`) turns it on and off. While it is on, a dragged node lands on the board's 24 px grid (the grid the dots are drawn on at 100%), and the arrow keys move by one grid square (`⇧` + arrow by four). The setting belongs to the browser, not the board, so it stays as you left it. Nodes are only moved onto the grid when you drag or nudge them.
- Arrow keys nudge the selection by 10 px, `⇧` + arrow by 50 px.
- **Undo anything.** `⌘Z` puts back the last thing you did to the board and `⇧⌘Z` does it again, up to 100 steps: adding, deleting, moving and resizing nodes; text typed into any node, note or title; every setting inside a node (model, aspect, batch, sliders, separators, colours); renaming a node, a group or the board; connecting, disconnecting, cutting and reordering strands; grouping, ungrouping, folding, resizing, recolouring and reordering groups; pen drawings and erasing; cropping in place; clearing the board. A short message says what was undone. One action is one step: a drag or a slider pull is a single step, and typing is one step per pause. A deleted node comes back with its strands, its place in its group and its results. While the cursor is in a text box, `⌘Z` is the box's own undo, letter by letter; click away and it undoes the whole edit. What undo never touches is what a generation produced: results, history and run status stay as they are, so undoing an earlier move cannot take a picture away (a generation itself cannot be un-run). Deleting a result or a run, or making a past run current, are your actions and can be undone. Undo carries on across saving a project; opening another project or importing a board starts a fresh history.
- Double-click a node's name ("Image", "Video", "LLM"…) to rename it, or choose Rename from its ⋯ menu. `Return` keeps the name, `Esc` puts the old one back, and an empty name returns to the node's kind. The new name is what `@` mentions and reference strips show.
- Media, Preview and Compare nodes can be scaled: drag any corner and the picture scales with the node. Double-click a corner to return to the default size. A node stops shrinking once its controls would no longer fit (its outline turns amber at that point), so nothing spills out of it.
- Drag a node onto an existing connection to splice it in.
- Select nodes and press `⌘G` to group them: a dim labelled panel wraps them and follows their bounds. Drag the panel to move the whole group, drag any corner of it to make it larger than its nodes (it cannot be made smaller than them; double-click a corner, or press Fit, to let it fit them again), double-click the label to rename, click the panel to pick one of eight muted colours, `⇧⌘G` or "Ungroup" to dissolve it (nodes are kept). Dropping a node inside a panel adds it to that group. Every group also has a **tab** in a column down the left edge of the board. Click a tab to glide the view to its group and select it. Drag a tab up or down to change the order: the other tabs slide out of its way, and the order is saved with the board (`⌥↑` / `⌥↓` move a focused tab by keyboard). A column with more tabs than the window has room for scrolls, also while a tab is dragged near its top or bottom. The Groups button in the dock (or `G`) hides the column and brings it back; that choice is kept per browser.
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

**Large boards stay smooth.** Three things you will notice, and a few rules underneath:

- **Small copies of pictures.** A picture on the board is shown a few hundred pixels wide, so the board shows a small
  copy (720 pixels wide) and keeps the original for generating, enlarging, comparing and downloading. Zoom in far
  enough, or pull a node large, and that picture switches to the original while it needs to. The copies are made in
  the browser the first time a file is seen (a note appears when there are many) and kept in `.cache/thumbs`; delete
  that folder and they are simply made again. Nothing is written into a project.
- **Videos are still frames until you point at them.** A clip shows its first frame and loads only while the pointer
  is over it; a few seconds after the pointer leaves it goes back to the still.
- **Far away, nodes are simpler.** Below 30% zoom the writing inside a node is too small to read, so each node shows
  only its name (drawn larger) and its pictures. Nothing moves or changes size, and notes and titles are untouched.

The rules the canvas code keeps to: the board is not pinned as one compositor layer (`will-change` on it made panning
a 160-node board run at 9 fps); strands are measured first and changed afterwards, and only the ones that moved are
touched; a node's element is looked up once and remembered; nothing that changes while panning or zooming is a
property every node inherits; the dot grid is its own sheet, slid with a transform, and fades out below 40% zoom.

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

## Storage

**Settings → Manage storage…** (or the button at the foot of the Projects sidebar) opens a sheet that shows what Lepton
keeps on disk and gives space back without losing work.

- **Temporary files.** `uploads/` only holds things until they are saved. When a project is saved it gets its own copy
  of every file (a free clone on a Mac) and the temporary one is removed. A file that no saved project and no open
  board has used for 14 days moves to Recently removed; pick 7 or 30 days, or Never, in the sheet. Each browser tells
  the server which files its board uses, so an unsaved board is never emptied, and automatic clearing starts three days
  after the first check-in. **Clear unused** does the same at once.
- **Projects.** Each project row opens to four actions. **Trim…** drops the earlier runs, or also the takes you did
  not pick (one result per prompt stays). **Remove** clears files in the media folder the board no longer points to.
  **Convert to JPEG** re-encodes the project's PNG results. **Archive…** packs the project into one zip in `Archive/`
  inside the projects folder and takes it off the list; "Finals only" keeps the board and one picked result per prompt
  and leaves the rest out for good. Archived projects are listed at the bottom of the sheet with **Restore**.
- **Image format.** JPEG is the default: when a project is saved, PNG results are stored as high-quality JPEG, usually
  well under half the size. Pictures with transparency, 16-bit PNGs and files you add yourself are never changed.
  Choose PNG to keep results exactly as the model returned them.
- **Recently removed.** Whatever a clean-up takes away goes to a hidden `.trash` folder (inside the project, or inside
  `uploads/`) and is deleted after 30 days. **Restore** puts a batch back; the board goes back with it when the project
  has not been saved since. **Empty now** deletes it all straight away.
- **Free up space** at the top runs the two safe ones together: unused temporary files and unused project files.

## Canvas tools

The first three buttons in the dock choose what a drag on the canvas does. A tool stays on until you pick another or
press `Esc`; Space or ⌥ still pans.

- **Select** — the normal mode: move and select nodes, connect ports.
- **Scissors** (`X`) — drag a line across strands to cut every one it crosses (they turn red first), or click one
  strand. `⌘Z` brings a whole cut back in one step.
- **Pen** (`D`) — draw on the canvas: six colours, three thicknesses, an **Eraser** that removes a drawing you drag
  over, and **Clear all**. The pen draws over everything: nodes, notes, titles and the text boxes and buttons inside
  them, none of which react while the pen is on. Drawings are the top layer of the board, are saved with the board and
  inside projects, and stay where they were drawn when nodes move. With Select on, everything under a drawing works
  as usual.

## Notes, titles and markup

Things for staying organised. None of them is ever sent to a model.

- **Note** (`N`, the Notes button in the dock, or quick add): a coloured sticky note. Double-click its text to edit, with the cursor where you clicked. A line that
  starts with `[ ]` is a checkbox you can tick; **Checklist** in the bar above a selected note turns every line into
  one, and **To prompt** turns the note into a Prompt node.
- **Links.** A web address written or pasted into a note or a title (`https://…`, `http://…` or `www.…`) is underlined
  once you finish editing; click it and the page opens in a new tab. You can still drag the node by a link, and
  double-click still edits the text.
- **Title** (`T`): large text in four sizes and eight colours. Double-click it to write in it: `Return` starts a new
  line, and `Esc`, `⌘⏎` or a click anywhere else finishes. The bar above a selected title formats it: **bold** (`⌘B`),
  *italic* (`⌘I`), underline (`⌘U`), strike-through (`⇧⌘X`), a highlighter (`⇧⌘E`), bullet points (`⇧⌘8`) and a
  numbered list (`⇧⌘7`). The buttons act on the selected words while you are writing, and on the whole title when you
  are not. Starting a line with `- ` begins a bullet list and `1. ` a numbered one; `Tab` and `⇧Tab` indent a list
  item. Pasted text comes in plain. A title is a fixed size on the board and zooms with everything else, so what you
  lay out around it stays where you put it.
- **Film layout** (Notes in the dock or quick add): five titled sections, References, Characters, Locations, Shots and
  Finals, each with a note saying what goes there.
- **Crop an image:** the crop button on a Media node, "Crop" in the enlarged view, or "Crop image" in the right-click
  menu of a Media or Image node. Drag the frame's corners or edges, drag inside it to move it, or drag on the picture
  outside it to draw a new one; the arrow keys move it a pixel at a time (ten with `⇧`). The frame can be held to a
  shape (Original, 1:1, 4:3, 3:2, 16:9, 21:9 and the tall versions), and the picture can be turned a quarter or
  flipped first. The size in pixels is shown as you go. **Add to board** (`⏎`) saves the crop as a new Media node
  beside the source. **Replace**, on a Media node, swaps its picture for the crop so its strands keep working;
  "Restore original image" in the node's menu brings the full picture back. The crop is cut from the full-size file,
  the original file is never changed, and see-through parts are kept.
- **Draw on an image:** the pen button on a Media node, "Draw on it" in the enlarged view, or the right-click menu of
  an Image node. Pen and arrow, six colours, three thicknesses, `⌘Z` to undo a stroke. **Add to board** saves the
  result as a new Media node beside the original, which you can connect to a model as a reference.
- **Tidy up:** with two or more nodes selected, the bar at the top (and the right-click menu) straightens them into rows and
  columns. Nothing is reordered: each node keeps the place it already holds.
- **Captions:** select a Media node and type under the picture.

## Stopping a run

While a node is generating, its button reads **Stop generating**. Pressing it does whatever is still possible and says
which it was:

- **Not sent yet** (inputs were still being prepared or uploaded): the request never leaves your computer. Nothing is
  spent.
- **Queued at the provider:** Higgsfield and fal.ai let a queued job be cancelled, and Lepton does that.
- **Already generating:** too late. The provider finishes the job, the result arrives as usual, and the button goes back
  to showing progress. Kie.ai, Google and OpenAI cannot recall a job at all once it has been sent.

Stopping a text run (an LLM node) ignores the answer and keeps the output the node already had; the provider
had the request, so it may still be charged. A run stopped in time leaves no error on the node, and the results it
showed before the run are put back.

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
- `uploads/` — a temporary folder: files you drop onto the board and new results wait here until a project is saved,
  plus small caches of the links providers were given for them (git-ignored). See Storage.
- `.cache/` — model parameter tables, fal.ai model descriptions, the job registry, the list of files each browser's
  board is using, temporary zips, and `thumbs/`, the small copies of pictures and still frames of videos that the
  board shows (git-ignored, safe to delete; copies not shown for 60 days are removed on their own).
- Browser local storage — the board itself and a cache of the model catalogue.

## Layout

```
server.js              zero-dependency local server: routes, job registry, projects, skills, zip download
storage.js             storage housekeeping: sizes, clean-up, JPEG storage, archives, the 30-day trash
thumbs.js              the cache of small picture copies and video still frames the board shows
providers/             one module per provider (anthropic, google, openai, higgsfield, kie, fal) plus common.js helpers
public/index.html      app shell
public/styles.css      theme
public/js/             state, canvas, nodes, groups, grouptabs (the group tabs), projects, storage, tools (select, scissors, pen),
                       annotate (notes, titles), markup (draw on an image), crop, editor (large text editor),
                       thumbs (small copies and video stills),
                       mentions, compare, clipboard, skills, history, textbox,
                       dialog, download, split, models, run engine, UI,
                       snap (lining up and the grid),
                       links (Link in and Link out), combine (join texts into one)
public/catalog-api.json  fallback model catalogue
Start Lepton.command   Mac launcher   ·   Start Lepton.bat   Windows launcher
RELEASE-NOTES.md       what each version added
```
