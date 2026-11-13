// Kie.ai: one key for many models (Nano Banana, Seedream, GPT Image, Flux, Seedance, Kling, Grok Imagine, Wan, Hailuo,
// Topaz upscalers, ElevenLabs speech…). Every model goes through the same createTask / recordInfo pair; only the input
// fields differ, so the models below carry their own field map. Ids not in the table still work with a generic set of fields.
const fs = require('fs');
const path = require('path');
const { ROOT, fetchJson, localFile, ApiError, mimeOf, P, promptLimit } = require('./common.js');

// KIE_API and KIE_UPLOAD point these at a stand-in server when testing without spending credits.
const BASE = (process.env.KIE_API || 'https://api.kie.ai/api/v1').replace(/\/$/, '');
const UPLOAD = process.env.KIE_UPLOAD || 'https://kieai.redpandaai.co/api/file-stream-upload';
const PREFIX = 'kie:';
const URL_CACHE = path.join(ROOT, 'uploads', '.kie-urls.json');
const UPLOAD_TTL = 20 * 3600 * 1000; // Kie keeps uploads for 24 h

const AR_IMG = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
const AR_VID = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

// ---- speech: ElevenLabs through Kie ----
// The voices Kie offers for ElevenLabs (docs.kie.ai/market/elevenlabs, read 2026-11-11): "id|Name - character".
// Each has a sample at static.aiquickdraw.com/elevenlabs/voice/<id>.mp3, which the Voice control plays.
const VOICES = [
  "EkK5I93UQWFDigLMpZcX|James - Husky, Engaging and Bold",
  "Z3R5wn05IrDiVCyEkUrK|Arabella - Mysterious and Emotive",
  "NNl6r8mD7vthiJatiJt1|Bradford - Expressive and Articulate",
  "YOq2y2Up4RgXP2HyXjE5|Xavier - Dominating, Metallic Announcer",
  "B8gJV1IhpuegLxdpXFOE|Kuon - Cheerful, Clear and Steady",
  "2zRM7PkgwBPiau2jvVXc|Monika Sogam - Deep and Natural",
  "1SM7GgM6IMuvQlz2BwM3|Mark - Casual, Relaxed and Light",
  "5l5f8iK3YPeGga21rQIX|Adeline - Feminine and Conversational",
  "scOwDtmlUjD3prqpp97I|Sam - Support Agent",
  "NOpBlnGInO9m6vDvFkFC|Spuds Oxley - Wise and Approachable",
  "BZgkqPqms7Kj9ulSkVzn|Eve - Authentic, Energetic and Happy",
  "wo6udizrrtpIxWGp2qJk|Northern Terry",
  "gU0LNdkMOQCOrPrwtbee|British Football Announcer",
  "DGzg6RaUqxGRTHSBjfgF|Brock - Commanding and Loud Sergeant",
  "x70vRnQBMBu4FAYhjJbO|Nathan - Virtual Radio Host",
  "Sm1seazb4gs7RSlUVw7c|Anika - Animated, Friendly and Engaging",
  "P1bg08DkjqiVEzOn76yG|Viraj - Rich and Soft",
  "qDuRKMlYmrm8trt5QyBn|Taksh - Calm, Serious and Smooth",
  "qXpMhyvQqiRxWQs4qSSB|Horatius - Energetic Character Voice",
  "TX3LPaxmHKxFdv7VOQHJ|Liam - Energetic, Social Media Creator",
  "N2lVS1w4EtoT3dr4eOWO|Callum - Husky Trickster",
  "FGY2WhTYpPnrIDTdsKH5|Laura - Enthusiast, Quirky Attitude",
  "kPzsL2i3teMYv0FxEYQ6|Brittney - Social Media Voice - Fun, Youthful & Informative",
  "UgBBYS2sOqTuMpoF3BR0|Mark - Natural Conversations",
  "hpp4J3VqNfWAUOO0d1Us|Bella - Professional, Bright, Warm",
  "nPczCjzI2devNBz1zQrb|Brian - Deep, Resonant and Comforting",
  "uYXf8XasLslADfZ2MB4u|Hope - Bubbly, Gossipy and Girly",
  "gs0tAILXbY5DNrJrsM6F|Jeff - Classy, Resonating and Strong",
  "DTKMou8ccj1ZaWGBiotd|Jamahal - Young, Vibrant, and Natural",
  "vBKc2FfBKJfcZNyEt1n6|Finn - Youthful, Eager and Energetic",
  "DYkrAHD8iwork3YSUBbs|Tom - Conversations & Books",
  "56AoDkrOh6qfVPDXZ7Pt|Cassidy - Crisp, Direct and Clear",
  "eR40ATw9ArzDf9h3v7t7|Addison 2.0 - Australian Audiobook & Podcast",
  "g6xIsTj2HwM6VR4iXFCw|Jessica Anne Bogart - Chatty and Friendly",
  "lcMyyd2HUfFzxdCaC4Ta|Lucy - Fresh & Casual",
  "6aDn1KB0hjpdcocrUkmq|Tiffany - Natural and Welcoming",
  "Sq93GQT4X1lKDXsQcixO|Felix - Warm, Positive & Contemporary RP",
  "flHkNRp1BlvT73UL6gyz|Jessica Anne Bogart - Eloquent Villain",
  "9yzdeviXkFddZ4Oz8Mok|Lutz - Chuckling, Giggly and Cheerful",
  "pPdl9cQBQq4p6mRkZy2Z|Emma - Adorable and Upbeat",
  "zYcjlYFOd3taleS0gkk3|Edward - Loud, Confident and Cocky",
  "nzeAacJi50IvxcyDnMXa|Marshal - Friendly, Funny Professor",
  "ruirxsoakN0GWmGNIo04|John Morgan - Gritty, Rugged Cowboy",
  "TC0Zp7WVFzhA8zpTlRqV|Aria - Sultry Villain",
  "ljo9gAlSqKOvF6D8sOsX|Viking Bjorn - Epic Medieval Raider",
  "PPzYpIqttlTYA83688JI|Pirate Marshal",
  "8JVbfL6oEdmuxKn5DK2C|Johnny Kid - Serious and Calm Narrator",
  "iCrDUkL56s3C8sCRl7wb|Hope - Poetic, Romantic and Captivating",
  "wJqPPQ618aTW29mptyoc|Ana Rita - Smooth, Expressive and Bright",
  "EiNlNiXeDU1pqqOPrYMO|John Doe - Deep",
  "4YYIPFl9wE5c4L2eu2Gb|Burt Reynolds™ - Deep, Smooth and Clear",
  "6F5Zhi321D3Oq7v1oNT4|Hank - Deep and Engaging Narrator",
  "YXpFCvM1S3JbWEJhoskW|Wyatt - Wise Rustic Cowboy",
  "LG95yZDEHg6fCZdQjLqj|Phil - Explosive, Passionate Announcer",
  "CeNX9CMwmxDxUF5Q2Inm|Johnny Dynamite - Vintage Radio DJ",
  "aD6riP1btT197c6dACmy|Rachel M - Pro British Radio Presenter",
  "mtrellq69YZsNwzUSyXh|Rex Thunder - Deep N Tough",
  "dHd5gvgSOzSfduK4CvEg|Ed - Late Night Announcer",
  "eVItLK1UvXctxuaRV2Oq|Jean - Alluring and Playful Femme Fatale",
  "esy0r39YPLQjOczyOib8|Britney - Calm and Calculative Villain",
  "Tsns2HvNFKfGiNjllgqo|Sven - Emotional and Nice",
  "1U02n4nD6AdIZ9CjF053|Viraj - Smooth and Gentle",
  "AeRdCCKzvd23BpJoofzx|Nathaniel - Engaging, British and Calm",
  "LruHrtVF6PSyGItzMNHS|Benjamin - Deep, Warm, Calming",
  "1wGbFxmAM3Fgw63G1zZJ|Allison - Calm, Soothing and Meditative",
  "hqfrgApggtO1785R4Fsn|Theodore HQ - Serene and Grounded",
  "MJ0RnG71ty4LH3dvNfSd|Leon - Soothing and Grounded",
].map((v) => { const [id, label] = v.split('|'); const [name, ...rest] = label.split(' - '); return { id, name: name.trim(), about: rest.join(' - ').trim() }; });
const VOICE_PREVIEW = 'https://static.aiquickdraw.com/elevenlabs/voice/{value}.mp3';
const voiceParam = () => P('voice', 'string', VOICES[0].id, VOICES.map((v) => v.id), {
  labels: Object.fromEntries(VOICES.map((v) => [v.id, v.about ? `${v.name} · ${v.about}` : v.name])), preview: VOICE_PREVIEW,
});
// Gemini's speech voices on Kie (docs.kie.ai/market/google/gemini-3-8-flash-tts, read 2026-11-13), by what each suits.
const GEMINI_VOICES = [
  ['Tutor', 'Bodi Lumi Sadaltager Sola Sulafat Varo Zephyr'],
  ['Commercial voiceover', 'Koda Kore Nika Tavi Zeno'],
  ['Instructional', 'Algenib Despina Erinome Kira Ludo Mako Rasalgethi Rina'],
  ['Podcast', 'Alnilam Brio Jori Laomedeia Rami Veda'],
  ['Storyteller', 'Achird Enzo Riko Sami Zali Zubenelgenubi'],
  ['Digital assistant', 'Algieba Aoede Autonoe Callirrhoe Enceladus Gero Iapetus Neno Olin Tari Umbriel'],
  ['Call centre', 'Achernar Charon Daro Fola Hali Milo Puck'],
  ['Concierge', 'Arlo Cleo Fenrir Finn Leda Lora Orus'],
  ['Tech support', 'Enya Jett Knox Nyla Sadachbia Vindemiatrix'],
  ['Professional', 'Cruz Elio Gacrux Pulcherrima Schedar Tova Zuri'],
].flatMap(([about, names]) => names.split(' ').map((name) => ({ id: name, name, about })));
const geminiVoiceParam = () => P('voice', 'string', 'Fola', GEMINI_VOICES.map((v) => v.id).sort(), { labels: Object.fromEntries(GEMINI_VOICES.map((v) => [v.id, `${v.name} · ${v.about}`])) });
const unit = (name, def, min = 0, max = 1) => P(name, 'number', def, null, { min, max, step: 0.01 });
const LANG_NAMES = {
  af: 'Afrikaans', ar: 'Arabic', hy: 'Armenian', as: 'Assamese', az: 'Azerbaijani', be: 'Belarusian', bn: 'Bengali', bs: 'Bosnian', bg: 'Bulgarian', ca: 'Catalan',
  ceb: 'Cebuano', ny: 'Chichewa', hr: 'Croatian', cs: 'Czech', da: 'Danish', nl: 'Dutch', en: 'English', et: 'Estonian', fil: 'Filipino', fi: 'Finnish', fr: 'French',
  gl: 'Galician', ka: 'Georgian', de: 'German', el: 'Greek', gu: 'Gujarati', ha: 'Hausa', he: 'Hebrew', hi: 'Hindi', hu: 'Hungarian', is: 'Icelandic', id: 'Indonesian',
  ga: 'Irish', it: 'Italian', ja: 'Japanese', jv: 'Javanese', kn: 'Kannada', kk: 'Kazakh', ky: 'Kyrgyz', ko: 'Korean', lv: 'Latvian', ln: 'Lingala', lt: 'Lithuanian',
  lb: 'Luxembourgish', mk: 'Macedonian', ms: 'Malay', ml: 'Malayalam', zh: 'Chinese', mr: 'Marathi', ne: 'Nepali', no: 'Norwegian', ps: 'Pashto', fa: 'Persian',
  pl: 'Polish', pt: 'Portuguese', pa: 'Punjabi', ro: 'Romanian', ru: 'Russian', sr: 'Serbian', sd: 'Sindhi', sk: 'Slovak', sl: 'Slovenian', so: 'Somali', es: 'Spanish',
  sw: 'Swahili', sv: 'Swedish', ta: 'Tamil', te: 'Telugu', th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', vi: 'Vietnamese', cy: 'Welsh',
};
// The languages Turbo v2.5 can be held to (ElevenLabs' list for that model); v3 takes every code above.
const TURBO_LANGS = ['en', 'ja', 'zh', 'de', 'hi', 'fr', 'ko', 'pt', 'it', 'es', 'id', 'nl', 'tr', 'fil', 'pl', 'sv', 'bg', 'ro', 'ar', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'ru', 'hu', 'no', 'vi'];
const langParam = (codes) => { const sorted = [...codes].sort((a, b) => LANG_NAMES[a].localeCompare(LANG_NAMES[b])); return P('language_code', 'string', '', ['', ...sorted], { labels: { '': 'Auto', ...Object.fromEntries(sorted.map((c) => [c, LANG_NAMES[c]])) } }); };
const SPEECH_MAX = 5000; // characters per request, every ElevenLabs model on Kie
// A script for several voices. "James: Good evening." starts James speaking; a line with no name carries on in the
// voice before it, and the first lines use the voice chosen on the node. A name is a voice's name, first name or id.
function dialogueOf(text, fallback, voices = VOICES) {
  const byName = new Map();
  for (const v of voices) for (const k of [v.id, v.name, v.name.split(' ')[0]]) { const key = k.toLowerCase(); if (!byName.has(key)) byName.set(key, v.id); }
  const out = []; let voice = fallback || voices[0].id;
  for (const raw of String(text || '').split(/\n+/)) {
    let line = raw.trim(); if (!line) continue;
    const m = /^([A-Za-z0-9][^:\n]{0,40}?)\s*:\s*(.*)$/.exec(line);
    const id = m && byName.get(m[1].trim().toLowerCase());
    if (id) { voice = id; line = m[2].trim(); if (!line) continue; out.push({ text: line, voice }); continue; }
    const last = out[out.length - 1];
    if (last && last.voice === voice) last.text += `\n${line}`; else out.push({ text: line, voice });
  }
  return out;
}

// in: our port roles → the model's field; multi fields take arrays. extra: parameters beyond the prompt.
// fixed: fields the API insists on receiving even though the node has no control for them. asString: numbers the API wants quoted.
const M = {
  // ---- images ----
  'nano-banana-pro': { name: 'Nano Banana Pro', type: 'image', in: { image: ['image_input', 8] }, extra: () => [P('aspect_ratio', 'string', 'auto', AR_IMG), P('resolution', 'string', '1K', ['1K', '2K', '4K']), P('output_format', 'string', 'png', ['png', 'jpg'])] },
  'nano-banana-2': { name: 'Nano Banana 2', type: 'image', in: { image: ['image_input', 8] }, extra: () => [P('aspect_ratio', 'string', 'auto', AR_IMG), P('resolution', 'string', '1K', ['1K', '2K', '4K']), P('output_format', 'string', 'png', ['png', 'jpg'])] },
  'nano-banana-2-1': { name: 'Nano Banana 2.1', type: 'image', in: { image: ['image_input', 8] }, extra: () => [P('aspect_ratio', 'string', 'auto', AR_IMG), P('resolution', 'string', '1K', ['1K', '2K', '4K']), P('output_format', 'string', 'png', ['png', 'jpg'])] },
  'seedream/4.5-text-to-image': { name: 'Seedream 4.5 · Text to image', type: 'image', in: {}, extra: () => [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1)), P('quality', 'string', 'basic', ['basic', 'high'])] },
  'seedream/4.5-edit': { name: 'Seedream 4.5 · Edit', type: 'image', in: { image: ['image_urls', 10] }, extra: () => [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1)), P('quality', 'string', 'basic', ['basic', 'high'])] },
  'seedream/5-pro-text-to-image': { name: 'Seedream 5 Pro · Text to image', type: 'image', in: {}, extra: () => [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1)), P('quality', 'string', 'basic', ['basic', 'high']), P('output_format', 'string', 'png', ['png', 'jpg'])] },
  'seedream/5-pro-image-to-image': { name: 'Seedream 5 Pro · Image to image', type: 'image', in: { image: ['image_urls', 10] }, extra: () => [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1)), P('quality', 'string', 'basic', ['basic', 'high']), P('output_format', 'string', 'png', ['png', 'jpg'])] },
  'gpt-image-2-text-to-image': { name: 'GPT Image 2 · Text to image', type: 'image', in: {}, extra: () => [P('aspect_ratio', 'string', 'auto', ['auto', '1:1', '16:9', '9:16', '3:2', '2:3'])] },
  'gpt-image-2-image-to-image': { name: 'GPT Image 2 · Image to image', type: 'image', in: { image: ['input_urls', 8] }, extra: () => [P('aspect_ratio', 'string', 'auto', ['auto', '1:1', '16:9', '9:16', '3:2', '2:3'])] },
  'flux-2/pro-text-to-image': { name: 'Flux 2 Pro · Text to image', type: 'image', in: {}, extra: () => [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1)), P('resolution', 'string', '1K', ['1K', '2K'])] },
  'flux-2/pro-image-to-image': { name: 'Flux 2 Pro · Image to image', type: 'image', in: { image: ['input_urls', 8] }, extra: () => [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1)), P('resolution', 'string', '1K', ['1K', '2K'])] },
  'topaz/image-upscale': { name: 'Topaz · Image upscale', type: 'image', noPrompt: true, in: { image: ['image_url', 1] }, extra: () => [P('upscale_factor', 'string', '2', ['2', '4'])] },
  // ---- video ----
  // Lengths and sizes as Kie documents them (docs.kie.ai/market/bytedance, read 2026-11-12): Seedance 2.0 and 2.0 Fast make
  // 4 to 15 seconds, Seedance 2.5 makes 4 to 30. Fast stops at 720p.
  'bytedance/seedance-2': { name: 'Seedance 2.0', type: 'video', in: { image: ['reference_image_urls', 9], video: ['reference_video_urls', 3], audio: ['reference_audio_urls', 3] }, fixed: { return_last_frame: false, web_search: false }, extra: () => [P('aspect_ratio', 'string', '16:9', [...AR_VID, 'adaptive']), P('resolution', 'string', '720p', ['480p', '720p', '1080p']), P('duration', 'integer', 5, null, { min: 4, max: 15 }), P('generate_audio', 'boolean', false)] },
  'bytedance/seedance-2-5': { name: 'Seedance 2.5', type: 'video', in: { image: ['reference_image_urls', 9], video: ['reference_video_urls', 3], audio: ['reference_audio_urls', 3] }, fixed: { return_last_frame: false, web_search: false }, extra: () => [P('aspect_ratio', 'string', '16:9', [...AR_VID, 'adaptive']), P('resolution', 'string', '720p', ['480p', '720p', '1080p']), P('duration', 'integer', 5, null, { min: 4, max: 30 }), P('generate_audio', 'boolean', false)] },
  'bytedance/seedance-2-fast': { name: 'Seedance 2.0 Fast', type: 'video', in: { image: ['reference_image_urls', 9], video: ['reference_video_urls', 3], audio: ['reference_audio_urls', 3] }, fixed: { return_last_frame: false, web_search: false }, extra: () => [P('aspect_ratio', 'string', '16:9', [...AR_VID, 'adaptive']), P('resolution', 'string', '720p', ['480p', '720p']), P('duration', 'integer', 5, null, { min: 4, max: 15 }), P('generate_audio', 'boolean', false)] },
  'kling-3.0/video': { name: 'Kling 3.0', type: 'video', in: { frames: ['image_urls', 2] }, fixed: { multi_shots: false }, asString: ['duration'], extra: () => [P('aspect_ratio', 'string', '16:9', ['16:9', '9:16', '1:1']), P('mode', 'string', 'std', ['std', 'pro', '4K']), P('duration', 'integer', 5, null, { min: 3, max: 15 }), P('sound', 'boolean', false)] },
  'kling-3.0-omni/text-to-video': { name: 'Kling 3.0 Omni · Text to video', type: 'video', in: {}, fixed: { customize_multi_shots: false }, extra: () => [P('aspect_ratio', 'string', '16:9', ['16:9', '9:16', '1:1']), P('resolution', 'string', '720p', ['720p', '1080p', '4K']), P('duration', 'integer', 5, null, { min: 3, max: 15 }), P('audio', 'boolean', false)] },
  'kling-3.0-omni/image-to-video': { name: 'Kling 3.0 Omni · Image to video', type: 'video', in: { frames: ['image_urls', 2] }, fixed: { customize_multi_shots: false }, extra: () => [P('aspect_ratio', 'string', 'auto', ['auto', '16:9', '9:16', '1:1']), P('resolution', 'string', '720p', ['720p', '1080p', '4K']), P('duration', 'integer', 5, null, { min: 3, max: 15 }), P('audio', 'boolean', false)] },
  'grok-imagine/text-to-video': { name: 'Grok Imagine · Text to video', type: 'video', in: {}, extra: () => [P('aspect_ratio', 'string', '16:9', ['16:9', '9:16', '1:1', '3:2', '2:3']), P('resolution', 'string', '480p', ['480p', '720p']), P('duration', 'string', '6', ['6', '10']), P('mode', 'string', 'normal', ['normal', 'fun', 'spicy'])] },
  'grok-imagine/image-to-video': { name: 'Grok Imagine · Image to video', type: 'video', in: { start: ['image_urls', 1] }, extra: () => [P('aspect_ratio', 'string', '16:9', ['16:9', '9:16', '1:1', '3:2', '2:3']), P('resolution', 'string', '480p', ['480p', '720p']), P('duration', 'string', '6', ['6', '10']), P('mode', 'string', 'normal', ['normal', 'fun', 'spicy'])] },
  'wan/2-7-text-to-video': { name: 'Wan 2.7 · Text to video', type: 'video', in: {}, extra: () => [P('ratio', 'string', '16:9', ['16:9', '9:16', '1:1']), P('resolution', 'string', '720p', ['720p', '1080p']), P('duration', 'integer', 5, [5, 10]), P('negative_prompt', 'string', null), P('seed', 'integer', null)] },
  'wan/2-7-image-to-video': { name: 'Wan 2.7 · Image to video', type: 'video', in: { start: ['first_frame_url', 1], end: ['last_frame_url', 1] }, extra: () => [P('resolution', 'string', '720p', ['720p', '1080p']), P('duration', 'integer', 5, [5, 10]), P('negative_prompt', 'string', null), P('seed', 'integer', null)] },
  'hailuo/2-3-image-to-video-pro': { name: 'Hailuo 2.3 Pro · Image to video', type: 'video', in: { start: ['image_url', 1] }, extra: () => [P('duration', 'string', '6', ['6', '10']), P('resolution', 'string', '768P', ['768P', '1080P'])] },
  'hailuo/2-3-image-to-video-standard': { name: 'Hailuo 2.3 Standard · Image to video', type: 'video', in: { start: ['image_url', 1] }, extra: () => [P('duration', 'string', '6', ['6', '10']), P('resolution', 'string', '768P', ['768P', '1080P'])] },
  'topaz/video-upscale': { name: 'Topaz · Video upscale', type: 'video', noPrompt: true, in: { video: ['video_url', 1] }, extra: () => [P('upscale_factor', 'string', '2', ['2', '4'])] },
  // ---- audio ----
  // promptField: where the node's text goes. promptMax: the model's own cap. note: shown on the node under the model.
  'elevenlabs/text-to-speech-multilingual-v2': { name: 'ElevenLabs · Multilingual v2', type: 'audio', promptField: 'text', promptMax: SPEECH_MAX, in: {},
    note: 'Speaks the text in the chosen voice. The most natural of the two speech models; it works out the language from the text.',
    extra: () => [voiceParam(), unit('stability', 0.5), unit('similarity_boost', 0.75), unit('style', 0), unit('speed', 1, 0.7, 1.2)] },
  'elevenlabs/text-to-speech-turbo-2-5': { name: 'ElevenLabs · Turbo v2.5', type: 'audio', promptField: 'text', promptMax: SPEECH_MAX, in: {},
    note: 'Speaks the text in the chosen voice. Faster and cheaper than Multilingual v2, and it can be held to one language.',
    extra: () => [voiceParam(), unit('stability', 0.5), unit('similarity_boost', 0.75), unit('style', 0), unit('speed', 1, 0.7, 1.2), langParam(TURBO_LANGS)] },
  'elevenlabs/text-to-dialogue-v3': { name: 'ElevenLabs · Dialogue v3', type: 'audio', dialogue: true, promptMax: SPEECH_MAX, in: {},
    note: 'A conversation in one take. Start a line with a voice name and a colon to change speaker, like "James: Good evening." Other lines keep the last voice, starting with the one chosen here. [whispers] and [laughs] are acted.',
    extra: () => [voiceParam(), P('stability', 'number', 0.5, [0, 0.5, 1], { labels: { 0: 'Creative', 0.5: 'Natural', 1: 'Robust' } }), langParam(Object.keys(LANG_NAMES))] },
  // Gemini speech: one voice, or two in conversation. The request is a list of speakers and a list of turns.
  'google/gemini-3-8-flash-tts': { name: 'Gemini 3.8 Flash · Speech', type: 'audio', turns: true, promptMax: SPEECH_MAX, in: {},
    note: 'Speaks the text in the chosen voice. For two voices, start a line with a voice name and a colon, like "Zephyr: Good evening." Sounds in angle brackets are acted: <laugh>, <sigh>, <whispers>, <short pause>.',
    extra: () => [geminiVoiceParam(), P('temperature', 'number', 1, null, { min: 0, max: 2, step: 0.05 })] },
  'google/gemini-3-8-flash-lite-tts': { name: 'Gemini 3.8 Flash Lite · Speech', type: 'audio', turns: true, promptMax: SPEECH_MAX, in: {},
    note: 'The quicker, cheaper Gemini voice. For two voices, start a line with a voice name and a colon, like "Zephyr: Good evening." Sounds in angle brackets are acted: <laugh>, <sigh>, <whispers>, <short pause>.',
    extra: () => [geminiVoiceParam(), P('temperature', 'number', 1, null, { min: 0, max: 2, step: 0.05 })] },
  'elevenlabs/audio-isolation': { name: 'ElevenLabs · Voice isolation', type: 'audio', noPrompt: true, in: { audio: ['audio_url', 1] }, requires: ['audio'],
    note: 'Takes a recording and gives back the voice on its own, with music and background noise removed. Connect an audio file of up to 10 MB.',
    extra: () => [] },
};
// Anything else the user lists: prompt, references, and the common fields; the API says what it does not accept.
const generic = (id) => ({
  name: id.replace(/[-_/]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), type: /video|v2v|i2v|t2v|animate|motion/i.test(id) ? 'video' : 'image',
  in: { image: ['image_urls', 8] }, extra: () => (/video|v2v|i2v|t2v/i.test(id) ? [P('aspect_ratio', 'string', '16:9', AR_VID), P('resolution', 'string', '720p', ['480p', '720p', '1080p']), P('duration', 'integer', 5, null, { min: 2, max: 15 })] : [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1))]),
});


// ---------- the whole Kie.ai catalogue, read from its documentation ----------
// Kie publishes one page per model with an example request. Those pages are read once a day and turned into models,
// so everything Kie offers appears in the dropdowns, not just the curated table above. Text and music models are left
// out, and speech is not read from the pages: the ElevenLabs models are in the table above, with their voices.
const DOCS = 'https://docs.kie.ai';
const CATALOG_CACHE = path.join(ROOT, '.cache', 'kie-catalog.json');
const CATALOG_TTL = 24 * 3600 * 1000;
const SKIP_CATEGORY = /^(quickstart|common|chat|claude|gemini|grok|codex|kimi|deepseek[-\w]*|elevenlabs|gemini-omni-audio|gemini-omni-character)$/;
const SKIP_PATH = /-tts$|text-to-speech|text-to-dialogue|audio-isolation|-openai$|human-identification|subject-detection|segment-map|layer-decomposition|video-to-video-lip-sync/;
const VIDEO_HINT = /video|animate|motion|extend|transition|omnihuman|infinitalk|lip-sync|avatar|r2v|i2v|t2v|v2v|seedance|kling|hailuo|happyhorse|pixverse|vidu|minimax-h3|wan\/|ltx/i;
const ENUMS = {
  aspect_ratio: AR_IMG, ratio: AR_VID, resolution: ['480p', '720p', '1080p', '2K', '4K'], quality: ['basic', 'high'],
  mode: ['std', 'pro', 'normal', 'fun', 'spicy'], output_format: ['png', 'jpg', 'jpeg', 'webp'], upscale_factor: ['2', '4'],
};
const FIXED_FALSE = new Set(['multi_shots', 'customize_multi_shots', 'return_last_frame', 'web_search', 'nsfw_checker']);
const ROLE_OF = {
  image_urls: ['image', true], image_input: ['image', true], input_urls: ['image', true], reference_image_urls: ['image', true], images: ['image', true],
  keyframe_urls: ['image', true], image_url: ['image', false], input_image_url: ['image', false], first_frame_url: ['start', false], start_image_url: ['start', false],
  last_frame_url: ['end', false], end_image_url: ['end', false], tail_image_url: ['end', false],
  video_url: ['video', false], input_video_url: ['video', false], video_urls: ['video', true], reference_video_urls: ['video', true],
  audio_url: ['audio', false], reference_audio_urls: ['audio', true], element_input_audio_urls: ['audio', true],
};
// "Seedream4.5 - Text to Image" → "Seedream 4.5 · Text to image"; "Flux-2 - Pro Image to Image" → "Flux 2 · Pro image to image".
const tidyName = (t) => {
  let n = t.replace(/\s+/g, ' ').trim();
  n = n.replace(/([A-Za-z])-(\d)/g, '$1 $2').replace(/([A-Za-z]{3,})(\d+(?:\.\d+)?)/g, '$1 $2').replace(/(\s\d+)-(\d+)\b/g, '$1.$2');
  n = n.replace(/\s+-\s+/g, ' · ');
  // task phrases read better in sentence case
  n = n.replace(/\b(Text|Image|Video|Reference|Keyframe|Audio|Speech)\s+[Tt]o\s+(Image|Video|Audio)\b/g, (m, a, b) => `${a} to ${b.toLowerCase()}`);
  n = n.replace(/·\s*([a-z])/g, (m, c) => `· ${c.toUpperCase()}`).replace(/\s+/g, ' ').trim();
  return n;
};
let catalog = null, scraping = null;
function readCatalog() { if (catalog) return catalog; try { catalog = JSON.parse(fs.readFileSync(CATALOG_CACHE, 'utf8')); } catch { catalog = { at: 0, models: {} }; } return catalog; }
function writeCatalog() { try { fs.mkdirSync(path.dirname(CATALOG_CACHE), { recursive: true }); fs.writeFileSync(CATALOG_CACHE, JSON.stringify(catalog)); } catch { /* ignore */ } }
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
async function text(url) { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Lepton' }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }
// The pages Kie lists, with their titles.
async function listPages() {
  const html = await text(`${DOCS}/`);
  const out = new Map();
  for (const m of html.matchAll(/<a[^>]+href="(\/market\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = m[1], title = strip(m[2]).trim();
    const cat = href.split('/')[2] || '';
    if (!title || out.has(href) || SKIP_CATEGORY.test(cat) || SKIP_PATH.test(href)) continue;
    out.set(href, title);
  }
  return out;
}
// One page → { id, input example }.
async function readPage(href) {
  const t = strip(await text(`${DOCS}${href}`));
  const m = /--data(?:-raw)? '(\{.*?\})'\s+Response/.exec(t); if (!m) return null;
  let body = m[1].replace(/' \\ '' s/g, "'s");
  let j = null;
  try { j = JSON.parse(body); } catch { /* fall back to a rough read */ }
  if (j) return { id: j.model, input: j.input || {} };
  const id = (/"model":\s*"([^"]+)"/.exec(body) || [])[1]; if (!id) return null;
  const inner = body.split('"input"')[1] || '';
  const input = {}; for (const k of inner.matchAll(/"([a-z_]+)":\s*("([^"]*)"|true|false|-?\d+(?:\.\d+)?|\[)/g)) input[k[1]] = k[3] !== undefined ? k[3] : k[2] === 'true' ? true : k[2] === 'false' ? false : k[2] === '[' ? [] : Number(k[2]);
  return { id, input };
}
// Turn an example request into a model entry: ports from the file fields, controls from the rest.
function fromExample(id, title, input, href) {
  const type = VIDEO_HINT.test(`${id} ${href}`) && !/image-to-image|text-to-image|image-edit|edit$|upscale\/image|image-upscale/.test(`${id} ${href}`) ? 'video' : 'image';
  const spec = { name: tidyName(title), type, in: {}, fixed: {}, asString: [], params: [] };
  for (const [k, v] of Object.entries(input)) {
    if (k === 'prompt' || k === 'callBackUrl') continue;
    if (ROLE_OF[k]) { const [role, multi] = ROLE_OF[k]; spec.in[role] = [k, multi ? 10 : 1]; continue; }
    if (FIXED_FALSE.has(k)) { spec.fixed[k] = false; continue; }
    if (typeof v === 'boolean') spec.params.push(P(k, 'boolean', v));
    else if (typeof v === 'number') spec.params.push(P(k, 'integer', v, null, k === 'duration' ? { min: 2, max: 15 } : { min: 0, max: 100 }));
    else if (typeof v === 'string') {
      if (k === 'negative_prompt' || k === 'seed') continue;
      if (ENUMS[k]) spec.params.push(P(k, 'string', v, [...new Set([...ENUMS[k], v])]));
      else if (k === 'duration') { spec.params.push(P(k, 'string', v, [...new Set(['3', '4', '5', '6', '8', '10', '12', v])])); spec.asString.push(k); }
      else if (/^\d+$/.test(v)) spec.params.push(P(k, 'string', v, [v]));
      else if (/size|style|preset|model_type|variant|format/.test(k)) spec.params.push(P(k, 'string', v, [v]));
      // other free-text fields have no sensible control; they are left out and the API applies its default
    }
    // arrays that are not files (multi_prompt, elements…) are advanced features the node does not expose
  }
  spec.noPrompt = !('prompt' in input);
  spec.extra = () => spec.params;
  return spec;
}
async function scrapeCatalogue() {
  const pages = await listPages();
  const models = {};
  const hrefs = [...pages.keys()];
  const worker = async () => { while (hrefs.length) { const href = hrefs.shift(); try { const r = await readPage(href); if (r && r.id) models[r.id] = { title: pages.get(href), href, input: r.input }; } catch { /* page unavailable */ } } };
  await Promise.all(Array.from({ length: 10 }, worker));
  if (!Object.keys(models).length) throw new Error('No model pages could be read');
  catalog = { at: Date.now(), models }; writeCatalog();
  return catalog;
}
// The catalogue as specs keyed by id, refreshed in the background when it is a day old. First use waits a little.
async function catalogueSpecs() {
  const c = readCatalog();
  const stale = Date.now() - (c.at || 0) > CATALOG_TTL || !Object.keys(c.models || {}).length;
  if (stale && !scraping) scraping = scrapeCatalogue().catch(() => null).finally(() => { scraping = null; });
  if (scraping && !Object.keys(c.models || {}).length) await Promise.race([scraping, new Promise((r) => setTimeout(r, 15000))]);
  const out = {};
  for (const [id, m] of Object.entries(readCatalog().models || {})) { try { out[id] = fromExample(id, m.title, m.input || {}, m.href || ''); } catch { /* skip odd page */ } }
  return out;
}
let specCache = {};
function specFor(id) { return M[id] || specCache[id] || generic(id); }

function parse(key) {
  try { const j = JSON.parse(key); if (j && j.key) return { key: j.key, models: Array.isArray(j.models) ? j.models : [] }; } catch { /* plain key */ }
  return { key: String(key || '').trim(), models: [] };
}
const hdr = (k) => ({ Authorization: `Bearer ${parse(k).key}` });
// Kie answers HTTP 200 with its own code; anything but 200 there is an error.
async function call(key, url, opts = {}) {
  const r = await fetchJson(url, { headers: hdr(key), ...opts });
  if (r && typeof r === 'object' && 'code' in r && Number(r.code) !== 200) throw new ApiError(r.msg || `Kie.ai error ${r.code}`, { code: Number(r.code) === 401 ? 'API_AUTH' : Number(r.code) === 402 ? 'API_CREDITS' : 'API_ERROR' });
  return r;
}

function mediasFor(spec) {
  const out = [];
  for (const [role, [param, max]] of Object.entries(spec.in)) {
    if (role === 'frames') { out.push({ role: 'start_image', param, multi: false }, { role: 'end_image', param, multi: false }); continue; }
    const r = role === 'start' ? 'start_image' : role === 'end' ? 'end_image' : role;
    out.push({ role: r, param, multi: max > 1, max, ...((spec.requires || []).includes(role) ? { required: true } : {}) });
  }
  return out;
}
function toModel(id) {
  const spec = specFor(id);
  const params = [...(spec.noPrompt ? [] : [P('prompt', 'string', null, null, { required: true, ...(spec.promptMax ? { maxLength: spec.promptMax } : {}) })]), ...spec.extra()];
  return { job_type: PREFIX + id, display_name: spec.name, description: '', type: spec.type, provider: 'kie', slug: id, params, medias: mediasFor(spec), ...(spec.note ? { note: spec.note } : {}) };
}
async function listModels(key) {
  specCache = await catalogueSpecs();
  const ids = [...new Set([...Object.keys(M), ...Object.keys(specCache), ...parse(key).models])];
  return ids.map(toModel);
}
async function verify(key) {
  if (!parse(key).key) return { ok: false, error: 'Paste the API key from kie.ai → API Key Management.' };
  try { const r = await call(key, `${BASE}/chat/credit`, { timeoutMs: 20000 }); return { ok: true, credits: r && r.data }; }
  catch (e) { return { ok: false, error: e.code === 'API_AUTH' ? 'Kie.ai rejected the key.' : e.message }; }
}

// Local files must be reachable by Kie: they go up once through its upload service, which keeps them for a day.
function readCache() { try { return JSON.parse(fs.readFileSync(URL_CACHE, 'utf8')); } catch { return {}; } }
async function publicUrl(key, m) {
  if (m.url && /^https?:\/\//.test(m.url) && !/localhost|127\.0\.0\.1/.test(m.url)) return m.url;
  const f = await localFile(m);
  const cache = readCache(); const ck = `${path.basename(f.abs)}:${fs.statSync(f.abs).size}`;
  if (cache[ck] && Date.now() - cache[ck].at < UPLOAD_TTL) return cache[ck].url;
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(f.abs)], { type: mimeOf(f.abs) }), path.basename(f.abs));
  form.append('uploadPath', 'lepton');
  const r = await fetchJson(UPLOAD, { method: 'POST', headers: hdr(key), form, timeoutMs: 300000 });
  const url = r && r.data && (r.data.downloadUrl || r.data.fileUrl);
  if (!url) throw new ApiError('Kie.ai did not return a link for the uploaded file.');
  cache[ck] = { url, at: Date.now() };
  try { fs.writeFileSync(URL_CACHE, JSON.stringify(cache, null, 1)); } catch { /* ignore */ }
  return url;
}

async function generate(key, model, params, medias, count, _schema, ctl) {
  const id = model.replace(PREFIX, '');
  const spec = specFor(id);
  const input = { ...(spec.fixed || {}) };
  if (!spec.noPrompt && params.prompt && !spec.dialogue && !spec.turns) input[spec.promptField || 'prompt'] = params.prompt;
  for (const p of spec.extra()) { const v = params[p.name]; if (v !== undefined && v !== null && v !== '') input[p.name] = (spec.asString || []).includes(p.name) ? String(v) : p.type === 'integer' || p.type === 'number' ? Number(v) : v; }
  if (spec.type === 'audio' && !spec.noPrompt && !input.voice && !spec.dialogue && !spec.turns) input.voice = VOICES[0].id;
  if (spec.turns) {
    // Gemini: who speaks (one or two voices), then the lines in order.
    const lines = dialogueOf(params.prompt, input.voice || 'Fola', GEMINI_VOICES); delete input.voice;
    if (!lines.length) throw new ApiError('Write the words to be spoken first.');
    const voices = [...new Set(lines.map((l) => l.voice))];
    if (voices.length > 2) throw new ApiError(`${spec.name} speaks in one or two voices, and this text names ${voices.length} (${voices.join(', ')}).`);
    input.speakers = voices.map((v, i) => ({ speaker_id: `Speaker ${i + 1}`, voice_name: v }));
    input.dialogue_turns = lines.map((l) => ({ speaker_id: `Speaker ${voices.indexOf(l.voice) + 1}`, text: l.text }));
  }
  if (spec.dialogue) {
    // The script becomes one entry per speaker turn; the node's own Voice is only the starting speaker.
    const lines = dialogueOf(params.prompt, input.voice); delete input.voice;
    if (!lines.length) throw new ApiError('Write the lines to be spoken first.');
    input.dialogue = lines;
  }
  // Media by role, in the order connected.
  const byRole = {}; for (const m of medias) (byRole[m.role] ||= []).push(m);
  for (const [role, [param, max]] of Object.entries(spec.in)) {
    if (role === 'frames') {
      const urls = []; for (const r of ['start_image', 'end_image']) for (const m of byRole[r] || []) urls.push(await publicUrl(key, m));
      if (urls.length) input[param] = urls.slice(0, max);
      continue;
    }
    const r = role === 'start' ? 'start_image' : role === 'end' ? 'end_image' : role;
    const items = byRole[r] || []; if (!items.length) continue;
    const urls = []; for (const m of items.slice(0, max)) urls.push(await publicUrl(key, m));
    input[param] = max > 1 ? urls : urls[0];
  }
  const unused = medias.filter((m) => !Object.keys(spec.in).some((role) => (role === 'frames' ? ['start_image', 'end_image'] : [role === 'start' ? 'start_image' : role === 'end' ? 'end_image' : role]).includes(m.role)));
  if (unused.length) { const what = unused[0].role.replace('_', ' '); throw new ApiError(`${spec.name} doesn't take ${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what} input.`); }
  const tooLong = (msg) => {
    if (!/text length|maximum limit|too long/i.test(msg)) return msg;
    const len = String(input.prompt || '').length; const lim = promptLimit(id);
    return `${spec.name} rejected the prompt as too long: ${len.toLocaleString()} characters${lim ? `, ${Math.max(0, len - lim).toLocaleString()} over its ${lim.toLocaleString()} limit. Shorten it by ${Math.max(0, len - lim).toLocaleString()} characters` : ''}.`;
  };
  require('./common.js').aboutToSend(ctl);
  const runs = await Promise.allSettled(Array.from({ length: count }, () => call(key, `${BASE}/jobs/createTask`, { method: 'POST', body: { model: id, input }, timeoutMs: 60000 })));
  const jobs = [], errors = [];
  for (const r of runs) {
    if (r.status === 'rejected') errors.push(tooLong(r.reason.message));
    else if (r.value && r.value.data && r.value.data.taskId) jobs.push({ id: PREFIX + r.value.data.taskId, status: 'queued' });
    else errors.push('No task id returned');
  }
  return { jobs, errors };
}

async function job(key, id) {
  const tid = id.replace(PREFIX, '');
  const r = await call(key, `${BASE}/jobs/recordInfo?taskId=${encodeURIComponent(tid)}`, { timeoutMs: 30000 });
  const d = (r && r.data) || {};
  const state = String(d.state || 'waiting').toLowerCase();
  if (state === 'fail') {
    // Kie's own catch-all ("Internal Error, Please try again later.") says nothing about where it went wrong. Say whose it is.
    const msg = String(d.failMsg || d.failCode || 'Generation failed');
    return { id, status: 'failed', error: /internal error|try again later|system error|server error/i.test(msg) ? `Kie.ai could not finish this and gave no reason ("${msg.replace(/\s+/g, ' ').trim()}"). The request itself was accepted, so nothing in the node needs changing: try again later, or try another model.` : msg };
  }
  if (state !== 'success') return { id, status: state === 'generating' ? 'in_progress' : 'queued' };
  let urls = [];
  try { const j = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson || {}; urls = j.resultUrls || j.result_urls || []; } catch { /* no result list */ }
  if (!urls.length) return { id, status: 'failed', error: 'No result returned' };
  // Kie keeps results for two weeks; they are copied here so they last.
  const local = [];
  for (const u of urls) { try { const f = await localFile({ url: u }); local.push(`/uploads/${path.basename(f.abs)}`); } catch { local.push(u); } }
  return { id, status: 'completed', result_url: local[0], extra_urls: local.slice(1) };
}

module.exports = {
  id: 'kie', name: 'Kie.ai', short: 'Kie',
  blurb: 'One key for Nano Banana, Seedream, GPT Image, Flux, Seedance, Kling, Grok Imagine, Wan, Hailuo, Topaz upscaling and ElevenLabs speech.',
  consoleUrl: 'https://kie.ai/api-key',
  fields: [
    { name: 'key', label: 'API key', placeholder: 'Add your API key', secret: true },
    { name: 'models', label: 'More models', placeholder: 'Optional: extra model ids from docs.kie.ai, comma separated' },
  ],
  parseKey: (f) => {
    const key = (f.key || '').trim();
    if (!key) throw new ApiError('Paste the API key from kie.ai.', { code: 'BAD_KEY' });
    const models = String(f.models || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    return JSON.stringify({ key, models });
  },
  keyHint: (k) => { const p = parse(k); return `${p.key.slice(0, 6)}…${p.key.slice(-4)}`; },
  verify, listModels, generate, job,
  accepts: { image: true, video: true, audio: true },
  _test: { listPages, readPage, scrapeCatalogue, fromExample, dialogueOf, VOICES },
};
