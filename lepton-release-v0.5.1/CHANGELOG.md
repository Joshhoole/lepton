# Changelog

## 0.5.1 — 2026-10-23

- Save prompt: opening another project, creating a new one, importing a board or closing the tab with unsaved project changes now asks Save / Don't save / Cancel instead of refusing or losing work.
- Text boxes (prompts, LLM system / instruction / output, template sections) can be pulled taller by their bottom-right corner; the height is saved with the board, and double-clicking the corner returns the box to fitting its text.
- Kie.ai provider: one key for Nano Banana, Seedream, GPT Image, Flux, Seedance, Kling, Grok Imagine, Wan, Hailuo and Topaz upscalers; extra model ids can be added in Settings.
- fal.ai provider: Nano Banana, Flux, Seedream, Veo, Kling, Seedance, Hailuo, Wan, LTX and Topaz upscaling, with controls and ports read from fal's own model descriptions; any model id can be added in Settings.

## 0.5.0 — 2026-10-09

- Undo: ⌘Z puts back a moved, nudged or resized node (⇧⌘Z redoes). Only layout is undone, never results.
- Fixed: pressing Space after clicking a button (Generate, a dock button, a status pill) pressed that button again; buttons now hand focus back to the board and Space only pans.
- Skills sidebar: equal-height rows with the full name, no descriptions, install buttons pinned above the list, a button to open the skills folder. Fixed: Skill nodes showed "Not installed" for a moment after a reload (the list had not arrived yet), which made them look disconnected.
- Fixed: Higgsfield models whose documentation table leaves out the file input (Soul 2 · Image to image, Genjutsu Restyle) now get their image and video ports; inputs are also read from each model page's code sample.
- Auto aspect ratio now follows the prompt first (a stated ratio or shape word), then a connected image; the option is simply called "Auto".

## 0.4.0 — 2026-10-07

- Multi-connect: drag a strand from one of several selected nodes and all of them connect (one strand each) when the input takes several.
- Collapsible groups: fold a group into a card with proxy ports; connections attach to the card, strands from it pick the inside node, click to open.
- Skills: install folders of knowledge (SKILL.md + reference files) from a .zip, .md or folder; Skill nodes feed LLM nodes through a Skills input; sidebar with install, edit, add files, update and remove; skills folder in Settings.

## 0.3.1 — 2026-10-06

- Fixed: images, video and audio that had been saved into a project folder failed as inputs with "This input has no file". Project media is now read like any other upload.

## 0.3.0 — 2026-09-29

- Compare node: two images or videos under a slider, side by side, overlaid or as a difference, with synced video playback.
- Resizable Media, Preview and Compare nodes (drag a corner; double-click to reset), with a minimum size measured from each node's controls.
- Copy, cut, paste (⌘C / ⌘X / ⌘V, ⇧⌘V keeps connections), ⌘ or ⌥ + drag to duplicate, arrow keys to nudge, paste text as a Prompt node.
- Mentions: type `@` in a prompt to refer to a connected image (`@image 1`); numbered thumbnail strip on nodes, tags follow their image when connections change, and generation stops early if a mention points at nothing.
- Multi-download: select several nodes and download all their media as one .zip (top bar, right-click menu, ⇧⌘D).

## 0.2.0 — 2026-09-26

- Renamed to Lepton (ℓ). Config file is now `.lepton.json` and the default projects folder `~/Documents/Lepton Projects`; existing settings and boards are migrated automatically.
- Projects: save boards to self-contained folders (project.json + media/), Projects sidebar, ⌘S / ⇧⌘S / ⌘O.
- Prompt batch node, groups with sidebar, auto aspect ratio, refresh-safe jobs.
- Generation history on Image and Video nodes: past runs are kept, restorable and deletable per run or per result.
- Performance: fixed a per-frame style recalculation that made panning large boards lag; flat node surfaces; zoom-adaptive grid.

## 0.1.0 — 2026-09-23

First checkpoint.

- Node canvas: Prompt, Image, Video, LLM (system prompt + instruction), Prompt batch, Preview, Media (image / video / audio).
- Providers with your own keys: Higgsfield, Google Gemini (Nano Banana, Veo), OpenAI (GPT Image, Sora), Anthropic (Claude). Live model lists, schema-driven controls, one entry per model.
- Refresh-safe jobs: every generation and LLM run is tracked by the local server and resumes after a reload.
- Groups with labels and colours, Groups sidebar with jump-to, drop-onto-connection splicing, Auto aspect ratio from the prompt.
