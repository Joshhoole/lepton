# Changelog

## 0.6.0 — 2026-11-07

- **Audio in, audio ports.** Dropping or pasting a WAV, MP3, M4A, OGG, AAC, FLAC or AIFF file makes an audio Media node (some audio files arrive with no type and were being ignored). Video models that take audio, such as Seedance 2.0 and 2.5 on Higgsfield and Kie.ai, show an "Audio refs" port; the clip is sent as the model's audio reference and gets an "A1" chip you can mention in the prompt.
- **Prompt batch → one generator.** The batch node has a single "All prompts" port in its header. Connect it to an Image or Video node and that one node runs every prompt at once with the same settings, one result per prompt (the Generate button shows ×N). Other text connected alongside goes in front of each prompt. The per-prompt ports are still there on each row.
- **Preview handles many results.** More than four items show as small numbered tiles; click one to look at it large with the rest in a strip underneath, and use the buttons to enlarge, pop it out as its own node, or download it.
- **Peek at what a strand carries.** Hover a connected-image chip, a linked prompt (or a row of a linked Prompt batch), or an input port with something plugged in, and a card beside the node shows the image or clip large, the full text, or the list of what is connected.
- **Reorder connected images.** Drag a chip along the row of connected images to change which is 1, 2, 3; the model receives them in that order and the @ tags in the prompt keep pointing at the same images.
- **Show in folder.** Every result thumbnail, Preview item, Media node and the enlarged view has a folder button that reveals the file in Finder (or Explorer), so there is no need to download what is already on disk. A result still sitting on the provider's server is saved first, into the open project's media folder or else the uploads folder, and the board switches to that copy.
- **Prompt length warning.** Kling models take at most 2,500 characters and answer anything longer with "The text length cannot exceed the maximum limit". Image and Video nodes on such a model show a counter under the prompt as it nears the cap, turn it red when over and say by how many characters to cut (with a Prompt batch connected, the longest prompt counts). Generate refuses before anything is spent, and a limit the provider reports itself (Higgsfield pages, fal schemas) is read the same way.
- **Pop a prompt out.** Hover a row in a Prompt batch and click the pop-out button to get that prompt as its own Prompt node, text already in place.
- Skills install from `.skill` files too (they are zip archives by another name): drop one on the canvas or pick it with Install…, same as a .zip.
- Fixed: clicking a result in a Preview with many items scrolled the canvas itself, so the camera jumped and the pointer no longer lined up with the board. Only the strip scrolls now, and the canvas undoes any stray browser scroll.
- Fixed: Kling 4.0 on Higgsfield failed with "image_url is a required property" when images were connected to References. The model page marks reference inputs as "Conditional", which the docs reader skipped, so the request went to image-to-video without a start frame. Conditional inputs are read now; an image-to-video endpoint given only references uses the first as its start frame; and a request missing a required input is refused with a message naming the port instead of the provider's error.

## 0.5.1 — 2026-10-23

- Undo now covers connections: ⌘Z removes a strand you just connected or restores one you disconnected (a multi-connect undoes as one step).
- Connected-image thumbnails on a node have an × to disconnect that image directly.
- The model picker opens beside the node rather than over it.
- Model picker: a two-column menu (providers, then models grouped by family) with search and a "Latest only" switch that hides superseded versions, replacing the long dropdown.
- Kie.ai: Kling 4.0 pages are read correctly now. Higgsfield: controls are read from a model page's code sample when its table leaves them out (Kling 4.0).
- Kie.ai: the whole catalogue (about 145 image and video models) is read from Kie's documentation once a day, so every model appears in the dropdowns; curated models keep their hand-made controls.
- Fixed: Kling 3.0 and Kling 3.0 Omni on Kie.ai failed with "multi_shots cannot be empty"; the single-shot flag is now sent.
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
